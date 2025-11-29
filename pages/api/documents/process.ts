import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import {
  getFileFromR2,
  updateManifestInR2,
  DocumentManifest,
  deleteFromR2,
  uploadToR2
} from '@/lib/r2';
import crypto from 'crypto';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Optimized batch sizes for better performance
const EMBEDDING_BATCH_SIZE = 50;
const VECTOR_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Increased timeouts
const API_TIMEOUT = 120000;        // 120 seconds
const CHUNK_TIMEOUT = 90000;       // 90 seconds

// Add progress tracking
interface ProcessingProgress {
  phase: 'parsing' | 'chunking' | 'embedding' | 'vectorizing' | 'complete';
  currentBatch?: number;
  totalBatches?: number;
  processedChunks?: number;
  totalChunks?: number;
  message: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Add timeout wrapper
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms: ${operation}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Updated retryWithBackoff to use timeout
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  initialDelay: number = RETRY_DELAY
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await withTimeout(operation(), CHUNK_TIMEOUT, 'chunk processing');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[PROCESS] Attempt ${attempt + 1} failed:`, lastError);

      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`[PROCESS] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Operation failed after all retries');
}

/**
 * Updated parsePDF: split into page-wise text, then group every 5 pages into one block.
 * Each element of the returned array is a string containing up to 5 pages' worth of text.
 */
async function parsePDF(buffer: Buffer): Promise<Array<{ text: string; pageStart: number; pageEnd: number }>> {
  const data = await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      // Reconstruct each page's text by joining items
      const textContent = await pageData.getTextContent();
      const pageLines = textContent.items.map((item: any) => item.str).join(' ');
      // Prepend a "Page N" banner
      return `Page ${pageData.pageNumber}\n${pageLines}`;
    },
    max: 0 // ignore pdf-parse's default paging logic
  });

  // Split on our "Page N" banner
  const rawPages = data.text
    .split(/(?=Page\s*\d+\n)/g) // keep the "Page N" prefix with each slice
    .filter((p: string) => p.trim());

  const cleanedPages = rawPages.map((pageStr: string) => {
    return pageStr
      .replace(/\n{2,}/g, '\n\n')  // collapse 2+ newlines into exactly two
      .replace(/ {3,}/g, ' ')      // collapse 3+ spaces into one
      .trim();
  });

  const blocks: Array<{ text: string; pageStart: number; pageEnd: number }> = [];
  const PAGES_PER_BLOCK = 5;

  for (let i = 0; i < cleanedPages.length; i += PAGES_PER_BLOCK) {
    const slice = cleanedPages.slice(i, i + PAGES_PER_BLOCK);
    const blockText = slice.join('\n'); 
    const startPage = i + 1;
    const endPage = Math.min(i + PAGES_PER_BLOCK, cleanedPages.length);

    // Only push if there's meaningful content beyond the "Page N" lines
    if (blockText.replace(/Page\s*\d+\n/g, '').trim().length > 0) {
      blocks.push({ text: blockText, pageStart: startPage, pageEnd: endPage });
    }
  }

  return blocks;
}

async function parseDocx(buffer: Buffer): Promise<string[]> {
  const result = await mammoth.extractRawText({ buffer });

  // Basic cleanup: normalize whitespace and line breaks
  const text = result.value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  // For DOCX, we don't have a page structure—just return as a single block
  return [text];
}

function splitText(
  texts: string[],
  chunkSize = 1000,
  overlap = 100
): string[] {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('Input must be a non-empty array of strings');
  }

  const chunks: string[] = [];
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

  for (const raw of texts) {
    if (typeof raw !== 'string' || !raw.trim()) {
      console.warn('[PROCESS] Skipping empty text chunk');
      continue;
    }

    // Collapse runs of 2+ newlines into exactly two, and runs of 3+ spaces into one
    const cleaned = raw
      .replace(/\n{2,}/g, '\n\n')
      .replace(/ {3,}/g, ' ')
      .trim();

    // Extract contact info as its own chunk if found
    const emails = cleaned.match(emailPattern) || [];
    const phones = cleaned.match(phonePattern) || [];
    if (emails.length > 0 || phones.length > 0) {
      chunks.push([...emails, ...phones].join(' '));
    }

    // Split into paragraphs (keep double-newline boundaries)
    const paragraphs = cleaned.split(/\n{2}/).filter(p => p.trim().length > 0);

    for (const para of paragraphs) {
      // Split on sentence boundaries (lookahead for capital or digit)
      const sentences = para
        .split(/(?<=[.!?])\s+(?=[A-Z0-9])/g)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      let currentChunk = '';
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 > chunkSize) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            // carry over the last "overlap" chars
            const overlapStart = Math.max(currentChunk.length - overlap, 0);
            currentChunk = currentChunk.slice(overlapStart).trim();
          }
          // If a single sentence is longer than chunkSize, split at word boundaries
          if (sentence.length > chunkSize) {
            let remaining = sentence;
            while (remaining.length > 0) {
              if (remaining.length <= chunkSize) {
                chunks.push(remaining.trim());
                break;
              }
              const splitPoint = remaining.slice(0, chunkSize).lastIndexOf(' ');
              if (splitPoint === -1) {
                chunks.push(remaining.slice(0, chunkSize).trim());
                remaining = remaining.slice(chunkSize);
              } else {
                chunks.push(remaining.slice(0, splitPoint).trim());
                remaining = remaining.slice(splitPoint + 1);
              }
            }
          } else {
            currentChunk = sentence;
          }
        } else {
          currentChunk += currentChunk ? ' ' + sentence : sentence;
        }
      }
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
    }
  }

  return chunks.filter(chunk => chunk.length > 10);
}

// Enhanced contact detection patterns
const CONTACT_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  // Capture full URLs including paths and query parameters
  website: /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g
};

// ============================================================================
// SMART CHUNKING FOR NON-FAQ DOCUMENTS
// Dynamic, semantic-aware chunking that respects document structure
// ============================================================================

interface SmartChunk {
  text: string;
  pageStart: number;
  pageEnd: number;
  hash: string;
  chunkType: 'section' | 'paragraph' | 'list' | 'standard';
  sectionTitle?: string;
  links: string[];
  keywords: string[];
  hasList: boolean;
  hasTable: boolean;
}

/**
 * Detect document structure type
 */
function detectDocumentStructure(text: string): {
  hasHeaders: boolean;
  hasSections: boolean;
  hasLists: boolean;
  hasTables: boolean;
  isStructured: boolean;
} {
  const headerPatterns = [
    /^#{1,6}\s+.+$/gm,                    // Markdown headers
    /^[A-Z][A-Z\s]{5,}$/gm,               // ALL CAPS headers
    /^\d+\.\s+[A-Z].+$/gm,                // Numbered sections
    /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*:$/gm, // Title Case with colon
  ];
  
  const listPatterns = [
    /^[\s]*[-•*]\s+.+$/gm,                // Bullet lists
    /^[\s]*\d+[.)]\s+.+$/gm,              // Numbered lists
    /^[\s]*[a-z][.)]\s+.+$/gm,            // Letter lists
  ];
  
  const tablePatterns = [
    /\|.+\|.+\|/g,                        // Markdown tables
    /\t.+\t.+\t/g,                        // Tab-separated tables
  ];
  
  let headerCount = 0;
  let listCount = 0;
  let tableCount = 0;
  
  for (const pattern of headerPatterns) {
    const matches = text.match(pattern);
    if (matches) headerCount += matches.length;
  }
  
  for (const pattern of listPatterns) {
    const matches = text.match(pattern);
    if (matches) listCount += matches.length;
  }
  
  for (const pattern of tablePatterns) {
    const matches = text.match(pattern);
    if (matches) tableCount += matches.length;
  }
  
  return {
    hasHeaders: headerCount >= 2,
    hasSections: headerCount >= 3,
    hasLists: listCount >= 3,
    hasTables: tableCount >= 1,
    isStructured: headerCount >= 2 || listCount >= 5
  };
}

/**
 * Extract section title from text (if any)
 */
function extractSectionTitle(text: string): string | undefined {
  const lines = text.split('\n').slice(0, 3);
  for (const line of lines) {
    const trimmed = line.trim();
    // Check for header patterns
    if (/^#{1,6}\s+(.+)$/.test(trimmed)) {
      return trimmed.replace(/^#{1,6}\s+/, '');
    }
    if (/^[A-Z][A-Z\s]{5,}$/.test(trimmed) && trimmed.length < 100) {
      return trimmed;
    }
    if (/^\d+\.\s+[A-Z].+$/.test(trimmed) && trimmed.length < 100) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Smart chunking: Respects semantic boundaries and document structure
 */
function smartChunkDocument(
  text: string,
  pageStart: number,
  pageEnd: number,
  options: {
    maxChunkSize?: number;
    minChunkSize?: number;
    targetChunkSize?: number;
    overlap?: number;
  } = {}
): SmartChunk[] {
  const {
    maxChunkSize = 2500,
    minChunkSize = 200,
    targetChunkSize = 1500,
    overlap = 200
  } = options;
  
  const chunks: SmartChunk[] = [];
  const structure = detectDocumentStructure(text);
  
  // Strategy 1: Split by sections if document has clear headers
  if (structure.hasSections) {
    const sectionPattern = /(?:^|\n)(#{1,6}\s+.+|[A-Z][A-Z\s]{5,}|\d+\.\s+[A-Z].+)(?:\n|$)/g;
    const sections: Array<{ title: string; content: string; start: number }> = [];
    
    let lastEnd = 0;
    let match;
    const matches: Array<{ title: string; index: number }> = [];
    
    while ((match = sectionPattern.exec(text)) !== null) {
      matches.push({ title: match[1].trim(), index: match.index });
    }
    
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      
      if (content.length > minChunkSize) {
        sections.push({
          title: matches[i].title,
          content,
          start
        });
      }
    }
    
    // Handle content before first section
    if (matches.length > 0 && matches[0].index > minChunkSize) {
      const preContent = text.slice(0, matches[0].index).trim();
      if (preContent.length > minChunkSize) {
        sections.unshift({ title: '', content: preContent, start: 0 });
      }
    }
    
    // If no sections found, treat entire text as one section
    if (sections.length === 0) {
      sections.push({ title: '', content: text, start: 0 });
    }
    
    // Process each section
    for (const section of sections) {
      if (section.content.length <= maxChunkSize) {
        // Section fits in one chunk
        const hash = crypto.createHash('sha256').update(section.content).digest('hex').slice(0, 32);
        chunks.push({
          text: section.content,
          pageStart,
          pageEnd,
          hash,
          chunkType: 'section',
          sectionTitle: section.title || extractSectionTitle(section.content),
          links: extractLinks(section.content),
          keywords: extractKeywords(section.content),
          hasList: /^[\s]*[-•*\d]+[.)]\s+/m.test(section.content),
          hasTable: /\|.+\|/.test(section.content)
        });
      } else {
        // Section too large - split by paragraphs with smart boundaries
        const subChunks = splitBySemanticBoundaries(section.content, targetChunkSize, overlap);
        for (const sub of subChunks) {
          const hash = crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32);
          chunks.push({
            text: sub,
            pageStart,
            pageEnd,
            hash,
            chunkType: 'paragraph',
            sectionTitle: section.title || undefined,
            links: extractLinks(sub),
            keywords: extractKeywords(sub),
            hasList: /^[\s]*[-•*\d]+[.)]\s+/m.test(sub),
            hasTable: /\|.+\|/.test(sub)
          });
        }
      }
    }
  }
  // Strategy 2: Split by paragraphs for less structured documents
  else {
    const subChunks = splitBySemanticBoundaries(text, targetChunkSize, overlap);
    for (const sub of subChunks) {
      const hash = crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32);
      chunks.push({
        text: sub,
        pageStart,
        pageEnd,
        hash,
        chunkType: 'standard',
        sectionTitle: extractSectionTitle(sub),
        links: extractLinks(sub),
        keywords: extractKeywords(sub),
        hasList: /^[\s]*[-•*\d]+[.)]\s+/m.test(sub),
        hasTable: /\|.+\|/.test(sub)
      });
    }
  }
  
  return chunks.filter(c => c.text.trim().length >= minChunkSize);
}

/**
 * Split text by semantic boundaries (paragraphs, sentences)
 * Ensures URLs and lists stay with their context
 */
function splitBySemanticBoundaries(
  text: string,
  targetSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  
  // First, split by double newlines (paragraphs)
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
  
  let currentChunk = '';
  let lastParagraph = '';
  
  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    
    // Check if adding this paragraph would exceed target
    if (currentChunk.length + trimmedPara.length + 2 > targetSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Smart overlap: carry over last paragraph if it contains a URL or is a list header
      if (lastParagraph && (
        lastParagraph.includes('http') ||
        /^[\s]*[-•*\d]+[.)]\s+/m.test(lastParagraph) ||
        lastParagraph.endsWith(':')
      )) {
        currentChunk = lastParagraph + '\n\n' + trimmedPara;
      } else {
        // Standard overlap: take end of last chunk
        const overlapText = currentChunk.slice(-overlap);
        const overlapBreak = overlapText.lastIndexOf('. ');
        if (overlapBreak > 0) {
          currentChunk = overlapText.slice(overlapBreak + 2).trim() + '\n\n' + trimmedPara;
        } else {
          currentChunk = trimmedPara;
        }
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
    }
    
    lastParagraph = trimmedPara;
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * Build enhanced metadata for smart chunks
 */
function buildSmartChunkMetadata(
  chunk: SmartChunk,
  fileName: string,
  fileKey: string,
  totalChunks: number,
  chunkIndex: number
): Record<string, any> {
  const contactInfo = detectContactInfo(chunk.text);
  
  return {
    source: fileName,
    r2Url: fileKey,
    text: chunk.text.slice(0, 2000),
    
    // Structure metadata
    chunkType: chunk.chunkType,
    sectionTitle: chunk.sectionTitle?.slice(0, 200),
    hasList: chunk.hasList,
    hasTable: chunk.hasTable,
    
    // Links and contact info
    links: chunk.links.slice(0, 10),
    hasLinks: chunk.links.length > 0,
    ...contactInfo,
    
    // Search optimization
    keywords: chunk.keywords,
    
    // Position info
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    chunkIndex,
    totalChunks,
    
    // Confidence scoring
    confidence: calculateSmartConfidence(chunk, contactInfo),
    
    // Document type marker
    documentType: 'standard'
  };
}

/**
 * Calculate confidence score for smart chunks
 */
function calculateSmartConfidence(
  chunk: SmartChunk,
  contactInfo: ReturnType<typeof detectContactInfo>
): number {
  let score = 0.7; // Base score
  
  // Boost for section chunks (more complete context)
  if (chunk.chunkType === 'section') {
    score += 0.1;
  }
  
  // Boost for chunks with section titles
  if (chunk.sectionTitle) {
    score += 0.05;
  }
  
  // Boost for chunks with links (actionable content)
  if (chunk.links.length > 0) {
    score += 0.05;
  }
  
  // Boost for contact info
  if (contactInfo.isContactInfo) {
    score += 0.05;
  }
  
  // Boost for good keyword density
  if (chunk.keywords.length >= 5) {
    score += 0.05;
  }
  
  return Math.min(1.0, score);
}

function detectContactInfo(text: string) {
  const emails = text.match(CONTACT_PATTERNS.email) || [];
  const phones = text.match(CONTACT_PATTERNS.phone) || [];
  const websites = text.match(CONTACT_PATTERNS.website) || [];
  
  return {
    emails,
    phones,
    websites,
    hasEmail: emails.length > 0,
    hasPhone: phones.length > 0,
    hasWebsite: websites.length > 0,
    isContactInfo: emails.length > 0 || phones.length > 0 || websites.length > 0
  };
}

function calculateConfidence(text: string, contactInfo: any): number {
  let score = 0.5; // Base score

  // Boost score if it contains contact information
  if (contactInfo.hasEmail || contactInfo.hasPhone || contactInfo.hasWebsite) {
    score += 0.3;
  }

  // Boost score for longer, more meaningful content
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 50) {
    score += 0.1;
  }

  // Penalize chunks that are mostly headers or page numbers
  const headerRatio = (text.match(/Page\s*\d+/g) || []).length / wordCount;
  if (headerRatio > 0.2) {
    score -= 0.2;
  }

  // Ensure score is between 0 and 1
  return Math.max(0, Math.min(1, score));
}

// ============================================================================
// FAQ-OPTIMIZED CHUNKING (Additive)
// Detects FAQ-style documents and chunks by Q&A pairs to preserve context
// ============================================================================

interface FAQChunk {
  text: string;
  question: string;
  answer: string;
  links: string[];
  detailsLinks: string[];
  chunkIndex: number;
  chunkType: 'faq_pair' | 'complete_faq' | 'partial_faq';
  isComplete: boolean;
  keywords: string[];
  partIndex?: number;
  originalQuestion?: string;
}

/**
 * Detect if a document is FAQ-style by checking for Q&A patterns
 */
function isFAQDocument(text: string): boolean {
  // Multiple patterns to detect FAQ structure
  const patterns = [
    /Question:\s*.+?\s*Answer:/gi,
    /Q:\s*.+?\s*A:/gi,
    /^\s*\d+\.\s*.+\?\s*\n/gm,  // Numbered questions ending with ?
    /^#+\s*.+\?\s*$/gm,         // Markdown headers with questions
  ];

  let matchCount = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      matchCount += matches.length;
    }
  }

  // Consider it FAQ if we find at least 3 Q&A-like patterns
  return matchCount >= 3;
}

/**
 * Extract keywords from text for better search
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how'
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 10);
}

/**
 * Extract all URLs from text
 */
function extractLinks(text: string): string[] {
  const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  return text.match(urlPattern) || [];
}

/**
 * Extract "Details:" links specifically
 */
function extractDetailsLinks(text: string): string[] {
  const detailsPattern = /Details:\s*(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
  const links: string[] = [];
  let match;
  while ((match = detailsPattern.exec(text)) !== null) {
    links.push(match[1]);
  }
  return links;
}

/**
 * FAQ-optimized chunking: Each Q&A pair becomes one chunk
 * Preserves complete information, hyperlinks, and context
 */
function chunkFAQDocument(text: string): FAQChunk[] {
  const chunks: FAQChunk[] = [];

  // Try multiple FAQ patterns
  const patterns = [
    // "Question: ... Answer: ..." format
    /Question:\s*([^\n]+(?:\n(?!Answer:)[^\n]*)*)\s*Answer:\s*([^]*?)(?=Question:|$)/gi,
    // "Q: ... A: ..." format
    /Q:\s*([^\n]+(?:\n(?!A:)[^\n]*)*)\s*A:\s*([^]*?)(?=Q:|$)/gi,
  ];

  let bestMatches: Array<{ question: string; answer: string }> = [];

  for (const pattern of patterns) {
    const matches: Array<{ question: string; answer: string }> = [];
    let match;
    const testText = text;
    pattern.lastIndex = 0; // Reset regex state

    while ((match = pattern.exec(testText)) !== null) {
      const question = match[1].trim();
      const answer = match[2].trim();
      if (question.length > 5 && answer.length > 10) {
        matches.push({ question, answer });
      }
    }

    if (matches.length > bestMatches.length) {
      bestMatches = matches;
    }
  }

  // If no structured patterns found, try to detect numbered questions
  if (bestMatches.length === 0) {
    const numberedPattern = /(\d+)\.\s*([^\n]+\?)\s*\n([^]*?)(?=\d+\.\s*[^\n]+\?|$)/gi;
    let match;
    while ((match = numberedPattern.exec(text)) !== null) {
      const question = match[2].trim();
      const answer = match[3].trim();
      if (question.length > 5 && answer.length > 10) {
        bestMatches.push({ question, answer });
      }
    }
  }

  // Build chunks from matches
  let chunkIndex = 0;
  for (const { question, answer } of bestMatches) {
    const links = extractLinks(answer);
    const detailsLinks = extractDetailsLinks(answer);
    const fullText = `Question: ${question}\n\nAnswer: ${answer}`;

    chunks.push({
      text: fullText,
      question,
      answer,
      links,
      detailsLinks,
      chunkIndex: chunkIndex++,
      chunkType: 'faq_pair',
      isComplete: true,
      keywords: extractKeywords(question),
    });
  }

  return chunks;
}

/**
 * Individual Q&A chunking: ALWAYS create separate chunks for each Q&A pair
 * This ensures each chunk has only its own relevant links/context
 */
function chunkFAQDocumentIndividual(text: string): FAQChunk[] {
  const chunks: FAQChunk[] = [];
  
  // Debug: Log first 500 chars to see document structure
  console.log(`[FAQ-DEBUG] Document preview (first 500 chars):\n${text.slice(0, 500)}`);
  console.log(`[FAQ-DEBUG] Total text length: ${text.length}`);
  
  // Try multiple patterns to handle different FAQ formats
  const patterns = [
    // Pattern 1: "Question:" on same line, "Answer:" on next line or same line
    /Question:\s*(.+?)\s*\n\s*Answer:\s*([\s\S]*?)(?=\n\s*Question:|$)/gi,
    // Pattern 2: "Question:" and "Answer:" with content (more flexible)
    /Question:\s*([\s\S]*?)\s*Answer:\s*([\s\S]*?)(?=Question:|$)/gi,
    // Pattern 3: Q: and A: format
    /Q:\s*(.+?)\s*\n\s*A:\s*([\s\S]*?)(?=\n\s*Q:|$)/gi,
  ];
  
  let bestMatches: Array<{ question: string; answer: string }> = [];
  
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const matches: Array<{ question: string; answer: string }> = [];
    let match;
    pattern.lastIndex = 0; // Reset regex state
    
    while ((match = pattern.exec(text)) !== null) {
      const question = match[1].trim();
      const answer = match[2].trim();
      if (question.length > 5 && answer.length > 10) {
        matches.push({ question, answer });
      }
    }
    
    console.log(`[FAQ-DEBUG] Pattern ${i + 1} found ${matches.length} matches`);
    
    if (matches.length > bestMatches.length) {
      bestMatches = matches;
    }
  }
  
  // If standard patterns fail, try splitting by "Question:" delimiter
  if (bestMatches.length <= 1) {
    console.log(`[FAQ-DEBUG] Standard patterns found ≤1 match, trying delimiter split...`);
    
    // Split by "Question:" and process each section
    const sections = text.split(/\n\s*Question:\s*/i).filter(s => s.trim().length > 0);
    console.log(`[FAQ-DEBUG] Split by 'Question:' found ${sections.length} sections`);
    
    for (const section of sections) {
      // Each section should have the question text, then "Answer:", then answer text
      const answerSplit = section.split(/\n\s*Answer:\s*/i);
      if (answerSplit.length >= 2) {
        const question = answerSplit[0].trim();
        const answer = answerSplit.slice(1).join('\nAnswer: ').trim();
        if (question.length > 5 && answer.length > 10) {
          bestMatches.push({ question, answer });
        }
      }
    }
    console.log(`[FAQ-DEBUG] After delimiter split: ${bestMatches.length} Q&A pairs`);
  }
  
  // Build chunks from matches
  let globalChunkIndex = 0;
  for (const { question, answer } of bestMatches) {
    const fullText = `Question: ${question}\n\nAnswer: ${answer}`;

    chunks.push({
      text: fullText,
      question,
      answer,
      links: extractLinks(answer),
      detailsLinks: extractDetailsLinks(answer),
      chunkIndex: globalChunkIndex++,
      chunkType: 'complete_faq',
      isComplete: true,
      keywords: extractKeywords(question),
    });
  }

  console.log(`[FAQ-INDIVIDUAL] Extracted ${chunks.length} individual Q&A pairs`);
  if (chunks.length > 0 && chunks.length <= 3) {
    // Log first few for debugging
    chunks.forEach((c, i) => {
      console.log(`[FAQ-DEBUG] Chunk ${i + 1}: Q="${c.question.slice(0, 50)}..." Links=${c.links.length}`);
    });
  }
  return chunks;
}

/**
 * Hybrid chunking: Keep Q&A together, but split long answers intelligently
 */
function chunkFAQDocumentHybrid(text: string, maxChunkSize = 2000): FAQChunk[] {
  const chunks: FAQChunk[] = [];
  const faqPattern = /Question:\s*([^\n]+(?:\n(?!Answer:)[^\n]*)*)\s*Answer:\s*([^]*?)(?=Question:|$)/gi;

  let match;
  let globalChunkIndex = 0;

  while ((match = faqPattern.exec(text)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim();
    const fullText = `Question: ${question}\n\nAnswer: ${answer}`;

    // If Q&A pair is small enough, keep it as one chunk
    if (fullText.length <= maxChunkSize) {
      chunks.push({
        text: fullText,
        question,
        answer,
        links: extractLinks(answer),
        detailsLinks: extractDetailsLinks(answer),
        chunkIndex: globalChunkIndex++,
        chunkType: 'complete_faq',
        isComplete: true,
        keywords: extractKeywords(question),
      });
    } else {
      // Split long answer by sentences, but keep question with each part
      const sentences = answer.match(/[^.!?]+[.!?]+/g) || [answer];
      let currentAnswer = '';
      let partIndex = 0;

      for (const sentence of sentences) {
        if ((currentAnswer + sentence).length > maxChunkSize && currentAnswer.length > 0) {
          // Create chunk with question + partial answer
          chunks.push({
            text: `Question: ${question}\n\nAnswer (Part ${partIndex + 1}): ${currentAnswer}`,
            question,
            answer: currentAnswer,
            links: extractLinks(currentAnswer),
            detailsLinks: extractDetailsLinks(currentAnswer),
            chunkIndex: globalChunkIndex++,
            chunkType: 'partial_faq',
            isComplete: false,
            keywords: extractKeywords(question),
            partIndex: partIndex++,
            originalQuestion: question,
          });
          currentAnswer = sentence;
        } else {
          currentAnswer += sentence;
        }
      }

      // Add remaining content
      if (currentAnswer.length > 0) {
        chunks.push({
          text: `Question: ${question}\n\nAnswer (Part ${partIndex + 1}): ${currentAnswer}`,
          question,
          answer: currentAnswer,
          links: extractLinks(currentAnswer),
          detailsLinks: extractDetailsLinks(currentAnswer),
          chunkIndex: globalChunkIndex++,
          chunkType: 'partial_faq',
          isComplete: false,
          keywords: extractKeywords(question),
          partIndex,
          originalQuestion: question,
        });
      }
    }
  }

  return chunks;
}

/**
 * Calculate confidence score for FAQ chunks
 */
function calculateFAQConfidence(chunk: FAQChunk): number {
  let score = 0.8; // Base score for FAQ chunks

  // Boost for complete Q&A pairs
  if (chunk.isComplete) {
    score += 0.1;
  }

  // Boost for chunks with links
  if (chunk.links && chunk.links.length > 0) {
    score += 0.05;
  }

  // Boost for chunks with keywords
  if (chunk.keywords && chunk.keywords.length > 3) {
    score += 0.05;
  }

  return Math.min(1.0, score);
}

/**
 * Build enhanced metadata for FAQ chunks
 */
function buildEnhancedFAQMetadata(
  chunk: FAQChunk,
  fileName: string,
  fileKey: string
): Record<string, any> {
  return {
    source: fileName,
    r2Url: fileKey,
    text: chunk.text.slice(0, 2000),

    // FAQ-specific metadata
    question: chunk.question.slice(0, 500),
    answer: chunk.answer.slice(0, 1500),
    chunkType: chunk.chunkType,
    isComplete: chunk.isComplete,

    // Links and references
    links: chunk.links.slice(0, 10),
    detailsLinks: chunk.detailsLinks.slice(0, 5),
    hasLinks: chunk.links.length > 0,

    // Search optimization
    keywords: chunk.keywords,

    // Chunking info
    chunkIndex: chunk.chunkIndex,
    partIndex: chunk.partIndex,
    originalQuestion: chunk.originalQuestion,

    // Confidence scoring
    confidence: calculateFAQConfidence(chunk),

    // Document type marker
    documentType: 'faq',

    // Timestamp
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// END FAQ-OPTIMIZED CHUNKING
// ============================================================================

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let fileKey: string | null = null;
  let namespace: string | null = null;
  let fileName: string | null = null;

  try {
    await withTimeout(
      (async () => {
        const {
          namespace: reqNamespace,
          fileKey: reqFileKey,
          fileName: reqFileName,
          phase = 'embeddings'
        } = req.body;

        // Validate input
        if (!reqNamespace || typeof reqNamespace !== 'string') {
          throw new Error('Invalid input: namespace must be a non-empty string');
        }

        if (!reqFileKey || typeof reqFileKey !== 'string') {
          throw new Error('Invalid input: fileKey must be a non-empty string');
        }

        if (!reqFileName || typeof reqFileName !== 'string') {
          throw new Error('Invalid input: fileName must be a non-empty string');
        }

        // Store these for potential rollback
        fileKey = reqFileKey;
        namespace = reqNamespace;
        fileName = reqFileName;

        console.log(`[PROCESS] Starting document processing for ${fileName} in namespace ${namespace}`);
        console.log(`[PROCESS] File key: ${fileKey}`);

        // Get file from R2
        console.log('[PROCESS] Fetching file from R2:', fileKey);
        const fileBuffer = await getFileFromR2(fileKey);
        if (!fileBuffer) {
          throw new Error('Failed to fetch file from R2');
        }
        console.log(`[PROCESS] Successfully fetched file from R2 (${fileBuffer.length} bytes)`);

        // Calculate document hash
        const documentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        console.log('[PROCESS] Document hash:', documentHash);

        // Parse file content into 5-page blocks
        console.log('[PROCESS] Starting file parsing phase');
        let blockData: Array<{ text: string; pageStart: number; pageEnd: number }> = [];
        
        // Track progress locally instead of writing to response
        const progress: ProcessingProgress = {
          phase: 'parsing',
          message: 'Starting file parsing...'
        };

        if (fileName.toLowerCase().endsWith('.pdf')) {
          console.log('[PROCESS] Processing PDF file');
          blockData = await parsePDF(fileBuffer);
        } else if (fileName.toLowerCase().endsWith('.docx')) {
          console.log('[PROCESS] Processing DOCX file');
          const fullTextArray = await parseDocx(fileBuffer);
          blockData = fullTextArray.map(text => ({ text, pageStart: 1, pageEnd: 1 }));
        } else {
          throw new Error('Unsupported file type');
        }

        if (!blockData.length) {
          throw new Error('No text could be extracted from the file');
        }

        console.log(`[PROCESS] Created ${blockData.length} blocks of up to 5 pages each`);
        console.log(`[PROCESS] Total pages processed: ${blockData.reduce((acc, block) => acc + (block.pageEnd - block.pageStart + 1), 0)}`);

        // Combine all text to detect document type
        const fullDocumentText = blockData.map(b => b.text).join('\n\n');
        const isDocumentFAQ = isFAQDocument(fullDocumentText);
        console.log(`[PROCESS] Document type: ${isDocumentFAQ ? 'FAQ' : 'Standard'}`);

        // Update progress for chunking
        progress.phase = 'chunking';
        progress.message = isDocumentFAQ ? 'Chunking FAQ document by Q&A pairs...' : 'Splitting into chunks...';

        console.log('[PROCESS] Starting chunking phase');

        // =====================================================================
        // FAQ-OPTIMIZED PATH: Chunk by Q&A pairs (ONE CHUNK PER Q&A)
        // =====================================================================
        let faqChunks: FAQChunk[] = [];
        if (isDocumentFAQ) {
          console.log('[PROCESS] Using FAQ-optimized chunking strategy (individual Q&A pairs)');
          
          // Use the individual chunking approach - one chunk per Q&A
          faqChunks = chunkFAQDocumentIndividual(fullDocumentText);
          
          console.log(`[PROCESS] Created ${faqChunks.length} individual FAQ chunks`);
          if (faqChunks.length > 0) {
            console.log(`[PROCESS] Sample FAQ question: "${faqChunks[0].question.slice(0, 80)}..."`);
            console.log(`[PROCESS] Sample FAQ has ${faqChunks[0].links.length} links`);
          }
        }

        // =====================================================================
        // STANDARD PATH: Smart semantic chunking
        // =====================================================================
        let smartChunks: SmartChunk[] = [];

        if (!isDocumentFAQ || faqChunks.length === 0) {
          // Fall back to standard chunking if not FAQ or FAQ parsing failed
          if (isDocumentFAQ && faqChunks.length === 0) {
            console.log('[PROCESS] FAQ detection succeeded but no Q&A pairs found, falling back to smart chunking');
          }

          const seenChunks = new Set<string>();
          const docStructure = detectDocumentStructure(fullDocumentText);
          console.log(`[PROCESS] Document structure: headers=${docStructure.hasHeaders}, sections=${docStructure.hasSections}, lists=${docStructure.hasLists}, tables=${docStructure.hasTables}`);

          for (const { text, pageStart, pageEnd } of blockData) {
            // Use smart chunking that respects semantic boundaries
            const subChunks = smartChunkDocument(text, pageStart, pageEnd, {
              maxChunkSize: 2500,
              minChunkSize: 200,
              targetChunkSize: 1500,
              overlap: 200
            });
            console.log(`[PROCESS] Block ${pageStart}-${pageEnd}: Smart chunked into ${subChunks.length} semantic chunks`);
            
            for (const chunk of subChunks) {
              if (!seenChunks.has(chunk.hash)) {
                seenChunks.add(chunk.hash);
                smartChunks.push(chunk);
              } else {
                console.log(`[PROCESS] Skipping duplicate chunk in pages ${pageStart}-${pageEnd}`);
              }
            }
          }

          console.log(`[PROCESS] Final unique smart chunk count: ${smartChunks.length}`);
          if (smartChunks.length > 0) {
            console.log(`[PROCESS] Average chunk size: ${Math.round(smartChunks.reduce((acc, chunk) => acc + chunk.text.length, 0) / smartChunks.length)} characters`);
            console.log(`[PROCESS] Chunk types: ${[...new Set(smartChunks.map(c => c.chunkType))].join(', ')}`);
          }
        }

        // Determine which chunks to process
        const usingFAQChunks = isDocumentFAQ && faqChunks.length > 0;
        const usingSmartChunks = !usingFAQChunks && smartChunks.length > 0;
        const effectiveChunkCount = usingFAQChunks ? faqChunks.length : smartChunks.length;
        console.log(`[PROCESS] Processing ${effectiveChunkCount} chunks using ${usingFAQChunks ? 'FAQ' : 'smart'} strategy`);

        if (phase === 'embeddings') {
          const { startBatch = 0 } = req.body;

          // Build Pinecone vectors array
          const vectors: Array<{
            id: string;
            values: number[];
            metadata: Record<string, any>;
          }> = [];

          // =====================================================================
          // FAQ PATH: Embed questions for better semantic search
          // =====================================================================
          if (usingFAQChunks) {
            console.log('[PROCESS] Using FAQ embedding strategy (embedding questions)');

            // Group FAQ chunks into batches
            const faqBatches: FAQChunk[][] = [];
            for (let i = 0; i < faqChunks.length; i += EMBEDDING_BATCH_SIZE) {
              faqBatches.push(faqChunks.slice(i, i + EMBEDDING_BATCH_SIZE));
            }

            console.log(`[PROCESS] Created ${faqBatches.length} FAQ embedding batches of size ${EMBEDDING_BATCH_SIZE}`);

            const BATCHES_PER_CALL = 10;
            const endBatch = Math.min(startBatch + BATCHES_PER_CALL, faqBatches.length);
            const currentBatches = faqBatches.slice(startBatch, endBatch);

            console.log(`[PROCESS] Processing FAQ embedding batches ${startBatch + 1} to ${endBatch} of ${faqBatches.length}`);

            // Update progress for embedding
            progress.phase = 'embedding';
            progress.message = `Processing FAQ embedding batch ${startBatch + 1} of ${faqBatches.length}`;

            // Generate embeddings for QUESTIONS (better for semantic search)
            const allEmbeddings: any[] = [];
            for (let i = 0; i < currentBatches.length; i++) {
              const questions = currentBatches[i].map(c => c.question);
              console.log(`[PROCESS] Generating embeddings for FAQ batch ${startBatch + i + 1} (${questions.length} questions)`);
              const batchEmbeddings = await retryWithBackoff(async () => {
                const resp = await openai.embeddings.create({
                  model: 'text-embedding-ada-002',
                  input: questions
                });
                return resp.data.map((d: any) => d.embedding);
              });
              allEmbeddings.push(...batchEmbeddings);
              console.log(`[PROCESS] Successfully generated embeddings for FAQ batch ${startBatch + i + 1}`);

              // Update progress
              progress.currentBatch = startBatch + i + 1;
              progress.totalBatches = faqBatches.length;
              progress.message = `Completed FAQ embedding batch ${startBatch + i + 1} of ${faqBatches.length}`;
            }

            // Build Pinecone vectors with enhanced FAQ metadata
            console.log('[PROCESS] Building FAQ Pinecone vectors');
            let embeddingIndex = 0;
            for (let b = startBatch; b < endBatch; b++) {
              const chunkBatch = faqBatches[b];
              for (let i = 0; i < chunkBatch.length; i++) {
                const chunk = chunkBatch[i];
                const embedding = allEmbeddings[embeddingIndex++];

                // Create unique ID based on question content
                const vectorId = crypto.createHash('sha256')
                  .update(`${fileName}${chunk.question}${chunk.chunkIndex}`)
                  .digest('hex')
                  .slice(0, 32);

                vectors.push({
                  id: vectorId,
                  values: embedding,
                  metadata: buildEnhancedFAQMetadata(chunk, fileName!, fileKey!),
                });
              }
            }

            console.log(`[PROCESS] Built ${vectors.length} FAQ vectors for Pinecone`);

            // Check if more batches remain
            if (endBatch < faqBatches.length) {
              console.log(`[PROCESS] Completed FAQ batches ${startBatch + 1}-${endBatch}, ${faqBatches.length - endBatch} batches remaining`);

              // Upsert current vectors before returning
              const vectorBatches: Array<typeof vectors> = [];
              for (let i = 0; i < vectors.length; i += VECTOR_BATCH_SIZE) {
                vectorBatches.push(vectors.slice(i, i + VECTOR_BATCH_SIZE));
              }
              const index = pinecone.Index(process.env.PINECONE_INDEX!).namespace(namespace);
              for (let i = 0; i < vectorBatches.length; i++) {
                await retryWithBackoff(async () => {
                  await index.upsert(vectorBatches[i] as any);
                });
              }

              return res.status(200).json({
                success: true,
                ...progress,
                nextPhase: 'embeddings',
                nextBatch: endBatch,
                totalBatches: faqBatches.length,
                batchSize: EMBEDDING_BATCH_SIZE,
                documentType: 'faq'
              });
            }
          }
          // =====================================================================
          // STANDARD PATH: Smart semantic embedding logic
          // =====================================================================
          else {
            console.log('[PROCESS] Using smart semantic embedding strategy');

            // Group smart chunks into smaller embedding batches
            const embeddingBatches: SmartChunk[][] = [];
            for (let i = 0; i < smartChunks.length; i += EMBEDDING_BATCH_SIZE) {
              embeddingBatches.push(smartChunks.slice(i, i + EMBEDDING_BATCH_SIZE));
            }

            console.log(`[PROCESS] Created ${embeddingBatches.length} smart embedding batches of size ${EMBEDDING_BATCH_SIZE}`);

            // Process fewer batches per request
            const BATCHES_PER_CALL = 10;
            const endBatch = Math.min(startBatch + BATCHES_PER_CALL, embeddingBatches.length);
            const currentBatches = embeddingBatches.slice(startBatch, endBatch);

            console.log(`[PROCESS] Processing smart embedding batches ${startBatch + 1} to ${endBatch} of ${embeddingBatches.length}`);

            // Update progress for embedding
            progress.phase = 'embedding';
            progress.message = `Processing smart embedding batch ${startBatch + 1} of ${embeddingBatches.length}`;

            // Generate embeddings
            const allEmbeddings: any[] = [];
            for (let i = 0; i < currentBatches.length; i++) {
              const texts = currentBatches[i].map(c => c.text);
              console.log(`[PROCESS] Generating embeddings for smart batch ${startBatch + i + 1} (${texts.length} chunks)`);
              const batchEmbeddings = await retryWithBackoff(async () => {
                const resp = await openai.embeddings.create({
                  model: 'text-embedding-ada-002',
                  input: texts
                });
                return resp.data.map((d: any) => d.embedding);
              });
              allEmbeddings.push(...batchEmbeddings);
              console.log(`[PROCESS] Successfully generated embeddings for smart batch ${startBatch + i + 1}`);

              // Update progress
              progress.currentBatch = startBatch + i + 1;
              progress.totalBatches = embeddingBatches.length;
              progress.message = `Completed smart embedding batch ${startBatch + i + 1} of ${embeddingBatches.length}`;
            }

            // Build Pinecone vectors with enhanced metadata
            console.log('[PROCESS] Building Pinecone vectors with smart metadata');
            let embeddingIndex = 0;
            for (let b = startBatch; b < endBatch; b++) {
              const chunkBatch = embeddingBatches[b];
              for (let i = 0; i < chunkBatch.length; i++) {
                const chunk = chunkBatch[i];
                const embedding = allEmbeddings[embeddingIndex++];

                // Only create vector if the chunk has meaningful content
                const cleanText = chunk.text.replace(/Page\s*\d+\n/g, '').trim();
                if (cleanText.length < 10) {
                  console.log(`[PROCESS] Skipping chunk with insufficient content in pages ${chunk.pageStart}-${chunk.pageEnd}`);
                  continue;
                }

                // Create a more specific ID that includes the source document
                const vectorId = crypto.createHash('sha256')
                  .update(`${fileName}${chunk.hash}`)
                  .digest('hex')
                  .slice(0, 32);

                const globalChunkIndex = b * EMBEDDING_BATCH_SIZE + i;

                vectors.push({
                  id: vectorId,
                  values: embedding,
                  metadata: buildSmartChunkMetadata(
                    chunk,
                    fileName!,
                    fileKey!,
                    smartChunks.length,
                    globalChunkIndex
                  )
                });
              }
            }

            console.log(`[PROCESS] Built ${vectors.length} smart vectors for Pinecone`);

            // Check if more batches remain for smart path
            if (endBatch < embeddingBatches.length) {
              console.log(`[PROCESS] Completed smart batches ${startBatch + 1}-${endBatch}, ${embeddingBatches.length - endBatch} batches remaining`);

              // Upsert current vectors before returning
              const vectorBatches: Array<typeof vectors> = [];
              for (let i = 0; i < vectors.length; i += VECTOR_BATCH_SIZE) {
                vectorBatches.push(vectors.slice(i, i + VECTOR_BATCH_SIZE));
              }
              const index = pinecone.Index(process.env.PINECONE_INDEX!).namespace(namespace);
              for (let i = 0; i < vectorBatches.length; i++) {
                await retryWithBackoff(async () => {
                  await index.upsert(vectorBatches[i] as any);
                });
              }

              return res.status(200).json({
                success: true,
                ...progress,
                nextPhase: 'embeddings',
                nextBatch: endBatch,
                totalBatches: embeddingBatches.length,
                batchSize: EMBEDDING_BATCH_SIZE,
                documentType: 'standard'
              });
            }
          }

          console.log(`[PROCESS] Built ${vectors.length} vectors for Pinecone (final)`);

          // Break vectors into Pinecone-friendly batches and upsert
          if (vectors.length > 0) {
            const vectorBatches: Array<typeof vectors> = [];
            for (let i = 0; i < vectors.length; i += VECTOR_BATCH_SIZE) {
              vectorBatches.push(vectors.slice(i, i + VECTOR_BATCH_SIZE));
            }

            console.log(`[PROCESS] Split vectors into ${vectorBatches.length} Pinecone batches of size ${VECTOR_BATCH_SIZE}`);

            const index = pinecone.Index(process.env.PINECONE_INDEX!).namespace(namespace);
            for (let i = 0; i < vectorBatches.length; i++) {
              console.log(`[PROCESS] Upserting Pinecone batch ${i + 1}/${vectorBatches.length} (${vectorBatches[i].length} vectors)`);
              await retryWithBackoff(async () => {
                await index.upsert(vectorBatches[i] as any);
              });
              console.log(`[PROCESS] Successfully upserted Pinecone batch ${i + 1}`);
            }
          }

          // All batches done → update manifest
          console.log('[PROCESS] All embedding batches completed successfully');
          console.log('[PROCESS] Updating document manifest...');
          
          // Include document type in manifest for FAQ documents
          const newDocument: DocumentManifest = {
            id: fileKey,
            source: fileName,
            r2Url: fileKey,
            createdAt: new Date().toISOString(),
            namespace,
            hash: documentHash,
            ...(usingFAQChunks && { 
              documentType: 'faq',
              chunkCount: faqChunks.length 
            })
          };

          try {
            await updateManifestInR2(namespace, newDocument);
            console.log('[PROCESS] Manifest updated successfully');
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'Document with same content already exists'
            ) {
              console.log('[PROCESS] Document already exists; skipping manifest update');
            } else {
              throw error;
            }
          }

          const chunkCount = usingFAQChunks ? faqChunks.length : smartChunks.length;
          const docType = usingFAQChunks ? 'FAQ' : 'smart';
          console.log(`[PROCESS] Document processing completed successfully for ${fileName} (${docType}, ${chunkCount} chunks)`);
          
          return res.status(200).json({
            success: true,
            ...progress,
            message: `✅ ${fileName} processed successfully! (${chunkCount} ${usingFAQChunks ? 'FAQ entries' : 'chunks'})`,
            completed: true,
            documentType: usingFAQChunks ? 'faq' : 'standard',
            chunkCount
          });
        } else {
          throw new Error('Invalid phase specified');
        }
      })(),
      API_TIMEOUT,
      'document processing'
    );
  } catch (error) {
    console.error('[PROCESS] Error processing document:', error);

    // Rollback: Delete file from R2 if it exists
    if (fileKey) {
      try {
        console.log('[PROCESS] Rolling back: deleting file from R2:', fileKey);
        await deleteFromR2(fileKey);
        console.log('[PROCESS] File deleted from R2');
      } catch (deleteError) {
        console.error('[PROCESS] Error deleting file during rollback:', deleteError);
      }
    }

    return res.status(500).json({
      error: 'Failed to process document',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
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
  // Add more patterns for other contact info
  website: /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g
};

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

        // Process chunks with progress tracking
        const allChunks: Array<{
          text: string;
          pageStart: number;
          pageEnd: number;
          hash: string;
        }> = [];

        // Update progress for chunking
        progress.phase = 'chunking';
        progress.message = 'Splitting into chunks...';

        console.log('[PROCESS] Starting chunking phase');
        const seenChunks = new Set<string>();

        for (const { text, pageStart, pageEnd } of blockData) {
          const subChunks = splitText([text], 3000, 150);
          console.log(`[PROCESS] Block ${pageStart}-${pageEnd}: Split into ${subChunks.length} subchunks`);
          
          for (const sub of subChunks) {
            const chunkHash = crypto.createHash('sha256')
              .update(sub)
              .digest('hex')
              .slice(0, 32);

            if (!seenChunks.has(chunkHash)) {
              seenChunks.add(chunkHash);
              allChunks.push({ 
                text: sub, 
                pageStart, 
                pageEnd,
                hash: chunkHash 
              });
            } else {
              console.log(`[PROCESS] Skipping duplicate chunk in pages ${pageStart}-${pageEnd}`);
            }
          }
        }

        console.log(`[PROCESS] Final unique chunk count: ${allChunks.length}`);
        console.log(`[PROCESS] Average chunk size: ${Math.round(allChunks.reduce((acc, chunk) => acc + chunk.text.length, 0) / allChunks.length)} characters`);

        if (phase === 'embeddings') {
          const { startBatch = 0 } = req.body;

          // Group chunks into smaller embedding batches
          const embeddingBatches: Array<
            Array<{ text: string; pageStart: number; pageEnd: number; hash: string }>
          > = [];
          for (let i = 0; i < allChunks.length; i += EMBEDDING_BATCH_SIZE) {
            embeddingBatches.push(allChunks.slice(i, i + EMBEDDING_BATCH_SIZE));
          }

          console.log(`[PROCESS] Created ${embeddingBatches.length} embedding batches of size ${EMBEDDING_BATCH_SIZE}`);

          // Process fewer batches per request
          const BATCHES_PER_CALL = 10;
          const endBatch = Math.min(startBatch + BATCHES_PER_CALL, embeddingBatches.length);
          const currentBatches = embeddingBatches.slice(startBatch, endBatch);

          console.log(`[PROCESS] Processing embedding batches ${startBatch + 1} to ${endBatch} of ${embeddingBatches.length}`);

          // Update progress for embedding
          progress.phase = 'embedding';
          progress.message = `Processing embedding batch ${startBatch + 1} of ${embeddingBatches.length}`;

          // Generate embeddings
          const allEmbeddings: any[] = [];
          for (let i = 0; i < currentBatches.length; i++) {
            const texts = currentBatches[i].map(c => c.text);
            console.log(`[PROCESS] Generating embeddings for batch ${startBatch + i + 1} (${texts.length} chunks)`);
            const batchEmbeddings = await retryWithBackoff(async () => {
              const resp = await openai.embeddings.create({
                model: 'text-embedding-ada-002',
                input: texts
              });
              return resp.data.map((d: any) => d.embedding);
            });
            allEmbeddings.push(...batchEmbeddings);
            console.log(`[PROCESS] Successfully generated embeddings for batch ${startBatch + i + 1}`);

            // Update progress
            progress.currentBatch = startBatch + i + 1;
            progress.totalBatches = embeddingBatches.length;
            progress.message = `Completed embedding batch ${startBatch + i + 1} of ${embeddingBatches.length}`;
          }

          // Build Pinecone vectors
          console.log('[PROCESS] Building Pinecone vectors');
          const vectors: Array<{
            id: string;
            values: number[];
            metadata: Record<string, any>;
          }> = [];
          let embeddingIndex = 0;
          for (let b = startBatch; b < endBatch; b++) {
            const chunkBatch = embeddingBatches[b];
            for (let i = 0; i < chunkBatch.length; i++) {
              const { text, pageStart, pageEnd, hash } = chunkBatch[i];
              const embedding = allEmbeddings[embeddingIndex++];
              const contactInfo = detectContactInfo(text);

              // Only create vector if the chunk has meaningful content
              // and is not just a header or page number
              const cleanText = text.replace(/Page\s*\d+\n/g, '').trim();
              if (cleanText.length < 10) {
                console.log(`[PROCESS] Skipping chunk with insufficient content in pages ${pageStart}-${pageEnd}`);
                continue;
              }

              // Create a more specific ID that includes the source document
              const vectorId = crypto.createHash('sha256')
                .update(`${fileName}${hash}`)
                .digest('hex')
                .slice(0, 32);

              vectors.push({
                id: vectorId,
                values: embedding,
                metadata: {
                  source: fileName!,
                  text: cleanText.slice(0, 2000), // Store cleaned text
                  r2Url: fileKey!,
                  ...contactInfo,
                  pageStart,
                  pageEnd,
                  chunkIndex: b * EMBEDDING_BATCH_SIZE + i,
                  totalChunks: allChunks.length,
                  // Add confidence score based on content relevance
                  confidence: calculateConfidence(cleanText, contactInfo)
                }
              });
            }
          }
          console.log(`[PROCESS] Built ${vectors.length} vectors for Pinecone`);

          // Break vectors into Pinecone-friendly batches
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

          // If more embedding batches remain, return progress
          if (endBatch < embeddingBatches.length) {
            console.log(`[PROCESS] Completed batches ${startBatch + 1}-${endBatch}, ${embeddingBatches.length - endBatch} batches remaining`);
            return res.status(200).json({
              success: true,
              ...progress,
              nextPhase: 'embeddings',
              nextBatch: endBatch,
              totalBatches: embeddingBatches.length,
              batchSize: EMBEDDING_BATCH_SIZE
            });
          }

          // All batches done → update manifest
          console.log('[PROCESS] All embedding batches completed successfully');
          console.log('[PROCESS] Updating document manifest...');
          const newDocument: DocumentManifest = {
            id: fileKey,
            source: fileName,
            r2Url: fileKey,
            createdAt: new Date().toISOString(),
            namespace,
            hash: documentHash
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

          console.log(`[PROCESS] Document processing completed successfully for ${fileName}`);
          return res.status(200).json({
            success: true,
            ...progress,
            message: `✅ ${fileName} processed successfully!`,
            completed: true
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
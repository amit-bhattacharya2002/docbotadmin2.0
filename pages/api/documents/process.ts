import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import { getFileFromR2, updateManifestInR2, DocumentManifest, deleteFromR2 } from '@/lib/r2';
import crypto from 'crypto';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Reduced batch sizes to prevent timeouts and memory issues
const EMBEDDING_BATCH_SIZE = 50; // Reduced from 100
const VECTOR_BATCH_SIZE = 25; // Reduced from 50
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// Add timeout configuration
const API_TIMEOUT = 300000; // 5 minutes
const CHUNK_TIMEOUT = 30000; // 30 seconds per chunk

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Add timeout wrapper
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms: ${operation}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Update retryWithBackoff to use timeout
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

async function parsePDF(buffer: Buffer) {
  const data = await pdfParse(buffer);
  // Split by newlines and filter out empty lines
  return data.text
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);
}

async function parseDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  // Split by newlines and filter out empty lines
  return result.value
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);
}

function splitText(texts: string[], chunkSize = 1000, overlap = 100): string[] {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('Input must be a non-empty array of strings');
  }
  
  const chunks: string[] = [];
  texts.forEach((text) => {
    if (typeof text !== 'string' || !text.trim()) {
      console.warn('[PROCESS] Skipping empty text chunk');
      return; // Skip empty chunks instead of throwing
    }
    let start = 0;
    while (start < text.length) {
      const end = start + chunkSize;
      chunks.push(text.slice(start, end));
      start += chunkSize - overlap;
    }
  });
  return chunks;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let fileKey: string | null = null;
  let namespace: string | null = null;
  let fileName: string | null = null;

  try {
    // Wrap the entire handler in a timeout
    await withTimeout(
      (async () => {
        const { namespace: reqNamespace, fileKey: reqFileKey, fileName: reqFileName } = req.body;

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

        // Get file from R2
        console.log('[PROCESS] Fetching file from R2:', fileKey);
        const fileBuffer = await getFileFromR2(fileKey);
        if (!fileBuffer) {
          throw new Error('Failed to fetch file from R2');
        }

        // Calculate document hash
        const documentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        console.log('[PROCESS] Document hash:', documentHash);

        // Parse file content
        console.log('[PROCESS] Parsing file:', fileName);
        let rawText: string[] = [];
        if (fileName.toLowerCase().endsWith('.pdf')) {
          rawText = await parsePDF(fileBuffer);
        } else if (fileName.toLowerCase().endsWith('.docx')) {
          rawText = await parseDocx(fileBuffer);
        } else {
          throw new Error('Unsupported file type');
        }

        if (!rawText.length) {
          throw new Error('No text could be extracted from the file');
        }
        
        console.log('[PROCESS] Extracted text lines:', rawText.length);
        
        // Split text into chunks
        const chunks = splitText(rawText);
        console.log(`[PROCESS] Processing ${chunks.length} chunks`);

        // Process embeddings in parallel batches
        const embeddingBatches = [];
        for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
          embeddingBatches.push(chunks.slice(i, i + EMBEDDING_BATCH_SIZE));
        }
        
        console.log(`[PROCESS] Processing ${embeddingBatches.length} embedding batches in parallel`);
        
        const embeddingPromises = embeddingBatches.map(async (batch, batchIndex) => {
          console.log(`[PROCESS] Processing embedding batch ${batchIndex + 1}/${embeddingBatches.length}`);
          return await retryWithBackoff(async () => {
            const resp = await openai.embeddings.create({
              model: 'text-embedding-ada-002',
              input: batch,
            });
            return resp.data.map((d: any) => d.embedding);
          });
        });
        
        const embeddingResults = await Promise.all(embeddingPromises);
        const allEmbeddings = embeddingResults.flat();
        
        console.log('[PROCESS] Embeddings generated:', allEmbeddings.length);

        const vectors = allEmbeddings.map((embedding: number[], i: number) => ({
          id: uuidv4(),
          values: embedding,
          metadata: {
            source: fileName!,
            text: chunks[i].slice(0, 500),
            r2Url: fileKey!,
          },
        }));

        // Process vectors in parallel batches
        const vectorBatches = [];
        for (let i = 0; i < vectors.length; i += VECTOR_BATCH_SIZE) {
          vectorBatches.push(vectors.slice(i, i + VECTOR_BATCH_SIZE));
        }
        
        console.log(`[PROCESS] Processing ${vectorBatches.length} vector batches in parallel`);
        
        const index = pinecone.Index(process.env.PINECONE_INDEX!).namespace(namespace);
        const vectorPromises = vectorBatches.map(async (batch, batchIndex) => {
          console.log(`[PROCESS] Processing vector batch ${batchIndex + 1}/${vectorBatches.length}`);
          return await retryWithBackoff(async () => {
            await index.upsert(batch);
          });
        });
        
        await Promise.all(vectorPromises);
        console.log('[PROCESS] Upsert complete');

        // Update manifest with new document
        console.log('[PROCESS] Updating manifest...');
        const newDocument: DocumentManifest = {
          id: fileKey,
          source: fileName,
          r2Url: fileKey,
          createdAt: new Date().toISOString(),
          namespace,
          hash: documentHash
        };
        console.log('[PROCESS] New document manifest:', newDocument);
        
        try {
          await updateManifestInR2(namespace, newDocument);
          console.log('[PROCESS] Manifest updated');
        } catch (error) {
          // If document already exists, we can still consider this a success
          // since the vectors are already in Pinecone
          if (error instanceof Error && error.message === 'Document with same content already exists') {
            console.log('[PROCESS] Document already exists in manifest, continuing...');
          } else {
            throw error; // Re-throw other errors
          }
        }
      })(),
      API_TIMEOUT,
      'document processing'
    );

    return res.status(200).json({ 
      success: true, 
      message: `✅ ${fileName} processed successfully!` 
    });
  } catch (error) {
    console.error('[PROCESS] Error processing document:', error);
    
    // Rollback: Delete file from R2 if it exists
    if (fileKey) {
      try {
        console.log('[PROCESS] Rolling back: Deleting file from R2:', fileKey);
        await deleteFromR2(fileKey);
        console.log('[PROCESS] File deleted from R2');
      } catch (deleteError) {
        console.error('[PROCESS] Error deleting file during rollback:', deleteError);
      }
    }

    // Handle timeout errors specifically
    if (error instanceof Error && error.message.includes('timed out')) {
      return res.status(504).json({ 
        error: 'Request timed out', 
        details: error.message 
      });
    }

    return res.status(500).json({ 
      error: 'Failed to process document', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
} 
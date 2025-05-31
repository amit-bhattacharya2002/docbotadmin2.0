import type { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { deleteFromManifest, deleteFromR2 } from '../../../src/lib/r2';

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delay: number = RETRY_DELAY
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`[DELETE] Attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        const backoffDelay = delay * Math.pow(2, attempt - 1);
        console.log(`[DELETE] Retrying in ${backoffDelay}ms...`);
        await sleep(backoffDelay);
      }
    }
  }
  
  throw lastError;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { namespace, id } = req.query;
  if (!namespace || !id) {
    return res.status(400).json({ error: 'Namespace and document ID are required' });
  }

  try {
    // The id is the file key, use it directly
    const fileKey = id as string;
    console.log('[DELETE] Deleting document:', fileKey);
    console.log('Environment variables:', {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ? 'set' : 'not set',
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ? 'set' : 'not set',
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ? 'set' : 'not set',
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? 'set' : 'not set'
    });

    // Initialize Pinecone
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const index = pinecone.index(process.env.PINECONE_INDEX!);

    // Query Pinecone to find all vector IDs associated with this document
    console.log('[DELETE] Querying Pinecone for vectors...');
    const dummyVector = new Array(1536).fill(0); // OpenAI embeddings are 1536-dimensional
    const queryResponse = await retryWithBackoff(async () => {
      return await index.namespace(namespace as string).query({
        vector: dummyVector,
        topK: 10000, // Large number to ensure we get all vectors
        includeMetadata: true,
      });
    });

    // Filter results to match our file key and collect IDs to delete
    const vectorIdsToDelete = queryResponse.matches
      .filter(match => match.metadata?.r2Url === fileKey)
      .map(match => match.id);

    console.log(`[DELETE] Found ${vectorIdsToDelete.length} vectors to delete`);

    // Delete vectors in batches of 100
    const batchSize = 100;
    for (let i = 0; i < vectorIdsToDelete.length; i += batchSize) {
      const batch = vectorIdsToDelete.slice(i, i + batchSize);
      console.log(`[DELETE] Deleting batch ${i/batchSize + 1} of ${Math.ceil(vectorIdsToDelete.length/batchSize)}`);
      await retryWithBackoff(async () => {
        await index.namespace(namespace as string).deleteMany(batch);
      });
    }

    // Delete from R2 bucket
    console.log('[DELETE] Deleting from R2...');
    await retryWithBackoff(async () => {
      await deleteFromR2(fileKey);
    });

    // Delete from manifest
    console.log('[DELETE] Updating manifest...');
    await retryWithBackoff(async () => {
      await deleteFromManifest(namespace as string, fileKey);
    });

    console.log('[DELETE] Document deleted successfully');
    return res.status(200).json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('[DELETE] Error deleting document:', error);
    return res.status(500).json({ 
      error: 'Failed to delete document', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
} 
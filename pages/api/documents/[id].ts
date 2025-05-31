import type { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { deleteFromManifest, deleteFromR2 } from '../../../src/lib/r2';

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
    console.log('Deleting document:', fileKey);
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
    const dummyVector = new Array(1536).fill(0); // OpenAI embeddings are 1536-dimensional
    const queryResponse = await index.namespace(namespace as string).query({
      vector: dummyVector,
      topK: 10000, // Large number to ensure we get all vectors
      includeMetadata: true,
    });

    // Filter results to match our file key and collect IDs to delete
    const vectorIdsToDelete = queryResponse.matches
      .filter(match => match.metadata?.r2Url === fileKey)
      .map(match => match.id);

    console.log(`Found ${vectorIdsToDelete.length} vectors to delete`);

    // Delete vectors in batches of 100
    const batchSize = 100;
    for (let i = 0; i < vectorIdsToDelete.length; i += batchSize) {
      const batch = vectorIdsToDelete.slice(i, i + batchSize);
      console.log(`Deleting batch ${i/batchSize + 1} of ${Math.ceil(vectorIdsToDelete.length/batchSize)}`);
      await index.namespace(namespace as string).deleteMany(batch);
    }

    // Delete from R2 bucket
    await deleteFromR2(fileKey);

    // Delete from manifest
    await deleteFromManifest(namespace as string, fileKey);

    return res.status(200).json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    return res.status(500).json({ 
      error: 'Failed to delete document', 
      details: error instanceof Error ? error.message : String(error)
    });
  }
} 
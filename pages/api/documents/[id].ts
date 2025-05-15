import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});
const indexName = process.env.PINECONE_INDEX!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }
  const { id } = req.query; // id is the file name (source)
  const namespace = req.query.namespace as string;
  if (!namespace || !id || typeof id !== 'string') {
    res.status(400).json({ message: 'Missing namespace or file name.' });
    return;
  }

  // Find all vector IDs for this file (source)
  const dummyVector = Array(1536).fill(0);
  const results = await pinecone.index(indexName).namespace(namespace).query({
    topK: 1000,
    vector: dummyVector,
    includeMetadata: true,
    includeValues: false,
  });
  const idsToDelete = (results.matches || [])
    .filter((match: any) => match.metadata?.source === id)
    .map((match: any) => match.id);

  if (idsToDelete.length > 0) {
    await pinecone.index(indexName).namespace(namespace).deleteMany(idsToDelete);
  }

  res.status(200).json({ message: `All vectors for file ${id} deleted.` });
} 
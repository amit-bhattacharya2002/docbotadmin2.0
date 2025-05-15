import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});
const indexName = process.env.PINECONE_INDEX!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }
  const namespace = req.query.namespace as string;
  if (!namespace) {
    res.status(400).json({ message: 'Missing namespace.' });
    return;
  }
  // Query Pinecone for all vectors in the namespace (using a dummy vector and large topK)
  const dummyVector = Array(1536).fill(0); // Should match your embedding size
  const results = await pinecone.index(indexName).namespace(namespace).query({
    topK: 1000,
    vector: dummyVector,
    includeMetadata: true,
    includeValues: false,
  });
  // Group by source (file name)
  const fileMap: Record<string, { source: string, id: string }> = {};
  (results.matches || []).forEach((match: any) => {
    const source = match.metadata?.source;
    if (source && !fileMap[source]) {
      fileMap[source] = { source, id: source };
    }
  });
  const documents = Object.values(fileMap);
  res.status(200).json({ documents });
} 
import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { getSignedDownloadUrl } from '../../../src/lib/r2';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});
const indexName = process.env.PINECONE_INDEX!;

interface DocumentMetadata {
  source: string;
  r2Url: string;
  text: string;
}

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
  const fileMap: Record<string, { source: string, id: string, r2Url: string, createdAt: string }> = {};
  
  // Process matches and generate signed URLs
  for (const match of results.matches || []) {
    const metadata = match.metadata as unknown as DocumentMetadata;
    const source = metadata?.source;
    if (source && !fileMap[source]) {
      try {
        // Extract the key from the R2 URL
        const r2Url = metadata?.r2Url || '';
        // The key should be in the format: namespace/timestamp-filename
        const urlParts = r2Url.split('/');
        const key = urlParts.slice(-2).join('/'); // Get the last two parts (namespace/filename)
        
        if (!key) {
          throw new Error('Invalid R2 URL format');
        }
        
        // Generate a signed URL
        const signedUrl = await getSignedDownloadUrl(key);
        
        fileMap[source] = { 
          source, 
          id: source,
          r2Url: signedUrl,
          createdAt: new Date().toISOString()
        };
      } catch (error) {
        console.error('Error generating signed URL:', error);
        // If signed URL generation fails, use the original R2 URL
        fileMap[source] = { 
          source, 
          id: source,
          r2Url: metadata?.r2Url || '',
          createdAt: new Date().toISOString()
        };
      }
    }
  }
  
  const documents = Object.values(fileMap);
  res.status(200).json({ documents });
} 
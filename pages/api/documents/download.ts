import { NextApiRequest, NextApiResponse } from 'next';
import { getSignedDownloadUrl } from '@/lib/r2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { key } = req.query;
    
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'File key is required' });
    }

    console.log('Generating signed URL for key:', key);
    
    // Generate signed URL using the key directly
    const signedUrl = await getSignedDownloadUrl(key);
    console.log('Generated signed URL:', signedUrl);

    return res.status(200).json({ url: signedUrl });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return res.status(500).json({ error: 'Failed to generate download URL' });
  }
} 
import { NextApiRequest, NextApiResponse } from 'next';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from '../../../src/lib/r2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { namespace, fileName, contentType } = req.body;

    if (!namespace || !fileName) {
      return res.status(400).json({ error: 'Namespace and fileName are required' });
    }

    const fileKey = `${namespace}/${Date.now()}-${fileName}`;
    
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: fileKey,
      ContentType: contentType || 'application/octet-stream',
    });

    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 }); // URL expires in 1 hour

    res.status(200).json({
      uploadUrl: signedUrl,
      fileKey: fileKey
    });
  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
} 
import { NextApiRequest, NextApiResponse } from 'next';
import { r2Client } from '../../../src/lib/r2';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { filename, contentType, namespace, subfolderId } = req.body;
  if (!filename || !namespace) {
    res.status(400).json({ error: 'Missing filename or namespace' });
    return;
  }

  // Generate a unique key for the file
  // If subfolderId is provided, include it in the file path
  let fileKey = `${namespace}/${Date.now()}-${filename}`;
  if (subfolderId) {
    fileKey = `${namespace}/${subfolderId}/${Date.now()}-${filename}`;
  }

  // Generate a signed URL for PUT (upload)
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, // Make sure this env var is set
    Key: fileKey,
    ContentType: contentType || 'application/octet-stream',
  });
  const signedUrl = await getSignedUrl(r2Client, command, { expiresIn: 15 * 60 });

  return res.status(200).json({ uploadUrl: signedUrl, fileKey });
}
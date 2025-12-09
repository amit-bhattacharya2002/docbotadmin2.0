import { NextApiRequest, NextApiResponse } from 'next';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Add timeout configuration
const URL_GENERATION_TIMEOUT = 10000; // 10 seconds

// Log R2 configuration (without sensitive data)
console.log('R2 Configuration:', {
  accountId: process.env.R2_ACCOUNT_ID ? 'Set' : 'Missing',
  accessKey: process.env.R2_ACCESS_KEY_ID ? 'Set' : 'Missing',
  secretKey: process.env.R2_SECRET_ACCESS_KEY ? 'Set' : 'Missing',
  bucketName: process.env.R2_BUCKET_NAME ? 'Set' : 'Missing'
});

// Validate R2 configuration
if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
  console.error('Missing R2 configuration. Please check your environment variables:');
  console.error('- R2_ACCOUNT_ID:', process.env.R2_ACCOUNT_ID ? 'Set' : 'Missing');
  console.error('- R2_ACCESS_KEY_ID:', process.env.R2_ACCESS_KEY_ID ? 'Set' : 'Missing');
  console.error('- R2_SECRET_ACCESS_KEY:', process.env.R2_SECRET_ACCESS_KEY ? 'Set' : 'Missing');
  console.error('- R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME ? 'Set' : 'Missing');
  throw new Error('Missing R2 configuration. Please check your environment variables.');
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[PRESIGNED-URL] Request received:', {
    method: req.method,
    body: req.body,
    headers: req.headers
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[PRESIGNED-URL] Starting URL generation');
    const { namespace, fileName, contentType, subfolderId } = req.body;

    if (!namespace || !fileName || !contentType) {
      console.error('[PRESIGNED-URL] Missing required fields:', { namespace, fileName, contentType });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // If subfolderId is provided, include it in the file path
    let fileKey = `${namespace}/${Date.now()}-${fileName}`;
    if (subfolderId) {
      fileKey = `${namespace}/${subfolderId}/${Date.now()}-${fileName}`;
    }
    console.log('[PRESIGNED-URL] Generated file key:', fileKey);
    
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: fileKey,
      ContentType: contentType,
    });

    console.log('[PRESIGNED-URL] Command created:', {
      bucket: process.env.R2_BUCKET_NAME,
      key: fileKey,
      contentType
    });

    console.log('[PRESIGNED-URL] Generating signed URL...');
    try {
      // Set maximum expiration time (7 days = 604800 seconds)
      const uploadUrl = await withTimeout(
        getSignedUrl(s3Client, command, { expiresIn: 604800 }),
        URL_GENERATION_TIMEOUT,
        'generate presigned URL'
      );
      console.log('[PRESIGNED-URL] URL generated successfully');
      res.status(200).json({ uploadUrl, fileKey });
    } catch (urlError) {
      console.error('[PRESIGNED-URL] Error in getSignedUrl:', urlError);
      throw urlError; // Re-throw to be caught by outer try-catch
    }
  } catch (error) {
    console.error('[PRESIGNED-URL] Error generating pre-signed URL:', error);
    if (error instanceof Error) {
      console.error('[PRESIGNED-URL] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    
    if (error instanceof Error && error.message.includes('timed out')) {
      return res.status(504).json({ 
        error: 'URL generation timed out',
        details: error.message
      });
    }
    res.status(500).json({ 
      error: 'Failed to generate upload URL',
      details: error instanceof Error ? error.message : String(error)
    });
  }
} 
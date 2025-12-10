import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from 'stream';

// Get environment variables
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Log configuration (without sensitive data)
console.log('R2 Configuration:', {
  accountId: R2_ACCOUNT_ID ? 'Set' : 'Missing',
  accessKey: R2_ACCESS_KEY ? 'Set' : 'Missing',
  secretKey: R2_SECRET_KEY ? 'Set' : 'Missing',
  bucketName: R2_BUCKET_NAME ? 'Set' : 'Missing'
});

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET_NAME) {
  console.error('Missing R2 configuration. Please check your environment variables:');
  console.error('- R2_ACCOUNT_ID:', R2_ACCOUNT_ID ? 'Set' : 'Missing');
  console.error('- R2_ACCESS_KEY_ID:', R2_ACCESS_KEY ? 'Set' : 'Missing');
  console.error('- R2_SECRET_ACCESS_KEY:', R2_SECRET_KEY ? 'Set' : 'Missing');
  console.error('- R2_BUCKET_NAME:', R2_BUCKET_NAME ? 'Set' : 'Missing');
  throw new Error('Missing R2 configuration. Please check your environment variables.');
}

// Create S3 client for R2
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

export interface DocumentManifest {
  id: string;
  source: string;
  r2Url: string;
  createdAt: string;
  namespace: string;
  hash?: string;
  // Document type support
  documentType?: 'faq' | 'glossary' | 'standard' | 'manual';
  chunkCount?: number;
}

export async function getManifestFromR2(namespace: string): Promise<DocumentManifest[]> {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `manifests/${namespace}.json`,
    });

    const response = await r2Client.send(command);
    const manifestStr = await response.Body?.transformToString();
    return manifestStr ? JSON.parse(manifestStr) : [];
  } catch (error: any) {
    // If the manifest doesn't exist yet, return an empty array
    if (error.Code === 'NoSuchKey') {
      console.log(`No manifest found for namespace ${namespace}, returning empty array`);
      return [];
    }
    console.error('Error reading manifest:', error);
    return [];
  }
}

export async function createInitialManifest(namespace: string): Promise<void> {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `manifests/${namespace}.json`,
      Body: JSON.stringify([], null, 2),
      ContentType: 'application/json',
    });

    await r2Client.send(command);
    console.log(`Created initial manifest for namespace ${namespace}`);
  } catch (error) {
    console.error('Error creating initial manifest:', error);
    throw error;
  }
}

export async function updateManifestInR2(namespace: string, documentOrArray: DocumentManifest | DocumentManifest[]): Promise<void> {
  try {
    console.log('[MANIFEST] Updating manifest for namespace:', namespace);
    // 1. Read existing manifest
    const existingManifest = await getManifestFromR2(namespace);
    console.log('[MANIFEST] Existing manifest:', existingManifest);
    
    // 2. Update manifest
    let updatedManifest: DocumentManifest[];
    if (Array.isArray(documentOrArray)) {
      updatedManifest = documentOrArray;
    } else {
      // Check if document with same hash already exists
      const existingDoc = existingManifest.find(doc => doc.hash === documentOrArray.hash);
      if (existingDoc) {
        console.log('[MANIFEST] Document with same hash already exists:', existingDoc);
        throw new Error('Document with same content already exists');
      }

      const index = existingManifest.findIndex(doc => doc.id === documentOrArray.id);
      if (index >= 0) {
        existingManifest[index] = documentOrArray;
        updatedManifest = existingManifest;
      } else {
        updatedManifest = [...existingManifest, documentOrArray];
      }
    }

    console.log('[MANIFEST] Updated manifest:', updatedManifest);

    // 3. Write back to R2
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `manifests/${namespace}.json`,
      Body: JSON.stringify(updatedManifest, null, 2),
      ContentType: 'application/json',
    });

    await r2Client.send(command);
    console.log('[MANIFEST] Manifest updated successfully');
  } catch (error) {
    console.error('[MANIFEST] Error updating manifest:', error);
    throw error;
  }
}

export async function deleteFromManifest(namespace: string, documentId: string): Promise<void> {
  try {
    // 1. Read existing manifest
    const existingManifest = await getManifestFromR2(namespace);
    
    console.log(`[DELETE MANIFEST] Looking for document with id/r2Url: ${documentId}`);
    console.log(`[DELETE MANIFEST] Current manifest has ${existingManifest.length} documents`);
    
    // 2. Remove document - check both id and r2Url fields since they might differ
    const updatedManifest = existingManifest.filter(doc => {
      const matches = doc.id !== documentId && doc.r2Url !== documentId;
      if (!matches) {
        console.log(`[DELETE MANIFEST] Found matching document:`, { id: doc.id, r2Url: doc.r2Url, documentId });
      }
      return matches;
    });

    console.log(`[DELETE MANIFEST] After filtering, manifest has ${updatedManifest.length} documents`);

    // 3. Write back to R2
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: `manifests/${namespace}.json`,
      Body: JSON.stringify(updatedManifest, null, 2),
      ContentType: 'application/json',
    });

    await r2Client.send(command);
    console.log(`[DELETE MANIFEST] Manifest updated successfully in R2`);
  } catch (error) {
    console.error('Error deleting from manifest:', error);
    throw error;
  }
}

// Function to upload a file to R2
export async function uploadToR2(file: Buffer | Readable, key: string, contentType?: string): Promise<string> {
  console.log('Uploading to R2 with key:', key);
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: file,
    ContentType: contentType,
  });

  try {
    await r2Client.send(command);
    console.log('File uploaded successfully');
    return key;
  } catch (error) {
    console.error('Error uploading to R2:', error);
    throw error;
  }
}

// Function to get a signed download URL
export async function getSignedDownloadUrl(key: string): Promise<string> {
  console.log('Getting signed URL for key:', key);
  
  const isDocx = key.toLowerCase().endsWith('.docx');
  const originalFilename = key.split('/').pop() || 'document'; // Get the original filename from the key
  
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ResponseContentType: isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
    ResponseContentDisposition: isDocx ? `attachment; filename="${originalFilename}"` : `inline; filename="${originalFilename}"`,
  });

  try {
    const signedUrl = await getSignedUrl(r2Client, command);
    console.log('Generated signed URL:', signedUrl);
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

// Function to delete a file from R2
export async function deleteFromR2(key: string): Promise<void> {
  console.log('Deleting from R2 with key:', key);
  
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  try {
    await r2Client.send(command);
    console.log('File deleted successfully');
  } catch (error) {
    console.error('Error deleting from R2:', error);
    throw error;
  }
}

// Function to get file content from R2
export async function getFileFromR2(key: string): Promise<Buffer> {
  console.log('Getting file from R2 with key:', key);
  
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  try {
    const response = await r2Client.send(command);
    const chunks: Uint8Array[] = [];
    
    // @ts-ignore - response.Body is a ReadableStream
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Error getting file from R2:', error);
    throw error;
  }
}
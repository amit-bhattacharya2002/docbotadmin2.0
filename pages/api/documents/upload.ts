import { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File as FormidableFile, Fields, Files } from 'formidable';
import fs from 'fs/promises';
import { uploadToR2 } from '../../../src/lib/r2';
import { updateProgress } from './upload/progress';
import crypto from 'crypto';
import { createReadStream } from 'fs';
import { getFileFromR2 } from '../../../src/lib/r2';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Add this function to calculate document hash
async function calculateDocumentHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[UPLOAD] Handler invoked');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const form = formidable({ 
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024, // 100MB limit
    maxFieldsSize: 100 * 1024 * 1024, // 100MB limit
    multiples: false,
  });

  form.parse(req, async (err: Error | null, fields: Fields, files: Files) => {
    if (err) {
      console.error('[UPLOAD] Formidable error:', err);
      res.status(500).json({ error: 'Formidable error', details: String(err) });
      return;
    }

    let originalName: string = '';
    try {
      console.log('[UPLOAD] Form fields:', fields);
      console.log('[UPLOAD] Form files:', files);
      const fileData = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : undefined;
      if (!fileData) {
        console.error('[UPLOAD] No file uploaded.');
        res.status(400).json({ error: 'No file uploaded.' });
        return;
      }

      originalName = fileData.originalFilename || 'uploaded_file';
      const filePath: string = fileData.filepath;
      const namespace: string = typeof fields.namespace === 'string' ? fields.namespace : Array.isArray(fields.namespace) ? fields.namespace[0] : '';
      
      if (!namespace) {
        console.error('[UPLOAD] No namespace provided.');
        res.status(400).json({ error: 'No namespace provided.' });
        return;
      }

      console.log('[UPLOAD] originalName:', originalName, 'filePath:', filePath, 'namespace:', namespace);

      // Calculate document hash using streaming
      console.log('[UPLOAD] Calculating document hash...');
      updateProgress(originalName, 0, 100, 'Calculating document hash...', 'uploading');
      const documentHash = await calculateDocumentHash(filePath);
      console.log('[UPLOAD] Document hash:', documentHash);
      
      // Upload to R2 using streaming
      console.log('[UPLOAD] Starting R2 upload...');
      updateProgress(originalName, 50, 100, 'Uploading to storage...', 'uploading');
      const fileKey = `${namespace}/${documentHash}-${originalName}`;
      const contentType = originalName.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      
      // Check if file already exists in R2
      try {
        const existingFile = await getFileFromR2(fileKey);
        if (existingFile) {
          console.log('[UPLOAD] File already exists in R2 with key:', fileKey);
          updateProgress(originalName, 100, 100, 'File already exists in storage!', 'complete');
          return res.status(200).json({ 
            message: `✅ ${originalName} already exists in storage!`, 
            r2Url: fileKey,
            hash: documentHash
          });
        }
      } catch (error) {
        // If getFileFromR2 fails, it means the file doesn't exist, which is what we want
        console.log('[UPLOAD] File does not exist in R2, proceeding with upload');
      }
      
      // Create a read stream for the file
      const fileStream = createReadStream(filePath);
      await uploadToR2(fileStream, fileKey, contentType);
      console.log('[UPLOAD] File uploaded to R2 with key:', fileKey);

      // Send final progress update
      updateProgress(originalName, 100, 100, 'Upload complete!', 'complete');
      console.log('[UPLOAD] Final progress update sent');
      
      res.status(200).json({ 
        message: `✅ ${originalName} uploaded successfully!`, 
        r2Url: fileKey,
        hash: documentHash
      });
    } catch (e) {
      console.error('[UPLOAD] Upload failed:', e instanceof Error ? e.stack : e);
      if (originalName) {
        updateProgress(originalName, 0, 100, 'Upload failed: ' + String(e), 'error');
        console.log('[UPLOAD] Error progress update sent');
      }
      res.status(500).json({ error: 'Upload failed', details: String(e) });
    }
  });
}
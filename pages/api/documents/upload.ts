import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import formidable, { File as FormidableFile, Fields, Files } from 'formidable';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { uploadToR2, updateManifestInR2, getManifestFromR2, DocumentManifest } from '../../../src/lib/r2';
import { updateProgress } from './upload/progress';
import crypto from 'crypto';

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;

export const config = {
  api: {
    bodyParser: false,
  },
};

function splitText(texts: string[], chunkSize = 1000, overlap = 100): string[] {
  const chunks: string[] = [];
  texts.forEach((text) => {
    let start = 0;
    while (start < text.length) {
      const end = start + chunkSize;
      chunks.push(text.slice(start, end));
      start += chunkSize - overlap;
    }
  });
  return chunks;
}

async function parsePDF(filePath: string) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text.split('\n');
}

async function parseDocx(filePath: string) {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value.split('\n').filter(line => line.trim());
}

// Add this function to calculate document hash
async function calculateDocumentHash(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Add this function to check for duplicates
async function checkForDuplicates(namespace: string, filePath: string): Promise<boolean> {
  try {
    console.log('[UPLOAD] Checking for duplicates in namespace:', namespace);
    const manifest = await getManifestFromR2(namespace);
    console.log('[UPLOAD] Retrieved manifest:', manifest);

    const newDocHash = await calculateDocumentHash(filePath);
    console.log('[UPLOAD] New document hash:', newDocHash);

    // Check if any existing document has the same hash
    const documents = Array.isArray(manifest) ? manifest : [manifest];
    const isDuplicate = documents.some((doc: DocumentManifest) => {
      console.log('[UPLOAD] Comparing with document:', doc.source, 'hash:', doc.hash);
      return doc.hash === newDocHash;
    });

    console.log('[UPLOAD] Is duplicate:', isDuplicate);
    return isDuplicate;
  } catch (error) {
    console.error('[UPLOAD] Error checking for duplicates:', error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[UPLOAD] Handler invoked');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  console.log('[UPLOAD] Checking environment variables');
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX || !process.env.OPENAI_API_KEY) {
    console.error('[UPLOAD] Missing environment variables', {
      PINECONE_API_KEY: !!process.env.PINECONE_API_KEY,
      PINECONE_INDEX: !!process.env.PINECONE_INDEX,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    });
    res.status(500).json({ error: 'Missing environment variables' });
    return;
  }

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX!;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const form = formidable({ 
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB limit
    maxFieldsSize: 50 * 1024 * 1024, // 50MB limit
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

      // Check for duplicates
      console.log('[UPLOAD] Checking for duplicates...');
      updateProgress(originalName, 0, 100, 'Checking for duplicates...', 'checking');
      const isDuplicate = await checkForDuplicates(namespace, filePath);
      if (isDuplicate) {
        console.log('[UPLOAD] Duplicate document detected');
        updateProgress(originalName, 0, 100, 'This document has already been uploaded', 'error');
        res.status(400).json({ error: 'This document has already been uploaded' });
        return;
      }
      console.log('[UPLOAD] No duplicates found, proceeding with upload');

      // Read file content
      console.log('[UPLOAD] Starting file read...');
      updateProgress(originalName, 0, 100, 'Reading file content...', 'uploading');
      const fileBuffer = await fs.readFile(filePath);
      console.log('[UPLOAD] File read complete');
      
      // Calculate document hash
      const documentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      console.log('[UPLOAD] Document hash:', documentHash);
      
      // Upload to R2
      console.log('[UPLOAD] Starting R2 upload...');
      updateProgress(originalName, 20, 100, 'Uploading to storage...', 'uploading');
      const fileKey = `${namespace}/${Date.now()}-${originalName}`;
      const contentType = originalName.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      await uploadToR2(fileBuffer, fileKey);
      console.log('[UPLOAD] File uploaded to R2 with key:', fileKey);

      // Parse file
      console.log('[UPLOAD] Starting file parsing...');
      updateProgress(originalName, 40, 100, 'Parsing document...', 'parsing');
      console.log('[UPLOAD] Progress update sent: Parsing document');
      let rawText: string[] = [];
      if (originalName.endsWith('.pdf')) {
        console.log('[UPLOAD] Parsing PDF');
        rawText = await parsePDF(filePath);
      } else if (originalName.endsWith('.docx')) {
        console.log('[UPLOAD] Parsing DOCX');
        rawText = await parseDocx(filePath);
      } else {
        console.error('[UPLOAD] Unsupported file type:', originalName);
        throw new Error('Unsupported file type');
      }
      console.log('[UPLOAD] File parsing complete');

      if (!rawText.length) {
        console.error('[UPLOAD] No text could be extracted.');
        throw new Error('No text could be extracted.');
      }

      const chunks = splitText(rawText);
      console.log('[UPLOAD] Chunks count:', chunks.length);
      try {
        // Increase batch sizes for better performance
        const EMBEDDING_BATCH_SIZE = 200; // Increased from 100
        const VECTOR_BATCH_SIZE = 100; // Increased from 50

        // Process embeddings in parallel batches
        const embeddingBatches = [];
        for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
          embeddingBatches.push(chunks.slice(i, i + EMBEDDING_BATCH_SIZE));
        }
        
        console.log(`[UPLOAD] Processing ${embeddingBatches.length} embedding batches in parallel`);
        updateProgress(originalName, 60, 100, 'Generating embeddings in parallel...', 'embedding');
        console.log('[UPLOAD] Progress update sent: Generating embeddings');
        
        let completedEmbeddingBatches = 0;
        const embeddingPromises = embeddingBatches.map(async (batch, batchIndex) => {
          console.log(`[UPLOAD] Processing embedding batch ${batchIndex + 1}/${embeddingBatches.length}`);
          const resp = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: batch,
          });
          
          completedEmbeddingBatches++;
          const progress = 60 + Math.floor((completedEmbeddingBatches / embeddingBatches.length) * 20);
          console.log(`[UPLOAD] Completed embedding batch ${completedEmbeddingBatches}/${embeddingBatches.length}, progress: ${progress}%`);
          updateProgress(
            originalName,
            progress,
            100,
            `Generating embeddings (${completedEmbeddingBatches}/${embeddingBatches.length} batches)`,
            'embedding'
          );
          console.log('[UPLOAD] Progress update sent: Embedding batch complete');
          
          return resp.data.map((d: any) => d.embedding);
        });
        
        const embeddingResults = await Promise.all(embeddingPromises);
        const allEmbeddings = embeddingResults.flat();
        
        console.log('[UPLOAD] Embeddings generated:', allEmbeddings.length);
        updateProgress(originalName, 80, 100, 'Embeddings generated, preparing for database upload...', 'upserting');
        console.log('[UPLOAD] Progress update sent: Preparing for database upload');

        const vectors = allEmbeddings.map((embedding: number[], i: number) => ({
          id: uuidv4(),
          values: embedding,
          metadata: {
            source: originalName,
            text: chunks[i].slice(0, 500),
            r2Url: fileKey,
          },
        }));

        // Process vectors in parallel batches
        const vectorBatches = [];
        for (let i = 0; i < vectors.length; i += VECTOR_BATCH_SIZE) {
          vectorBatches.push(vectors.slice(i, i + VECTOR_BATCH_SIZE));
        }
        
        console.log(`[UPLOAD] Processing ${vectorBatches.length} vector batches in parallel`);
        
        let completedVectorBatches = 0;
        const vectorPromises = vectorBatches.map(async (batch, batchIndex) => {
          console.log(`[UPLOAD] Processing vector batch ${batchIndex + 1}/${vectorBatches.length}`);
          await pinecone.index(indexName).namespace(namespace).upsert(batch);
          
          completedVectorBatches++;
          const progress = 80 + Math.floor((completedVectorBatches / vectorBatches.length) * 20);
          console.log(`[UPLOAD] Completed vector batch ${completedVectorBatches}/${vectorBatches.length}, progress: ${progress}%`);
          updateProgress(
            originalName,
            progress,
            100,
            `Uploading to database (${completedVectorBatches}/${vectorBatches.length} batches)`,
            'upserting'
          );
          console.log('[UPLOAD] Progress update sent: Vector batch complete');
        });
        
        await Promise.all(vectorPromises);
        console.log('[UPLOAD] Upsert complete');
        
        // Update manifest with new document
        console.log('[UPLOAD] Updating manifest...');
        const newDocument: DocumentManifest = {
          id: fileKey,
          source: originalName,
          r2Url: fileKey,
          createdAt: new Date().toISOString(),
          namespace,
          hash: documentHash
        };
        console.log('[UPLOAD] New document manifest:', newDocument);
        await updateManifestInR2(namespace, newDocument);
        console.log('[UPLOAD] Manifest updated');
        
        // Ensure we send the final progress update
        console.log('[UPLOAD] Sending final progress update');
        updateProgress(originalName, 100, 100, 'Upload complete!', 'complete');
        console.log('[UPLOAD] Final progress update sent');
        
        // Add a small delay to ensure the final progress update is sent
        await new Promise(resolve => setTimeout(resolve, 500));
        
        res.status(200).json({ message: `✅ ${originalName} uploaded and indexed!`, r2Url: fileKey });
      } catch (embeddingError) {
        console.error('[UPLOAD] OpenAI or Pinecone error:', embeddingError);
        updateProgress(originalName, 0, 100, 'Upload failed: ' + String(embeddingError), 'error');
        console.log('[UPLOAD] Error progress update sent');
        // Add a small delay to ensure the error progress update is sent
        await new Promise(resolve => setTimeout(resolve, 500));
        res.status(500).json({ error: 'Embedding or Pinecone error', details: String(embeddingError) });
      }
    } catch (e) {
      console.error('[UPLOAD] Upload failed:', e instanceof Error ? e.stack : e);
      if (originalName) {
        updateProgress(originalName, 0, 100, 'Upload failed: ' + String(e), 'error');
        console.log('[UPLOAD] Error progress update sent');
        // Add a small delay to ensure the error progress update is sent
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      res.status(500).json({ error: 'Upload failed', details: String(e) });
    }
  });
}
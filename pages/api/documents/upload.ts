import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import formidable, { File as FormidableFile, Fields, Files } from 'formidable';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { uploadToR2 } from '../../../src/lib/r2';

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

  const form = formidable({ keepExtensions: true });
  form.parse(req, async (err: Error | null, fields: Fields, files: Files) => {
    if (err) {
      console.error('[UPLOAD] Formidable error:', err);
      res.status(500).json({ error: 'Formidable error', details: String(err) });
      return;
    }
    try {
      console.log('[UPLOAD] Form fields:', fields);
      console.log('[UPLOAD] Form files:', files);
      const fileData = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : undefined;
      if (!fileData) {
        console.error('[UPLOAD] No file uploaded.');
        res.status(400).json({ error: 'No file uploaded.' });
        return;
      }
      const originalName: string = fileData.originalFilename || 'uploaded_file';
      const filePath: string = fileData.filepath;
      const namespace: string = typeof fields.namespace === 'string' ? fields.namespace : Array.isArray(fields.namespace) ? fields.namespace[0] : '';
      if (!namespace) {
        console.error('[UPLOAD] No namespace provided.');
        res.status(400).json({ error: 'No namespace provided.' });
        return;
      }
      console.log('[UPLOAD] originalName:', originalName, 'filePath:', filePath, 'namespace:', namespace);

      // Read file content
      const fileBuffer = await fs.readFile(filePath);
      
      // Upload to R2
      const fileKey = `${namespace}/${Date.now()}-${originalName}`;
      const contentType = originalName.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const r2Url = await uploadToR2(fileBuffer, fileKey, contentType);
      console.log('[UPLOAD] File uploaded to R2:', r2Url);

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

      if (!rawText.length) {
        console.error('[UPLOAD] No text could be extracted.');
        throw new Error('No text could be extracted.');
      }

      const chunks = splitText(rawText);
      console.log('[UPLOAD] Chunks count:', chunks.length);
      try {
        const resp = await openai.embeddings.create({
          model: 'text-embedding-ada-002',
          input: chunks,
        });
        const embeddings = resp.data.map((d: any) => d.embedding);
        console.log('[UPLOAD] Embeddings generated:', embeddings.length);

        const vectors = embeddings.map((embedding: number[], i: number) => ({
          id: uuidv4(),
          values: embedding,
          metadata: {
            source: originalName,
            text: chunks[i],
            r2Url: fileKey,
          },
        }));

        console.log('[UPLOAD] Upserting to Pinecone:', vectors.length, 'vectors');
        await pinecone.index(indexName).namespace(namespace).upsert(vectors);
        console.log('[UPLOAD] Upsert complete');
        res.status(200).json({ message: `✅ ${originalName} uploaded and indexed!`, r2Url });
      } catch (embeddingError) {
        console.error('[UPLOAD] OpenAI or Pinecone error:', embeddingError);
        res.status(500).json({ error: 'Embedding or Pinecone error', details: String(embeddingError) });
      }
    } catch (e) {
      console.error('[UPLOAD] Upload failed:', e instanceof Error ? e.stack : e);
      res.status(500).json({ error: 'Upload failed', details: String(e) });
    }
  });
} 
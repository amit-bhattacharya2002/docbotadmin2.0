import { NextApiRequest, NextApiResponse } from 'next';
import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import { getManifestFromR2, updateManifestInR2, DocumentManifest, getFileFromR2 } from '../../../src/lib/r2';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { namespace, fileKey, fileName } = req.body;

    if (!namespace || !fileKey || !fileName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Initialize services
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const indexName = process.env.PINECONE_INDEX!;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Parse file content
    let rawText: string[] = [];
    if (fileName.endsWith('.pdf')) {
      rawText = await parsePDF(fileKey);
    } else if (fileName.endsWith('.docx')) {
      rawText = await parseDocx(fileKey);
    } else {
      throw new Error('Unsupported file type');
    }

    if (!rawText.length) {
      throw new Error('No text could be extracted');
    }

    // Generate embeddings
    const chunks = splitText(rawText);
    const EMBEDDING_BATCH_SIZE = 200;
    const VECTOR_BATCH_SIZE = 100;

    // Process embeddings in parallel batches
    const embeddingBatches = [];
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      embeddingBatches.push(chunks.slice(i, i + EMBEDDING_BATCH_SIZE));
    }

    const embeddingPromises = embeddingBatches.map(async (batch) => {
      const resp = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: batch,
      });
      return resp.data.map((d: any) => d.embedding);
    });

    const embeddingResults = await Promise.all(embeddingPromises);
    const allEmbeddings = embeddingResults.flat();

    // Create vectors
    const vectors = allEmbeddings.map((embedding: number[], i: number) => ({
      id: uuidv4(),
      values: embedding,
      metadata: {
        source: fileName,
        text: chunks[i].slice(0, 500),
        r2Url: fileKey,
      },
    }));

    // Process vectors in parallel batches
    const vectorBatches = [];
    for (let i = 0; i < vectors.length; i += VECTOR_BATCH_SIZE) {
      vectorBatches.push(vectors.slice(i, i + VECTOR_BATCH_SIZE));
    }

    const vectorPromises = vectorBatches.map(async (batch) => {
      await pinecone.index(indexName).namespace(namespace).upsert(batch);
    });

    await Promise.all(vectorPromises);

    // Update manifest
    const newDocument: DocumentManifest = {
      id: fileKey,
      source: fileName,
      r2Url: fileKey,
      createdAt: new Date().toISOString(),
      namespace,
      hash: crypto.createHash('sha256').update(rawText.join('')).digest('hex')
    };

    await updateManifestInR2(namespace, newDocument);

    res.status(200).json({ message: `✅ ${fileName} processed and indexed!` });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Failed to process file', details: String(error) });
  }
}

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

async function parsePDF(fileKey: string): Promise<string[]> {
  const buffer = await getFileFromR2(fileKey);
  const data = await pdfParse(buffer);
  return data.text.split('\n');
}

async function parseDocx(fileKey: string): Promise<string[]> {
  const buffer = await getFileFromR2(fileKey);
  const result = await mammoth.extractRawText({ buffer });
  return result.value.split('\n').filter(line => line.trim());
} 
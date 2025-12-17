import type { NextApiRequest, NextApiResponse } from 'next';
import { getManifestFromR2, createInitialManifest } from '../../../src/lib/r2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const namespace = req.query.namespace as string;
  const subfolderId = req.query.subfolderId as string | undefined;
  
  if (!namespace) {
    return res.status(400).json({ error: 'Namespace is required' });
  }

  // Parse pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 50;

  try {
    // If subfolderId is provided, get documents from that subfolder's namespace
    // Otherwise, get documents from the base namespace
    let targetNamespace = namespace;
    
    if (subfolderId) {
      try {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        const subfolder = await prisma.subfolder.findUnique({
          where: { id: subfolderId },
        });
        if (subfolder) {
          targetNamespace = subfolder.pineconeNamespace;
          console.log(`[DOCUMENTS] Using subfolder namespace: ${targetNamespace}`);
        } else {
          console.warn(`[DOCUMENTS] Subfolder ${subfolderId} not found, using base namespace`);
        }
        await prisma.$disconnect();
      } catch (prismaError) {
        console.error('[DOCUMENTS] Error fetching subfolder:', prismaError);
        // Continue with base namespace if subfolder lookup fails
      }
    }

    // Get manifest from R2
    let manifest = await getManifestFromR2(targetNamespace);
    
    // If manifest doesn't exist, try to create it (but don't fail if it already exists)
    if (manifest.length === 0) {
      try {
        await createInitialManifest(targetNamespace);
        // Re-fetch to get the newly created manifest
        manifest = await getManifestFromR2(targetNamespace);
      } catch (error: any) {
        // If manifest creation fails, just continue with empty array
        // (it might have been created by another request)
        console.warn('Could not create initial manifest (may already exist):', error);
        manifest = await getManifestFromR2(targetNamespace);
      }
    }

    // Calculate pagination
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const documents = manifest.slice(start, end).map(doc => ({
      ...doc,
      id: doc.r2Url, // Use r2Url as the id for consistency
    }));

    // Return paginated results
    return res.status(200).json({
      documents,
      pagination: {
        total: manifest.length,
        page,
        perPage,
        totalPages: Math.ceil(manifest.length / perPage),
      },
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return res.status(500).json({
      error: 'Failed to fetch documents',
      details: String(error),
    });
  }
}

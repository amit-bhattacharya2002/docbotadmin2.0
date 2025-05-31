import type { NextApiRequest, NextApiResponse } from 'next';
import { getManifestFromR2, createInitialManifest } from '../../../src/lib/r2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const namespace = req.query.namespace as string;
  if (!namespace) {
    return res.status(400).json({ error: 'Namespace is required' });
  }

  // Parse pagination parameters
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 50;

  try {
    // Get manifest from R2
    let manifest = await getManifestFromR2(namespace);
    
    // If manifest doesn't exist, create it
    if (manifest.length === 0) {
      await createInitialManifest(namespace);
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

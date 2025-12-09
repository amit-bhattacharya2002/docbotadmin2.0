import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { Pinecone } from "@pinecone-database/pinecone";
import { 
  getManifestFromR2, 
  deleteFromR2, 
  updateManifestInR2,
  createInitialManifest,
  DocumentManifest
} from "../../../../lib/r2";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const prisma = new PrismaClient();
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

// Initialize R2 client
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY!,
    secretAccessKey: R2_SECRET_KEY!,
  },
});

// DELETE - Delete a subfolder
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "DEPARTMENTADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id: subfolderId } = await params;

    // Get subfolder and verify user has access
    const subfolder = await prisma.subfolder.findUnique({
      where: { id: subfolderId },
      include: { department: true },
    });

    if (!subfolder) {
      return NextResponse.json(
        { message: "Subfolder not found" },
        { status: 404 }
      );
    }

    // Verify user has access to this department
    // Use email since session.user.id is not available in JWT strategy
    if (!session.user.email) {
      return NextResponse.json({ message: "User email not found" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user?.departmentId || user.departmentId !== subfolder.departmentId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const oldPineconeNamespace = subfolder.pineconeNamespace;
    const baseNamespace = subfolder.namespaceType === "INTERNAL"
      ? subfolder.department.namespace
      : subfolder.department.externalNamespace;

    console.log(`[DELETE FOLDER] Starting deletion for folder: ${subfolder.name}`);
    console.log(`[DELETE FOLDER] Pinecone namespace: ${oldPineconeNamespace}`);
    console.log(`[DELETE FOLDER] Base namespace: ${baseNamespace}`);

    // 1. Get all documents from the manifest
    const manifest = await getManifestFromR2(oldPineconeNamespace);
    console.log(`[DELETE FOLDER] Found ${manifest.length} documents in manifest`);

    // 2. Delete all vectors from Pinecone namespace
    console.log(`[DELETE FOLDER] Deleting vectors from Pinecone namespace...`);
    const index = pinecone.index(process.env.PINECONE_INDEX!);
    const namespaceIndex = index.namespace(oldPineconeNamespace);
    
    try {
      // Use deleteAll to delete all vectors in the namespace
      await namespaceIndex.deleteAll();
      console.log(`[DELETE FOLDER] Deleted all vectors from Pinecone namespace`);
    } catch (error) {
      console.error(`[DELETE FOLDER] Error deleting vectors from Pinecone:`, error);
      // If deleteAll fails, try querying and deleting in batches
      try {
        const dummyVector = new Array(1536).fill(0);
        let hasMore = true;
        let deletedCount = 0;
        
        while (hasMore) {
          const queryResponse = await namespaceIndex.query({
            vector: dummyVector,
            topK: 1000,
            includeMetadata: false,
          });

          if (queryResponse.matches.length === 0) {
            hasMore = false;
            break;
          }

          const vectorIds = queryResponse.matches.map(m => m.id);
          await namespaceIndex.deleteMany(vectorIds);
          deletedCount += vectorIds.length;
          console.log(`[DELETE FOLDER] Deleted ${deletedCount} vectors...`);
          
          // If we got fewer than topK, we've deleted everything
          if (queryResponse.matches.length < 1000) {
            hasMore = false;
          }
        }
        console.log(`[DELETE FOLDER] Deleted ${deletedCount} vectors total`);
      } catch (fallbackError) {
        console.error(`[DELETE FOLDER] Fallback deletion also failed:`, fallbackError);
        // Continue with R2 deletion even if Pinecone deletion fails
      }
    }

    // 3. Delete all files from R2
    console.log(`[DELETE FOLDER] Deleting files from R2...`);
    for (const doc of manifest) {
      try {
        // File key is stored in r2Url or id field
        const fileKey = doc.r2Url || doc.id;
        if (fileKey) {
          await deleteFromR2(fileKey);
          console.log(`[DELETE FOLDER] Deleted file: ${fileKey}`);
        }
      } catch (error: any) {
        // If file doesn't exist, that's okay - continue
        console.error(`[DELETE FOLDER] Error deleting file ${doc.id}:`, error);
        // Continue with other files even if one fails
      }
    }

    // 4. Delete the manifest file
    try {
      const deleteManifestCommand = new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: `manifests/${oldPineconeNamespace}.json`,
      });
      await r2Client.send(deleteManifestCommand);
      console.log(`[DELETE FOLDER] Deleted manifest file`);
    } catch (error) {
      console.error(`[DELETE FOLDER] Error deleting manifest:`, error);
      // Continue even if manifest deletion fails
    }

    // 5. Delete from database
    await prisma.subfolder.delete({
      where: { id: subfolderId },
    });

    console.log(`[DELETE FOLDER] Folder deleted successfully`);
    return NextResponse.json({ message: "Subfolder deleted successfully" });
  } catch (error) {
    console.error("Error deleting subfolder:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH - Update/rename a subfolder
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "DEPARTMENTADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id: subfolderId } = await params;
    const { name } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json(
        { message: "Folder name is required" },
        { status: 400 }
      );
    }

    // Get subfolder and verify user has access
    const subfolder = await prisma.subfolder.findUnique({
      where: { id: subfolderId },
      include: { department: true },
    });

    if (!subfolder) {
      return NextResponse.json(
        { message: "Subfolder not found" },
        { status: 404 }
      );
    }

    // Verify user has access to this department
    if (!session.user.email) {
      return NextResponse.json({ message: "User email not found" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user?.departmentId || user.departmentId !== subfolder.departmentId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    // Check if another subfolder with the same name already exists
    const existing = await prisma.subfolder.findFirst({
      where: {
        departmentId: subfolder.departmentId,
        namespaceType: subfolder.namespaceType,
        name: name.trim(),
        id: { not: subfolderId }, // Exclude current subfolder
      },
    });

    if (existing) {
      return NextResponse.json(
        { message: "A folder with this name already exists" },
        { status: 400 }
      );
    }

    // Update Pinecone namespace with new name
    const baseNamespace = subfolder.namespaceType === "INTERNAL"
      ? subfolder.department.namespace
      : subfolder.department.externalNamespace;
    
    const sanitizedName = name.trim().replace(/[^a-zA-Z0-9]/g, "-");
    const newPineconeNamespace = `${baseNamespace}-${sanitizedName}`;
    const oldPineconeNamespace = subfolder.pineconeNamespace;

    console.log(`[RENAME FOLDER] Renaming folder: ${subfolder.name} -> ${name.trim()}`);
    console.log(`[RENAME FOLDER] Old namespace: ${oldPineconeNamespace}`);
    console.log(`[RENAME FOLDER] New namespace: ${newPineconeNamespace}`);

    // 1. Get all documents from the old namespace manifest
    const manifest = await getManifestFromR2(oldPineconeNamespace);
    console.log(`[RENAME FOLDER] Found ${manifest.length} documents to migrate`);

    if (manifest.length > 0) {
      // 2. Move vectors from old namespace to new namespace in Pinecone
      console.log(`[RENAME FOLDER] Moving vectors in Pinecone...`);
      const index = pinecone.index(process.env.PINECONE_INDEX!);
      const oldNamespaceIndex = index.namespace(oldPineconeNamespace);
      const newNamespaceIndex = index.namespace(newPineconeNamespace);

      // Query to get all vector IDs from old namespace
      const dummyVector = new Array(1536).fill(0);
      let allVectorIds: string[] = [];
      let hasMore = true;
      
      // Query in batches to get all vector IDs
      while (hasMore) {
        const queryResponse = await oldNamespaceIndex.query({
          vector: dummyVector,
          topK: 1000,
          includeMetadata: false,
        });

        if (queryResponse.matches.length === 0) {
          hasMore = false;
          break;
        }

        allVectorIds.push(...queryResponse.matches.map(m => m.id));
        
        // If we got fewer than topK, we've found everything
        if (queryResponse.matches.length < 1000) {
          hasMore = false;
        }
      }

      console.log(`[RENAME FOLDER] Found ${allVectorIds.length} vectors to move`);

      // Fetch vectors and move them in batches
      const batchSize = 100;
      for (let i = 0; i < allVectorIds.length; i += batchSize) {
        const batchIds = allVectorIds.slice(i, i + batchSize);
        
        // Fetch the actual vectors with their values and metadata
        const fetchResponse = await oldNamespaceIndex.fetch(batchIds);
        
        // Convert fetched vectors to upsert format
        const vectorsToUpsert = Object.entries(fetchResponse.records || {}).map(([id, record]) => ({
          id,
          values: record.values || [],
          metadata: record.metadata || {},
        }));

        // Upsert to new namespace
        if (vectorsToUpsert.length > 0) {
          await newNamespaceIndex.upsert(vectorsToUpsert as any);
        }
        
        // Delete from old namespace
        await oldNamespaceIndex.deleteMany(batchIds);
        
        console.log(`[RENAME FOLDER] Moved batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(allVectorIds.length / batchSize)}`);
      }

      // 3. Update manifest entries with new namespace (file paths in R2 don't change)
      // Files are stored as namespace/subfolderId/timestamp-filename where namespace is base namespace
      // and subfolderId doesn't change, so we only need to update the manifest namespace
      console.log(`[RENAME FOLDER] Updating manifest entries...`);
      const updatedManifest: DocumentManifest[] = manifest.map(doc => ({
        ...doc,
        namespace: newPineconeNamespace,
        // Keep the same r2Url and id since file paths don't change
      }));

      // 4. Create new manifest with updated namespace
      if (updatedManifest.length > 0) {
        await updateManifestInR2(newPineconeNamespace, updatedManifest);
        console.log(`[RENAME FOLDER] Created new manifest with ${updatedManifest.length} documents`);
      }

      // 5. Delete old manifest
      try {
        const deleteManifestCommand = new DeleteObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: `manifests/${oldPineconeNamespace}.json`,
        });
        await r2Client.send(deleteManifestCommand);
        console.log(`[RENAME FOLDER] Deleted old manifest`);
      } catch (error) {
        console.error(`[RENAME FOLDER] Error deleting old manifest:`, error);
      }
    } else {
      // No documents, just create empty manifest for new namespace
      await createInitialManifest(newPineconeNamespace);
    }

    // 6. Update database
    const updated = await prisma.subfolder.update({
      where: { id: subfolderId },
      data: {
        name: name.trim(),
        pineconeNamespace: newPineconeNamespace,
      },
    });

    console.log(`[RENAME FOLDER] Folder renamed successfully`);
    return NextResponse.json({ subfolder: updated });
  } catch (error) {
    console.error("Error updating subfolder:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}


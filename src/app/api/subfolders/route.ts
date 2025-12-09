import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";

const prisma = new PrismaClient();

// GET - List subfolders for a department and namespace type
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "DEPARTMENTADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const departmentId = searchParams.get("departmentId");
    const namespaceType = searchParams.get("namespaceType"); // "INTERNAL" or "EXTERNAL"

    if (!departmentId || !namespaceType) {
      return NextResponse.json(
        { message: "Missing departmentId or namespaceType" },
        { status: 400 }
      );
    }

    // Verify user has access to this department
    // Use email since session.user.id is not available in JWT strategy
    if (!session.user.email) {
      return NextResponse.json({ message: "User email not found" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { department: true },
    });

    if (!user?.departmentId || user.departmentId !== departmentId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    const subfolders = await prisma.subfolder.findMany({
      where: {
        departmentId,
        namespaceType: namespaceType as "INTERNAL" | "EXTERNAL",
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ subfolders });
  } catch (error) {
    console.error("Error fetching subfolders:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create a new subfolder
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "DEPARTMENTADMIN") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { name, departmentId, namespaceType } = await req.json();

    if (!name || !departmentId || !namespaceType) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate namespaceType
    if (namespaceType !== "INTERNAL" && namespaceType !== "EXTERNAL") {
      return NextResponse.json(
        { message: "Invalid namespaceType. Must be INTERNAL or EXTERNAL" },
        { status: 400 }
      );
    }

    // Verify user has access to this department
    // Use email since session.user.id is not available in JWT strategy
    if (!session.user.email) {
      return NextResponse.json({ message: "User email not found" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { department: true },
    });

    if (!user?.departmentId || user.departmentId !== departmentId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 403 });
    }

    // Get department to get the base namespace
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
    });

    if (!department) {
      return NextResponse.json(
        { message: "Department not found" },
        { status: 404 }
      );
    }

    // Get the base namespace based on type
    const baseNamespace =
      namespaceType === "INTERNAL"
        ? department.namespace
        : department.externalNamespace;

    if (!baseNamespace) {
      return NextResponse.json(
        { message: "Department namespace not configured" },
        { status: 400 }
      );
    }

    // Create Pinecone namespace: existing_namespace-subfolder_name
    const sanitizedName = name.replace(/[^a-zA-Z0-9]/g, "-");
    const pineconeNamespace = `${baseNamespace}-${sanitizedName}`;

    // Check if subfolder with same name already exists
    const existing = await prisma.subfolder.findFirst({
      where: {
        departmentId,
        namespaceType: namespaceType as "INTERNAL" | "EXTERNAL",
        name: name.trim(),
      },
    });

    if (existing) {
      return NextResponse.json(
        { message: "Subfolder with this name already exists" },
        { status: 400 }
      );
    }

    const subfolder = await prisma.subfolder.create({
      data: {
        name: name.trim(),
        departmentId,
        namespaceType: namespaceType as "INTERNAL" | "EXTERNAL",
        pineconeNamespace,
      },
    });

    return NextResponse.json({ subfolder });
  } catch (error) {
    console.error("Error creating subfolder:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const { name, companyId } = await req.json();
  if (!name || !companyId) {
    return NextResponse.json({ message: "Missing department name or companyId." }, { status: 400 });
  }
  // Check if department already exists for this company
  const existing = await prisma.department.findFirst({ where: { name, companyId } });
  if (existing) {
    return NextResponse.json({ message: "Department already exists for this company." }, { status: 400 });
  }
  // Get company name
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 400 });
  }
  // Get adminId from session
  const adminId = session?.user?.adminId || "unknown";
  // Generate namespace
  const namespace = `${company.name}_${name}_${adminId}`.replace(/\s+/g, "");
  const department = await prisma.department.create({
    data: { name, companyId, namespace },
    select: { id: true, name: true, namespace: true },
  });
  return NextResponse.json({ department });
} 
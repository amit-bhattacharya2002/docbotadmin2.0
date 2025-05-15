import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const companies = await prisma.company.findMany({ select: { name: true } });
  return NextResponse.json({ companies: companies.map((c) => c.name) });
} 
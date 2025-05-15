import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const { name, email, password, adminId, companyId, departmentId } = await req.json();
  console.log('Creating Department Admin:', { name, email, adminId, companyId, departmentId });
  if (!name || !email || !password || !adminId || !companyId || !departmentId) {
    return NextResponse.json({ message: "Missing required fields." }, { status: 400 });
  }
  // Check if user already exists by email
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ message: "A user with this email already exists." }, { status: 400 });
  }
  // Check if adminId already exists
  const existingAdminId = await prisma.user.findUnique({ where: { adminId } });
  if (existingAdminId) {
    return NextResponse.json({ message: "A user with this Admin ID already exists." }, { status: 400 });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      adminId,
      role: "DEPARTMENTADMIN",
      companyId,
      departmentId,
    },
    select: { id: true, name: true, email: true, role: true, companyId: true, departmentId: true },
  });
  console.log('Created Department Admin:', user);
  return NextResponse.json({ user });
} 
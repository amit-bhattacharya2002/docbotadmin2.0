import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return NextResponse.json({ message: "Invalid email or password.", success: false }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return NextResponse.json({ message: "Invalid email or password.", success: false }, { status: 401 });
  }

  // For now, just return user info (no session/cookie)
  return NextResponse.json({
    message: `Welcome, ${user.name}!`,
    success: true,
    role: user.role,
    name: user.name,
    companyId: user.companyId,
    departmentId: user.departmentId,
  });
} 
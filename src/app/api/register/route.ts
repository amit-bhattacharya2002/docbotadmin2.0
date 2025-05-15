import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const { name, email, password, adminId, role, department, company } = await req.json();

  if (role === "SUPERADMIN") {
    // Check if email is in AuthorizedAdmin collection
    const authorized = await prisma.authorizedAdmin.findUnique({ where: { email } });
    if (!authorized) {
      return NextResponse.json({ message: "Unauthorized: Email not found in AuthorizedAdmins." }, { status: 401 });
    }
    // Look up company by name
    const companyRecord = await prisma.company.findFirst({ where: { name: company } });
    if (!companyRecord) {
      return NextResponse.json({ message: "Selected company not found." }, { status: 400 });
    }
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.password && existingUser.password.length > 0) {
      return NextResponse.json({ message: "Account already registered. Please log in." }, { status: 400 });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Update existing SuperAdmin user or create if not exists
    let user = await prisma.user.findFirst({ where: { email, adminId, role: "SUPERADMIN" } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { name, password: hashedPassword, companyId: companyRecord.id },
      });
    } else {
      await prisma.user.create({
        data: { name, email, password: hashedPassword, adminId, role: "SUPERADMIN", companyId: companyRecord.id },
      });
    }
    return NextResponse.json({ message: "SuperAdmin registration successful! You can now log in." });
  } else if (role === "DEPARTMENTADMIN") {
    // Create a new DepartmentAdmin
    await prisma.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 10),
        adminId,
        role: "DEPARTMENTADMIN",
        // For now, just store department as a string (can be linked to Department model later)
      },
    });
    return NextResponse.json({ message: "Admin registration successful! You can now log in." });
  }

  return NextResponse.json({ message: "Invalid registration request." }, { status: 400 });
} 
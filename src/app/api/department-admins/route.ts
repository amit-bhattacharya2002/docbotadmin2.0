import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  
  // Check if user is authenticated and is a superadmin
  if (!session?.user || session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all departments with their admins
    const departments = await prisma.department.findMany({
      where: {
        companyId: session.user.companyId
      },
      include: {
        users: {
          where: {
            role: "DEPARTMENTADMIN"
          },
          select: {
            id: true,
            name: true,
            email: true,
            adminId: true
          }
        }
      }
    });

    // Transform the data into the expected format
    const departmentAdmins = departments.map(dept => ({
      departmentId: dept.id,
      departmentName: dept.name,
      admins: dept.users
    }));

    return NextResponse.json(departmentAdmins);
  } catch (error) {
    console.error("Error fetching department admins:", error);
    return NextResponse.json(
      { message: "Failed to fetch department admins" },
      { status: 500 }
    );
  }
} 
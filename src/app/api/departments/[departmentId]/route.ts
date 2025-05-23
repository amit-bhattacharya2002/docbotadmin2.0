import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";

const prisma = new PrismaClient();

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ departmentId: string }> }
): Promise<NextResponse> {
  const { departmentId } = await params;
  
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "SUPERADMIN") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const usersInDepartment = await prisma.user.findFirst({
      where: { departmentId },
    });

    if (usersInDepartment) {
      return NextResponse.json(
        {
          message:
            "Cannot delete department with associated users. Please remove or reassign users first.",
        },
        { status: 400 }
      );
    }

    await prisma.department.delete({ where: { id: departmentId } });
    return NextResponse.json({ message: "Department deleted successfully" });
  } catch (error) {
    console.error("Error deleting department:", error);
    return NextResponse.json(
      { message: "Failed to delete department" },
      { status: 500 }
    );
  }
} 
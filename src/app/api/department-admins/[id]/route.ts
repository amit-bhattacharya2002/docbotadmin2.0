import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await prisma.user.delete({
      where: { id },
    });
    return NextResponse.json({ message: 'Department admin deleted.' });
  } catch (error) {
    return NextResponse.json({ message: 'Failed to delete department admin.' }, { status: 500 });
  }
} 
import { PrismaClient } from '@prisma/client';
import SuperAdminDashboardClient from './SuperAdminDashboardClient';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../api/auth/authOptions';
import { redirect } from "next/navigation";

export default async function SuperAdminDashboard() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "SUPERADMIN") {
    redirect("/dashboard");
  }

  const prisma = new PrismaClient();
  let company = null;
  let departments: { id: string; name: string }[] = [];
  let departmentAdmins: { departmentId: string; departmentName: string; admins: { id: string; name: string; email: string; adminId: string }[] }[] = [];
  console.log('session:', session);
  console.log('session.user:', session?.user);
  if (session?.user?.companyId) {
    company = await prisma.company.findUnique({ where: { id: session.user.companyId } });
    if (company) {
      departments = await prisma.department.findMany({
        where: { companyId: company.id },
        select: { id: true, name: true },
      });
      // Fetch all Department Admins for this company, grouped by department
      const admins = await prisma.user.findMany({
        where: { companyId: company.id, role: 'DEPARTMENTADMIN' },
        select: { id: true, name: true, email: true, adminId: true, departmentId: true },
      });
      console.log('Fetched Department Admins:', admins);
      departmentAdmins = departments.map((dept) => ({
        departmentId: dept.id,
        departmentName: dept.name,
        admins: admins.filter((a) => a.departmentId === dept.id),
      }));
      console.log('Grouped Department Admins:', departmentAdmins);
    }
  }
  console.log('company:', company);
  console.log('departments:', departments);
  return <SuperAdminDashboardClient user={session?.user} company={company} departments={departments} departmentAdmins={departmentAdmins} />;
} 
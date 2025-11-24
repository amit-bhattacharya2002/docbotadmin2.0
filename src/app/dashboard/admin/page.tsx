import { getServerSession } from "next-auth";
import { authOptions } from "../../api/auth/authOptions";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import AdminDashboardClient from "./AdminDashboardClient";

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DEPARTMENTADMIN") {
    redirect("/dashboard");
  }

  const user = session.user;
  if (!user.adminId) {
    return <div className="text-red-500">Error: User adminId not found</div>;
  }

  let companyName = "";
  let departmentName = "";
  let internalNamespace = "";
  let externalNamespace = "";

  if (user.companyId || user.departmentId) {
    const prisma = new PrismaClient();
    if (user.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: user.companyId },
        select: { name: true },
      });
      if (company) {
        companyName = company.name;
      }
    }
    if (user.departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: user.departmentId },
        include: {
          company: { select: { name: true } },
        },
      });
      if (department) {
        departmentName = department.name;
        if (!department.namespace || !department.externalNamespace) {
          if (!companyName && department.company) {
            companyName = department.company.name;
          }
          const safeCompanyName = companyName.replace(/[^a-zA-Z0-9]/g, '_');
          const safeDepartmentName = department.name.replace(/[^a-zA-Z0-9]/g, '_');
          const newInternalNamespace = `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_Internal`;
          const newExternalNamespace = `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_External`;
          await prisma.department.update({
            where: { id: department.id },
            data: {
              namespace: newInternalNamespace,
              externalNamespace: newExternalNamespace,
            },
          });
          internalNamespace = newInternalNamespace;
          externalNamespace = newExternalNamespace;
        } else {
          internalNamespace = department.namespace;
          externalNamespace = department.externalNamespace;
        }
      }
    }
  }

  return (
    <AdminDashboardClient
      companyName={companyName}
      departmentName={departmentName}
      userName={user.name}
      internalNamespace={internalNamespace}
      externalNamespace={externalNamespace}
      companyId={user.companyId || ""}
      departmentId={user.departmentId || ""}
    />
  );
} 
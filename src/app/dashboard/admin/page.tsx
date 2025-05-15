import { getServerSession } from "next-auth";
import { authOptions } from "../../api/auth/authOptions";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import DepartmentAdminHeader from "./DepartmentAdminHeader";
import TabbedDocumentPanel from "./TabbedDocumentPanel";

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DEPARTMENTADMIN") {
    redirect("/dashboard");
  }

  const user = session.user;
  let companyName = user.companyId;
  let departmentName = user.departmentId;
  let namespace = "";
  if (user.companyId || user.departmentId) {
    const prisma = new PrismaClient();
    if (user.companyId) {
      const company = await prisma.company.findUnique({ where: { id: user.companyId } });
      if (company) companyName = company.name;
    }
    if (user.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: user.departmentId } });
      console.log(department)
      console.log("Server: departmentId", user.departmentId);
      console.log("Server: department record", department);
      if (department) {
        departmentName = department.name;
        namespace = department.namespace;
        console.log("Server: namespace", namespace);
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-700 flex flex-col">
      <DepartmentAdminHeader companyName={companyName} departmentName={departmentName} userName={user.name} />
      <div className="flex flex-col items-center justify-center flex-1 p-8 w-full">
        <TabbedDocumentPanel namespace={namespace} />
      </div>
    </div>
  );
} 
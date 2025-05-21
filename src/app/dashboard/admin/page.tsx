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
  console.log('Session user:', user);  // Debug log

  if (!user.adminId) {
    console.error('User adminId not found in session');
    return <div className="text-red-500">Error: User adminId not found</div>;
  }

  let companyName = "";
  let departmentName = "";
  let internalNamespace = "";
  let externalNamespace = "";
  
  if (user.companyId || user.departmentId) {
    const prisma = new PrismaClient();
    
    // Then get the company data
    if (user.companyId) {
      const company = await prisma.company.findUnique({ 
        where: { id: user.companyId },
        select: { name: true }
      });
      if (company) {
        companyName = company.name;
    }
    }
    
    // Then get the department data
    if (user.departmentId) {
      const department = await prisma.department.findUnique({ 
        where: { id: user.departmentId },
        include: {
          company: {
            select: { name: true }
          }
        }
      });
      
      if (department) {
        departmentName = department.name;
        // If namespaces are not set, generate them
        if (!department.namespace || !department.externalNamespace) {
          // Use company name from the department's company relation if not already set
          if (!companyName && department.company) {
            companyName = department.company.name;
          }
          
          // Format company name and department name to be URL-safe
          const safeCompanyName = companyName.replace(/[^a-zA-Z0-9]/g, '_');
          const safeDepartmentName = department.name.replace(/[^a-zA-Z0-9]/g, '_');
          
          const newInternalNamespace = `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_Internal`;
          const newExternalNamespace = `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_External`;
          
          console.log('Generating new namespaces:');
          console.log('Company:', companyName);
          console.log('Department:', department.name);
          console.log('Admin ID:', user.adminId);
          console.log('Internal:', newInternalNamespace);
          console.log('External:', newExternalNamespace);
          
          // Update the department with the namespaces
          await prisma.department.update({
            where: { id: department.id },
            data: {
              namespace: newInternalNamespace,
              externalNamespace: newExternalNamespace
            }
          });
          
          // Use the newly generated namespaces
          internalNamespace = newInternalNamespace;
          externalNamespace = newExternalNamespace;
        } else {
          // Use existing namespaces
          internalNamespace = department.namespace;
          externalNamespace = department.externalNamespace;
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <DepartmentAdminHeader companyName={companyName} departmentName={departmentName} userName={user.name} />
      <div className="flex flex-col items-center justify-center flex-1 p-8 w-full">
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-bold text-white mb-4">Internal Documents</h2>
            {internalNamespace ? (
              <TabbedDocumentPanel namespace={internalNamespace} />
            ) : (
              <div className="text-red-500 bg-white/10 rounded-2xl p-8">Internal namespace not configured for your department.</div>
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-4">External Documents</h2>
            {externalNamespace ? (
              <TabbedDocumentPanel namespace={externalNamespace} />
            ) : (
              <div className="text-red-500 bg-white/10 rounded-2xl p-8">External namespace not configured for your department.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 
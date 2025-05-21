import { PrismaClient } from '@prisma/client';

async function updateDepartmentNamespaces() {
  const prisma = new PrismaClient();
  
  try {
    // Get all departments
    const departments = await prisma.department.findMany();
    
    for (const dept of departments) {
      const internalNamespace = `${dept.name}_Internal`;
      const externalNamespace = `${dept.name}_External`;
      
      console.log(`Updating department: ${dept.name}`);
      console.log(`Internal namespace: ${internalNamespace}`);
      console.log(`External namespace: ${externalNamespace}`);
      
      await prisma.department.update({
        where: { id: dept.id },
        data: {
          namespace: internalNamespace,
          externalNamespace: externalNamespace
        }
      });
    }
    
    console.log('Successfully updated all department namespaces');
  } catch (error) {
    console.error('Error updating department namespaces:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateDepartmentNamespaces(); 
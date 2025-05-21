import { PrismaClient } from '@prisma/client';

async function setupUserDepartment() {
  const prisma = new PrismaClient();
  
  try {
    // First, find or create the company
    let company = await prisma.company.findFirst({
      where: { name: 'Simon Fraser University' }
    });
    
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'Simon Fraser University'
        }
      });
    }
    
    console.log('Company:', company.name);
    
    // Then, find or create the department
    let department = await prisma.department.findFirst({
      where: { 
        name: 'Student Services',
        companyId: company.id
      }
    });
    
    if (!department) {
      // Format company name and department name to be URL-safe
      const safeCompanyName = company.name.replace(/[^a-zA-Z0-9]/g, '_');
      const safeDepartmentName = 'Student_Services';
      
      // Get the user to get their adminId
      const user = await prisma.user.findFirst({
        where: { email: 'amit@sfu.ca' }
      });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      department = await prisma.department.create({
        data: {
          name: 'Student Services',
          companyId: company.id,
          namespace: `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_Internal`,
          externalNamespace: `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_External`
        }
      });
    } else if (!department.namespace || !department.externalNamespace) {
      // Format company name and department name to be URL-safe
      const safeCompanyName = company.name.replace(/[^a-zA-Z0-9]/g, '_');
      const safeDepartmentName = department.name.replace(/[^a-zA-Z0-9]/g, '_');
      
      // Get the user to get their adminId
      const user = await prisma.user.findFirst({
        where: { email: 'amit@sfu.ca' }
      });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      department = await prisma.department.update({
        where: { id: department.id },
        data: {
          namespace: `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_Internal`,
          externalNamespace: `${safeCompanyName}_${safeDepartmentName}_${user.adminId}_External`
        }
      });
    }
    
    console.log('Department:', department.name);
    console.log('Internal Namespace:', department.namespace);
    console.log('External Namespace:', department.externalNamespace);
    
    // Finally, update the user's association
    const user = await prisma.user.update({
      where: { email: 'amit@sfu.ca' },
      data: {
        companyId: company.id,
        departmentId: department.id
      }
    });
    
    console.log('\nUser updated successfully:');
    console.log('Name:', user.name);
    console.log('Email:', user.email);
    console.log('Role:', user.role);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupUserDepartment(); 
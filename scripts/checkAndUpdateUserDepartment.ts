import { PrismaClient } from '@prisma/client';

async function checkAndUpdateUserDepartment() {
  const prisma = new PrismaClient();
  
  try {
    // Get all department admin users
    const users = await prisma.user.findMany({
      where: {
        role: 'DEPARTMENTADMIN'
      },
      include: {
        department: true,
        company: true
      }
    });

    console.log('\nChecking Department Admin Users:');
    console.log('===============================');
    
    for (const user of users) {
      console.log(`\nUser: ${user.name} (${user.email})`);
      console.log(`Department: ${user.department?.name || 'None'}`);
      console.log(`Company: ${user.company?.name || 'None'}`);
      
      if (user.department) {
        const internalNamespace = `${user.department.name}_Internal`;
        const externalNamespace = `${user.department.name}_External`;
        
        console.log(`Current Internal Namespace: ${user.department.namespace}`);
        console.log(`Current External Namespace: ${user.department.externalNamespace}`);
        
        // Update namespaces if they're empty or incorrect
        if (!user.department.namespace || !user.department.externalNamespace) {
          console.log('\nUpdating namespaces...');
          await prisma.department.update({
            where: { id: user.department.id },
            data: {
              namespace: internalNamespace,
              externalNamespace: externalNamespace
            }
          });
          console.log('Namespaces updated successfully!');
        }
      } else {
        console.log('WARNING: User is not associated with any department!');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAndUpdateUserDepartment(); 
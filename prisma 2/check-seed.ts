import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSeed() {
  try {
    // Check companies
    const companies = await prisma.company.findMany();
    console.log('\nCompanies:', companies);

    // Check departments with their namespaces
    const departments = await prisma.department.findMany({
      include: {
        company: true
      }
    });
    console.log('\nDepartments with namespaces:');
    departments.forEach(dept => {
      console.log(`\nDepartment: ${dept.name}`);
      console.log(`Company: ${dept.company.name}`);
      console.log(`Internal Namespace: ${dept.namespace}`);
      console.log(`External Namespace: ${dept.externalNamespace}`);
    });

  } catch (error) {
    console.error('Error checking seed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSeed(); 
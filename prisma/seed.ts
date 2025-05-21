import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Seed AuthorizedAdmins
  await prisma.authorizedAdmin.deleteMany(); // Clear existing for idempotency
  await prisma.authorizedAdmin.createMany({
    data: [
      { email: 'alice@sfu.ca', name: 'Alice Smith', organizationId: 'SFU' },
      { email: 'bob@ubc.ca', name: 'Bob Johnson', organizationId: 'UBC' },
      { email: 'carol@douglascollege.ca', name: 'Carol White', organizationId: 'Douglas College' },
    ],
  });

  // Delete all departments before deleting companies
  await prisma.department.deleteMany();
  await prisma.company.deleteMany();

  // Seed Companies
  const companies = [
    { name: 'SFU' },
    { name: 'UBC' },
    { name: 'Douglas College' },
    { name: 'UFV' },
  ];
  const createdCompanies = await Promise.all(
    companies.map((company) => prisma.company.create({ data: company }))
  );

  // Seed Departments for each company
  const initialDepartments = [
    "Alumni Relations",
    "Finance",
    "Student Services",
  ];
  for (const company of createdCompanies) {
    for (const dept of initialDepartments) {
      const internalNamespace = `${company.name}_${dept}_1_Internal`.replace(/\s+/g, "");
      const externalNamespace = `${company.name}_${dept}_1_External`.replace(/\s+/g, "");
      await prisma.department.create({
        data: {
          name: dept,
          companyId: company.id,
          namespace: internalNamespace,
          externalNamespace: externalNamespace,
        },
      });
    }
  }

  // Update existing departments without both namespaces
  const allDepartments = await prisma.department.findMany({ include: { company: true } });
  for (const dept of allDepartments) {
    if (!dept.namespace || !dept.externalNamespace) {
      const internalNamespace = `${dept.company.name}_${dept.name}_1_Internal`.replace(/\s+/g, "");
      const externalNamespace = `${dept.company.name}_${dept.name}_1_External`.replace(/\s+/g, "");
      await prisma.department.update({
        where: { id: dept.id },
        data: { 
          namespace: internalNamespace,
          externalNamespace: externalNamespace,
        },
      });
    }
  }

  console.log('Seeded AuthorizedAdmins, Companies, and Departments!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 
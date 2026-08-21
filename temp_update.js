const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRaw`UPDATE "User" SET role = 'CUSTOMER' WHERE role = 'STAFF'`;
  await prisma.$executeRaw`UPDATE "User" SET "createdAsRole" = 'CUSTOMER' WHERE "createdAsRole" = 'STAFF'`;
}
main().catch(console.error).finally(() => prisma.$disconnect());

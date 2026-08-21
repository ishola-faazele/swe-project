import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { name: { contains: 'ade', mode: 'insensitive' } }
  });
  console.log(users);
}
main().catch(console.error).finally(() => prisma.$disconnect());

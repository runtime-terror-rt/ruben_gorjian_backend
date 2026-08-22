import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const usage = await prisma.usageMonthly.findMany();
  console.log("ALL USAGE ROWS:", usage);
}
main();

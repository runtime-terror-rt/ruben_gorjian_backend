import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const usage = await prisma.usageMonthly.findMany({
    where: { userId: 'cmsip825h0027z610c0ikubwm' } // I don't have the userId, let me find it
  });
  console.log(usage);
}
main();

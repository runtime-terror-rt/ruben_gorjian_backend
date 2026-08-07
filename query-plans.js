const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const plans = await prisma.plan.findMany();
  console.log(plans.map(p => ({ code: p.code, name: p.name })));
}
main().catch(console.error);

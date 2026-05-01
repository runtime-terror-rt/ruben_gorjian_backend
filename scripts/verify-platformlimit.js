const {PrismaClient} = require('@prisma/client');
(async()=>{
  const p = new PrismaClient();
  try {
    const plans = await p.plan.findMany({ select: { id: true, code: true, name: true, platformLimit: true } });
    console.log(JSON.stringify(plans, null, 2));
  } finally {
    await p.$disconnect();
  }
})();

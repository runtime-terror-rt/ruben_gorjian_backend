const {PrismaClient} = require('@prisma/client');
(async()=>{
  const p = new PrismaClient();
  try {
    const res = await p.$queryRawUnsafe(`
      SELECT a.attname as column_name
      FROM pg_attribute a
      WHERE a.attrelid = 'public."Plan"'::regclass
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `);
    console.log(res.map(r=>r.column_name));
  } catch (e) {
    console.error('error', e);
  } finally {
    await p.$disconnect();
  }
})();

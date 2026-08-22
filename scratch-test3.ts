import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const sub = await prisma.subscription.findUnique({ where: { id: 'cmsip825h0027z610c0ikubwm' } });
  const posts = await prisma.post.findMany({ where: { userId: sub!.userId }, select: { createdAt: true } });
  console.log("Post dates:", posts.map(p => p.createdAt));
}
main();

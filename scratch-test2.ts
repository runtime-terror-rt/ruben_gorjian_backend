import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const sub = await prisma.subscription.findUnique({ where: { id: 'cmsip825h0027z610c0ikubwm' } });
  if (!sub) {
    console.log("Sub not found");
    return;
  }
  const userId = sub.userId;
  const usage = await prisma.usageMonthly.findMany({ where: { userId } });
  console.log("USAGE:", usage);
  const posts = await prisma.post.findMany({ where: { userId } });
  console.log("POSTS:", posts.length);
  const onlinePosts = await prisma.scheduledPost.findMany({ where: { userId } });
  console.log("ONLINE POSTS:", onlinePosts.length);
}
main();

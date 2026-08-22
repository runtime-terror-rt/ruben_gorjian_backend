import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const userId = 'cmsip825h0027z610c0ikubwm';
  const periodStart = new Date("2026-08-07T08:46:09.000Z");
  const periodEnd = new Date("2026-09-07T08:46:09.000Z");

  const [postCount, scheduledPostCount] = await Promise.all([
    prisma.post.count({
      where: {
        userId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.scheduledPost.count({
      where: {
        userId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),
  ]);
  console.log("ACTUAL USED POSTS:", postCount + scheduledPostCount);
}
main();

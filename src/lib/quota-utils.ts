import { prisma } from "./prisma";

export async function getActualPostsUsed(userId: string, periodStart: Date, periodEnd: Date): Promise<number> {
  const [postCount, scheduledPostCount] = await Promise.all([
    prisma.post.count({
      where: {
        userId,
        createdAt: { gte: periodStart, lte: periodEnd },
        status: { not: "DRAFT" },
      },
    }),
    prisma.scheduledPost.count({
      where: {
        userId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    }),
  ]);
  return postCount + scheduledPostCount;
}

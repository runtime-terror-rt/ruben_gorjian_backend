import { prisma } from "../../lib/prisma";

const FOUNDER_CUTOFF = new Date("2026-06-30T23:59:59.999Z");
const MAX_FOUNDERS = 25;

export async function isFounderEligible(userId: string): Promise<boolean> {
  const today = new Date();
  if (today > FOUNDER_CUTOFF) return false;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (user?.isFounder) return true;

    // Lock only the Founder table to prevent concurrent over-allocation
    await tx.$executeRaw`LOCK TABLE "Founder" IN EXCLUSIVE MODE`;
    const founderCount = await tx.founder.count();
    return founderCount < MAX_FOUNDERS;
  });
}

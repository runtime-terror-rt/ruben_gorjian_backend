import { prisma } from "../../lib/prisma";

export async function hasExceededVerificationResendLimit(userId: string, maxPerHour = 3) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.auditLog.count({
    where: {
      action: "RESEND_VERIFICATION",
      targetUserId: userId,
      createdAt: { gte: oneHourAgo },
    },
  });

  return recentCount >= maxPerHour;
}

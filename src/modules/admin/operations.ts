import { AuditAction } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export async function getOrCreateAdminOperation(
  key: string,
  actorId: string,
  action: AuditAction,
  targetUserId?: string
) {
  try {
    return await prisma.adminOperation.create({
      data: {
        key,
        actorId,
        action,
        targetUserId,
      },
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.adminOperation.findUnique({ where: { key } });
      if (existing) return existing;
    }
    throw error;
  }
}

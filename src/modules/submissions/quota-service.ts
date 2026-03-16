import { Prisma, SubmissionPlanCategory, VisualQuotaEventType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/errors";
import { logger } from "../../lib/logger";

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{ include: { plan: true } }>;
type TxClient = Prisma.TransactionClient;

interface PeriodWindow {
  periodStart: Date;
  periodEnd: Date;
}

const UNLIMITED_QUOTA = 999999;

function getFallbackPeriod(now = new Date()): PeriodWindow {
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { periodStart, periodEnd };
}

export function getSubscriptionPeriod(subscription: SubscriptionWithPlan): PeriodWindow {
  if (subscription.currentPeriodStart && subscription.currentPeriodEnd) {
    return {
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    };
  }
  return getFallbackPeriod();
}

export function mapSubmissionPlanCategory(planCategory: string): SubmissionPlanCategory {
  if (planCategory === "FULL_MANAGEMENT" || planCategory === "JEWELRY_FULL_MANAGEMENT") {
    return SubmissionPlanCategory.FULL_MANAGEMENT;
  }
  return SubmissionPlanCategory.VISUAL_ONLY;
}

function getBaseQuota(subscription: SubscriptionWithPlan): number {
  const configuredQuota = subscription.plan?.baseVisualQuota ?? 0;
  if (configuredQuota > 0) {
    return configuredQuota;
  }
  // Allow submissions for plans without visual quotas (temporary Meta-approval fallback flow).
  return UNLIMITED_QUOTA;
}

async function ensureUsagePeriod(
  tx: TxClient,
  userId: string,
  periodStart: Date,
  periodEnd: Date
) {
  return tx.usageMonthly.upsert({
    where: {
      userId_periodStart_periodEnd: {
        userId,
        periodStart,
        periodEnd,
      },
    },
    update: {},
    create: {
      userId,
      periodStart,
      periodEnd,
      visualsUsed: 0,
      visualsReserved: 0,
      visualsBonus: 0,
      postsUsed: 0,
      platformsUsed: 0,
    },
  });
}

async function lockUsageRow(tx: TxClient, usageId: string) {
  await tx.$queryRaw`SELECT id FROM "UsageMonthly" WHERE id = ${usageId} FOR UPDATE`;
}

function calculateRemaining(baseQuota: number, bonus: number, used: number, reserved: number) {
  return Math.max(0, baseQuota + bonus - used - reserved);
}

export async function getVisualQuotaSnapshot(userId: string, subscription: SubscriptionWithPlan) {
  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
  const usage = await prisma.usageMonthly.findFirst({
    where: {
      userId,
      periodStart,
      periodEnd,
    },
  });

  const baseQuota = getBaseQuota(subscription);
  const bonusQuota = usage?.visualsBonus ?? 0;
  const used = usage?.visualsUsed ?? 0;
  const reserved = usage?.visualsReserved ?? 0;
  const remaining = calculateRemaining(baseQuota, bonusQuota, used, reserved);

  return {
    periodStart,
    periodEnd,
    baseQuota,
    bonusQuota,
    used,
    reserved,
    remaining,
  };
}

export async function reserveVisualQuota(
  tx: TxClient,
  params: {
    userId: string;
    subscription: SubscriptionWithPlan;
    units: number;
    submissionId: string;
  }
) {
  const { userId, subscription, units, submissionId } = params;
  if (units <= 0) return;

  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
  const usage = await ensureUsagePeriod(tx, userId, periodStart, periodEnd);
  await lockUsageRow(tx, usage.id);

  const locked = await tx.usageMonthly.findUnique({ where: { id: usage.id } });
  const baseQuota = getBaseQuota(subscription);
  const bonusQuota = locked?.visualsBonus ?? 0;
  const used = locked?.visualsUsed ?? 0;
  const reserved = locked?.visualsReserved ?? 0;
  const remaining = calculateRemaining(baseQuota, bonusQuota, used, reserved);

  if (remaining < units) {
    throw Errors.badRequest("Quota exceeded", {
      code: "quota_exceeded",
      remaining,
      requested: units,
    });
  }

  await tx.usageMonthly.update({
    where: { id: usage.id },
    data: { visualsReserved: { increment: units } },
  });

  await tx.visualQuotaLedger.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      units,
      eventType: VisualQuotaEventType.SUBMISSION_RESERVED,
      submissionId,
    },
  });
}

export async function adjustSubmissionReservation(
  tx: TxClient,
  params: {
    submissionId: string;
    userId: string;
    subscription: SubscriptionWithPlan;
    targetUnits: number;
  }
) {
  const { submissionId, userId, subscription, targetUnits } = params;
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
  });
  if (!submission) {
    throw Errors.notFound("Submission");
  }

  const currentReserved = submission.quotaUnitsReserved;
  if (targetUnits === currentReserved) return;

  const delta = targetUnits - currentReserved;
  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
  const usage = await ensureUsagePeriod(tx, userId, periodStart, periodEnd);
  await lockUsageRow(tx, usage.id);

  if (delta > 0) {
    const locked = await tx.usageMonthly.findUnique({ where: { id: usage.id } });
    const baseQuota = getBaseQuota(subscription);
    const bonusQuota = locked?.visualsBonus ?? 0;
    const used = locked?.visualsUsed ?? 0;
    const reserved = locked?.visualsReserved ?? 0;
    const remaining = calculateRemaining(baseQuota, bonusQuota, used, reserved);

    if (remaining < delta) {
      throw Errors.badRequest("Quota exceeded", {
        code: "quota_exceeded",
        remaining,
        requested: delta,
      });
    }

    await tx.usageMonthly.update({
      where: { id: usage.id },
      data: { visualsReserved: { increment: delta } },
    });

    await tx.visualQuotaLedger.create({
      data: {
        userId,
        periodStart,
        periodEnd,
        units: delta,
        eventType: VisualQuotaEventType.SUBMISSION_RESERVED,
        submissionId,
      },
    });
  } else {
    const releaseUnits = Math.abs(delta);
    await tx.usageMonthly.update({
      where: { id: usage.id },
      data: { visualsReserved: { decrement: releaseUnits } },
    });

    await tx.visualQuotaLedger.create({
      data: {
        userId,
        periodStart,
        periodEnd,
        units: releaseUnits,
        eventType: VisualQuotaEventType.SUBMISSION_RELEASED,
        submissionId,
      },
    });
  }

  await tx.submission.update({
    where: { id: submissionId },
    data: { quotaUnitsReserved: targetUnits },
  });
}

export async function consumeSubmissionQuota(
  tx: TxClient,
  params: {
    submissionId: string;
    userId: string;
    subscription: SubscriptionWithPlan;
  }
) {
  const { submissionId, userId, subscription } = params;
  const submission = await tx.submission.findUnique({ where: { id: submissionId } });
  if (!submission) {
    throw Errors.notFound("Submission");
  }

  if (submission.quotaUnitsConsumed >= submission.quotaUnitsReserved) {
    return;
  }

  const unitsToConsume = submission.quotaUnitsReserved - submission.quotaUnitsConsumed;
  if (unitsToConsume <= 0) return;

  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
  const usage = await ensureUsagePeriod(tx, userId, periodStart, periodEnd);
  await lockUsageRow(tx, usage.id);

  await tx.usageMonthly.update({
    where: { id: usage.id },
    data: {
      visualsUsed: { increment: unitsToConsume },
      visualsReserved: { decrement: unitsToConsume },
    },
  });

  await tx.submission.update({
    where: { id: submissionId },
    data: {
      quotaUnitsConsumed: { increment: unitsToConsume },
      quotaUnitsReserved: 0,
    },
  });

  await tx.visualQuotaLedger.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      units: unitsToConsume,
      eventType: VisualQuotaEventType.SUBMISSION_CONSUMED,
      submissionId,
    },
  });
}

export async function releaseSubmissionQuota(
  tx: TxClient,
  params: {
    submissionId: string;
    userId: string;
    subscription: SubscriptionWithPlan;
  }
) {
  const { submissionId, userId, subscription } = params;
  const submission = await tx.submission.findUnique({ where: { id: submissionId } });
  if (!submission) {
    throw Errors.notFound("Submission");
  }

  if (submission.quotaUnitsReserved <= 0) return;

  const unitsToRelease = submission.quotaUnitsReserved;
  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
  const usage = await ensureUsagePeriod(tx, userId, periodStart, periodEnd);
  await lockUsageRow(tx, usage.id);

  await tx.usageMonthly.update({
    where: { id: usage.id },
    data: { visualsReserved: { decrement: unitsToRelease } },
  });

  await tx.submission.update({
    where: { id: submissionId },
    data: { quotaUnitsReserved: 0 },
  });

  await tx.visualQuotaLedger.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      units: unitsToRelease,
      eventType: VisualQuotaEventType.SUBMISSION_RELEASED,
      submissionId,
    },
  });

  logger.info("Released reserved visual quota", {
    submissionId,
    userId,
    units: unitsToRelease,
  });
}

export async function creditVisualTopup(
  params: {
    userId: string;
    subscription: SubscriptionWithPlan;
    units: number;
    stripeEventId: string;
  }
) {
  const { userId, subscription, units, stripeEventId } = params;
  if (units <= 0) return;

  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);

  return prisma.$transaction(async (tx) => {
    const usage = await ensureUsagePeriod(tx, userId, periodStart, periodEnd);
    await lockUsageRow(tx, usage.id);

    try {
      await tx.visualQuotaLedger.create({
        data: {
          userId,
          periodStart,
          periodEnd,
          units,
          eventType: VisualQuotaEventType.TOPUP_CREDIT,
          stripeEventId,
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        logger.info("Stripe event already processed for top-up", { stripeEventId });
        return;
      }
      throw error;
    }

    await tx.usageMonthly.update({
      where: { id: usage.id },
      data: { visualsBonus: { increment: units } },
    });
  });
}

/**
 * Subscription Service
 * 
 * Handles subscription management logic, ensuring only one active subscription per user.
 * This service enforces the critical rule: A user can have ONLY ONE active plan at any time.
 */

import { prisma } from "../../lib/prisma";
import { Prisma, SubscriptionStatus } from "@prisma/client";
import { logger } from "../../lib/logger";

/**
 * Get the user's currently active subscription.
 * Active subscriptions are those with status ACTIVE or TRIALING.
 * 
 * @param userId - The user ID
 * @returns The active subscription or null if none exists
 */
export async function getActiveSubscription(userId: string) {
  return await prisma.subscription.findFirst({
    where: {
      userId,
      status: {
        in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
      },
    },
    include: {
      plan: true,
    },
    orderBy: {
      updatedAt: "desc", // Most recently updated active subscription takes precedence
    },
  });
}

/**
 * Deactivate all active subscriptions for a user except the one specified.
 * This ensures only one subscription remains active.
 * 
 * @param userId - The user ID
 * @param keepSubscriptionId - The subscription ID to keep active (optional)
 * @returns Number of subscriptions deactivated
 */
export async function deactivateOtherSubscriptions(
  userId: string,
  keepSubscriptionId?: string
): Promise<number> {
  const whereClause: Prisma.SubscriptionWhereInput = {
    userId,
    status: {
      in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
    },
  };

  if (keepSubscriptionId) {
    whereClause.id = { not: keepSubscriptionId };
  }

  const result = await prisma.subscription.updateMany({
    where: whereClause,
    data: {
      status: SubscriptionStatus.CANCELED,
      updatedAt: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info(
      `Deactivated ${result.count} subscription(s) for user ${userId}`,
      { keepSubscriptionId }
    );
  }

  return result.count;
}

/**
 * Ensure only one active subscription exists for a user.
 * If multiple active subscriptions are found, all but the most recently updated one are deactivated.
 * 
 * @param userId - The user ID
 * @param activeSubscriptionId - The subscription ID that should remain active
 * @returns The active subscription
 */
export async function ensureSingleActiveSubscription(
  userId: string,
  activeSubscriptionId: string
) {
  // Deactivate all other active subscriptions
  await deactivateOtherSubscriptions(userId, activeSubscriptionId);

  // Return the active subscription
  const active = await prisma.subscription.findUnique({
    where: { id: activeSubscriptionId },
    include: { plan: true },
  });

  if (!active) {
    throw new Error(`Subscription ${activeSubscriptionId} not found`);
  }

  if (
    active.status !== SubscriptionStatus.ACTIVE &&
    active.status !== SubscriptionStatus.TRIALING
  ) {
    throw new Error(
      `Subscription ${activeSubscriptionId} is not in an active state`
    );
  }

  return active;
}

/**
 * Log a plan change event for audit purposes.
 * 
 * @param userId - The user ID
 * @param oldPlanCode - The previous plan code (if any)
 * @param newPlanCode - The new plan code
 * @param reason - Reason for the change (e.g., "plan_switch", "checkout_completed", "webhook_update")
 */
export async function logPlanChange(
  userId: string,
  oldPlanCode: string | null,
  newPlanCode: string,
  reason: string
) {
  logger.info("Plan change logged", {
    userId,
    oldPlanCode,
    newPlanCode,
    reason,
    timestamp: new Date().toISOString(),
  });

  await prisma.planChangeLog.create({
    data: { userId, oldPlanCode, newPlanCode, reason },
  });
}


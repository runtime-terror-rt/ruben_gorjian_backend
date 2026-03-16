import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { PlanCategory } from "../types/plan-category";
import { logger } from "../lib/logger";

/**
 * Middleware to require Full Management plan access
 * Checks if user has an active subscription with FULL_MANAGEMENT category
 */
export async function requireFullManagement(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get user's active subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user.id,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    logger.info("Full Management access check", {
      userId: req.user.id,
      hasSubscription: !!subscription,
      planCategory: subscription?.plan?.category,
      subscriptionStatus: subscription?.status,
    });

    if (!subscription || !subscription.plan) {
      return res.status(403).json({
        error: "Full Management plan required",
        message: "This feature is only available to users with a Full Management plan.",
      });
    }

    // Check if plan category is FULL_MANAGEMENT or JEWELRY_FULL_MANAGEMENT
    const category = subscription.plan.category;
    const isFullManagement =
      category === PlanCategory.FULL_MANAGEMENT ||
      category === PlanCategory.JEWELRY_FULL_MANAGEMENT;

    if (!isFullManagement) {
      logger.warn("User attempted to access Full Management feature with incorrect plan", {
        userId: req.user.id,
        planCode: subscription.plan.code,
        planCategory: category,
        planName: subscription.plan.name,
      });

      return res.status(403).json({
        error: "Full Management plan required",
        message: "This feature is only available to users with a Full Management plan.",
        currentPlan: subscription.plan.name,
        currentCategory: category,
      });
    }

    // Attach subscription to request for later use
    req.subscription = subscription;

    return next();
  } catch (error) {
    logger.error("Error checking Full Management access:", error);
    return res.status(500).json({
      error: "Failed to verify plan access",
    });
  }
}

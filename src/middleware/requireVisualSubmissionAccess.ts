import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * Middleware to require an active or trialing subscription for submissions.
 */
export async function requireVisualSubmissionAccess(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user.id,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    logger.info("Visual submissions access check", {
      userId: req.user.id,
      hasSubscription: !!subscription,
      planCategory: subscription?.plan?.category,
      subscriptionStatus: subscription?.status,
    });

    if (!subscription || !subscription.plan) {
      return res.status(403).json({
        error: "Active subscription required",
        message: "This feature requires an active or trialing subscription.",
      });
    }

    req.subscription = subscription;
    return next();
  } catch (error) {
    logger.error("Error checking Visual submissions access:", error);
    return res.status(500).json({ error: "Failed to verify plan access" });
  }
}

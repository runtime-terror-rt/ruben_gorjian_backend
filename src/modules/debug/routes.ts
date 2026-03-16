import express from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * Debug endpoint to check user's subscription status
 * Helps diagnose submission access issues
 */
router.get("/subscription-status", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId,
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const activeSubscription = subscriptions.find(
      s => s.status === "ACTIVE" || s.status === "TRIALING"
    );

    return res.json({
      userId,
      userEmail: req.user!.email,
      totalSubscriptions: subscriptions.length,
      activeSubscription: activeSubscription ? {
        id: activeSubscription.id,
        status: activeSubscription.status,
        planCode: activeSubscription.planCode,
        planName: activeSubscription.plan.name,
        planCategory: activeSubscription.plan.category,
        isJewelry: activeSubscription.plan.isJewelry,
        currentPeriodStart: activeSubscription.currentPeriodStart,
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
      } : null,
      allSubscriptions: subscriptions.map(s => ({
        id: s.id,
        status: s.status,
        planCode: s.planCode,
        planName: s.plan.name,
        planCategory: s.plan.category,
        createdAt: s.createdAt,
      })),
      expectedCategories: {
        fullManagement: "FULL_MANAGEMENT",
        jewelryFullManagement: "JEWELRY_FULL_MANAGEMENT",
      },
      hasFullManagementAccess: activeSubscription ? (
        activeSubscription.plan.category === "FULL_MANAGEMENT" ||
        activeSubscription.plan.category === "JEWELRY_FULL_MANAGEMENT"
      ) : false,
    });
  } catch (error) {
    console.error("Error in subscription-status debug endpoint:", error);
    return res.status(500).json({
      error: "Failed to fetch subscription status",
    });
  }
});

export default router;

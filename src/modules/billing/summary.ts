import express from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { getActiveSubscription } from "./subscription-service";
import { getSubscriptionPeriod } from "../../lib/subscription-period";
import { stripeClient } from "./stripe";
import { SubscriptionStatus } from "@prisma/client";
import { extractStripePeriodBounds } from "./stripe-period";

const router = express.Router();

router.use(requireAuth);

router.get("/summary", async (req, res) => {
  const userId = req.user!.id;
  
  try {
    // First try to get active subscription (ACTIVE or TRIALING)
    let subscription = await getActiveSubscription(userId);

    // If no active subscription, check for any Stripe-backed subscription first.
    // This avoids selecting a newer INCOMPLETE placeholder row with no billing period.
    if (!subscription) {
      subscription = await prisma.subscription.findFirst({
        where: { userId, stripeSubscriptionId: { not: null } },
        include: {
          plan: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    }

    if (!subscription) {
      subscription = await prisma.subscription.findFirst({
        where: { userId },
        include: {
          plan: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    }

    if (!subscription) {
      return res.json({ currentPlan: null });
    }

    // If stripeSubscriptionId is missing but customer exists, recover subscription ID from Stripe.
    if (!subscription.stripeSubscriptionId && subscription.stripeCustomerId && stripeClient) {
      try {
        const stripeSubs = await stripeClient.subscriptions.list({
          customer: subscription.stripeCustomerId,
          status: "all",
          limit: 20,
        });

        const preferred =
          stripeSubs.data.find((s) => s.status === "active") ||
          stripeSubs.data.find((s) => s.status === "trialing") ||
          stripeSubs.data.find((s) => s.status === "past_due") ||
          stripeSubs.data[0];

        if (preferred) {
          subscription = await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              stripeSubscriptionId: preferred.id,
              updatedAt: new Date(),
            },
            include: { plan: true },
          });
        }
      } catch (err) {
        logger.warn("Failed to recover stripeSubscriptionId from customer in summary", {
          subscriptionId: subscription.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // If we don't have currentPeriodEnd in DB but have Stripe subscription, fetch from Stripe and persist
    let currentPeriodEnd: Date | null = subscription.currentPeriodEnd;
    if (!currentPeriodEnd && subscription.stripeSubscriptionId && stripeClient) {
      try {
        const stripeSub = await stripeClient.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );
        const { startUnix, endUnix } = extractStripePeriodBounds(stripeSub);
        const stripeStatus = (stripeSub as { status?: string }).status;

        let localStatus: SubscriptionStatus | undefined;
        switch (stripeStatus) {
          case "active":
            localStatus = SubscriptionStatus.ACTIVE;
            break;
          case "trialing":
            localStatus = SubscriptionStatus.TRIALING;
            break;
          case "past_due":
            localStatus = SubscriptionStatus.PAST_DUE;
            break;
          case "canceled":
          case "incomplete_expired":
            localStatus = SubscriptionStatus.CANCELED;
            break;
          default:
            localStatus = SubscriptionStatus.INCOMPLETE;
            break;
        }

        if (endUnix) {
          currentPeriodEnd = new Date(endUnix * 1000);
          subscription = await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: localStatus,
              currentPeriodEnd,
              currentPeriodStart: startUnix ? new Date(startUnix * 1000) : undefined,
              updatedAt: new Date(),
            },
            include: { plan: true },
          });
        } else if (localStatus && subscription.status !== localStatus) {
          subscription = await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: localStatus,
              updatedAt: new Date(),
            },
            include: { plan: true },
          });
        }
      } catch (err) {
        logger.warn("Failed to fetch current_period_end from Stripe for summary", {
          subscriptionId: subscription.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Get current month usage
    const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);

    const usage = await prisma.usageMonthly.findFirst({
      where: {
        userId,
        periodStart: { lte: periodStart },
        periodEnd: { gte: periodEnd },
      },
    });

    // Format response (expose current_period_end for renewal date; frontend prefers it)
    const currentPlan = {
      id: subscription.id,
      name: subscription.plan?.name ?? subscription.planCode,
      code: subscription.planCode,
      price: subscription.plan
        ? subscription.priceType === "FOUNDER"
          ? subscription.plan.priceFounderCents
          : subscription.plan.priceStandardCents
        : 0,
      currency: "usd",
      interval: "month",
      status: subscription.status,
      priceType: subscription.priceType,
      current_period_end: currentPeriodEnd
        ? Math.floor(new Date(currentPeriodEnd).getTime() / 1000)
        : null,
      renewsAt: currentPeriodEnd
        ? new Date(currentPeriodEnd).toLocaleDateString()
        : null,
      platformLimit:
        subscription.plan?.platformLimit !== null && subscription.plan?.platformLimit !== undefined
          ? subscription.plan.platformLimit + (subscription.addonPlatformQty ?? 0)
          : null,
      addonPlatformQty: subscription.addonPlatformQty ?? 0,
      videoAddonEnabled: subscription.videoAddonEnabled ?? false,
      postLimitType: subscription.plan?.postLimitType ?? "NONE",
      schedulerRole: subscription.plan?.schedulerRole ?? "CLIENT",
      visualQuota: subscription.plan?.baseVisualQuota ?? null,
      postQuota: subscription.plan?.basePostQuota ?? null,
      usage: {
        postsUsed: usage?.postsUsed ?? 0,
        visualsUsed: usage?.visualsUsed ?? 0,
        platformsUsed: usage?.platformsUsed ?? 0,
      },
    };

    res.json({ currentPlan });
  } catch (error) {
    logger.error("Error fetching billing summary", {
      error,
      userId: req.user!.id,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Unable to fetch billing summary" });
  }
});

router.get("/invoices", async (req, res) => {
  const userId = req.user!.id;
  
  try {
    // Get user's subscription to find Stripe customer ID
    const subscription = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    // If no Stripe subscription, return empty
    if (!subscription?.stripeCustomerId) {
      return res.json({ items: [] });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: "Stripe not configured" });
    }

    const stripe = new (require("stripe"))(process.env.STRIPE_SECRET_KEY);

    const invoices = await stripe.invoices.list({
      customer: subscription.stripeCustomerId,
      limit: 20,
    });

    const items = invoices.data.map((inv: any) => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_paid ?? inv.amount_due ?? 0,
      currency: inv.currency,
      status: inv.status,
      createdAt: new Date(inv.created * 1000).toISOString(),
      hostedInvoiceUrl: inv.hosted_invoice_url,
    }));

    res.json({ items });
  } catch (error) {
    logger.error("Error fetching invoices", error);
    res.status(500).json({ error: "Unable to fetch invoices" });
  }
});

export { router as billingSummaryRouter };

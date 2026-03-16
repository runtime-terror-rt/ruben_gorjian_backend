import express from "express";
import Stripe from "stripe";
import { PriceType, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { isFounderEligible } from "./founder";
import { stripeClient } from "./stripe";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import {
  getActiveSubscription,
  deactivateOtherSubscriptions,
  logPlanChange,
} from "./subscription-service";
import { toPostLimitType, toSchedulerRole } from "./plan-metadata";
import { extractStripePeriodBounds } from "./stripe-period";
import { upsertPlanFromPrice } from "./webhook";
import { mapStripeStatus, toPlanCategory } from "./billing-utils";
import { billingSyncRateLimiter } from "../../middleware/rateLimiter";

const router = express.Router();

router.get("/plans", async (_req, res) => {
  // Serve from DB first (populated by startup sync — avoids a live Stripe call per request)
  const dbPlans = await prisma.plan.findMany({ orderBy: { priceStandardCents: "asc" } });
  if (dbPlans.length > 0) {
    return res.json(dbPlans.map(serializePlan));
  }

  // DB empty — one-time fallback to Stripe (e.g. first boot before sync ran)
  if (stripeClient) {
    try {
      const products = await stripeClient.products.list({
        active: true,
        expand: ["data.default_price"],
        limit: 100,
      });

      const plans = products.data.map((product) => {
        const price = product.default_price as Stripe.Price | null;
        const metadata = product.metadata || {};
        return {
          code: metadata.code || product.id,
          name: product.name,
          category: toPlanCategory(metadata.category),
          description: product.description,
          isJewelry: metadata.isJewelry?.toLowerCase() === "true",
          platformLimit: metadata.platformLimit ? parseInt(metadata.platformLimit) : null,
          baseVisualQuota: metadata.baseVisualQuota ? parseInt(metadata.baseVisualQuota) : null,
          basePostQuota: metadata.basePostQuota ? parseInt(metadata.basePostQuota) : null,
          postLimitType: metadata.postLimitType || "NONE",
          schedulerRole: metadata.schedulerRole || "CLIENT",
          priceStandardCents: price?.unit_amount || 0,
          priceFounderCents: metadata.priceFounderCents ? parseInt(metadata.priceFounderCents) : price?.unit_amount || 0,
          hasYearlyPrice: false,
        };
      });

      return res.json(plans);
    } catch (error) {
      logger.error("Failed to fetch plans from Stripe", error);
    }
  }

  res.json([]);
});

router.post("/checkout", requireAuth, async (req, res) => {
  const schema = z.object({
    planCode: z.string(),
    billingCycle: z.enum(["monthly", "yearly"]).optional().default("monthly"),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { planCode, billingCycle } = parsed.data;
  const interval = billingCycle === "yearly" ? "year" : "month";

  // Find product in Stripe by code in metadata
  if (!stripeClient) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  const products = await stripeClient.products.list({
    active: true,
    expand: ["data.default_price"],
    limit: 100,
  });

  const product = products.data.find((p) => p.metadata.code === planCode);
  if (!product) {
    return res.status(404).json({ error: "Plan not found" });
  }

  const defaultPrice = product.default_price as Stripe.Price | null;
  if (!defaultPrice) {
    return res.status(400).json({ error: "Plan has no price configured" });
  }

  // Resolve the price to use for checkout (monthly or yearly)
  let price: Stripe.Price = defaultPrice;
  if (interval === "year") {
    const allPrices = await stripeClient.prices.list({
      product: product.id,
      active: true,
    });
    const yearlyPrice = allPrices.data.find((p) => p.recurring?.interval === "year");
    if (yearlyPrice) {
      price = yearlyPrice;
    } else {
      return res.status(400).json({
        error: "Yearly billing is not available for this plan. Please choose monthly.",
      });
    }
  }

  const userId = req.user!.id;
  const eligibleForFounder = await isFounderEligible(userId);
  const priceType = eligibleForFounder ? PriceType.FOUNDER : PriceType.STANDARD;

  // Use founder price if eligible and available (for the selected interval)
  let priceId = price.id;
  const founderCentsKey = interval === "year" ? "priceFounderYearlyCents" : "priceFounderCents";
  const founderCentsRaw = product.metadata[founderCentsKey];
  if (priceType === PriceType.FOUNDER && founderCentsRaw) {
    const founderPriceCents = parseInt(String(founderCentsRaw));
    const existingPrices = await stripeClient.prices.list({
      product: product.id,
      active: true,
    });

    const founderPrice = existingPrices.data.find(
      (p) => p.unit_amount === founderPriceCents && p.recurring?.interval === interval
    );

    if (founderPrice) {
      priceId = founderPrice.id;
    } else {
      const newFounderPrice = await stripeClient.prices.create(
        {
          product: product.id,
          unit_amount: founderPriceCents,
          currency: "usd",
          recurring: { interval },
          metadata: { priceType: "founder" },
        },
        { idempotencyKey: `founder-price-${product.id}-${interval}-${founderPriceCents}` }
      );
      priceId = newFounderPrice.id;
    }
  }

  // Ensure plan exists in local DB for FK (always use monthly/default price for plan record)
  const planPayload = {
    code: planCode,
    name: product.name,
    category: toPlanCategory(product.metadata.category),
    isJewelry: (product.metadata.isJewelry || "").toLowerCase() === "true",
    platformLimit: product.metadata.platformLimit ? parseInt(product.metadata.platformLimit) : null,
    baseVisualQuota: product.metadata.baseVisualQuota ? parseInt(product.metadata.baseVisualQuota) : null,
    basePostQuota: product.metadata.basePostQuota ? parseInt(product.metadata.basePostQuota) : null,
    postLimitType: toPostLimitType(product.metadata.postLimitType),
    schedulerRole: toSchedulerRole(product.metadata.schedulerRole),
    priceStandardCents: defaultPrice.unit_amount ?? 0,
    priceFounderCents: product.metadata.priceFounderCents
      ? parseInt(product.metadata.priceFounderCents)
      : defaultPrice.unit_amount ?? 0,
    stripePriceStandardId: defaultPrice.id,
  };

  await prisma.plan.upsert({
    where: { code: planCode },
    update: planPayload,
    create: planPayload,
  });

  // Check if user has an active subscription to a different plan
  const activeSubscription = await getActiveSubscription(userId);
  const isPlanSwitch = activeSubscription && activeSubscription.planCode !== planCode;

  // Handle plan switching: cancel old subscription in Stripe if switching plans
  // OR cancel default/free plan subscriptions (those without Stripe subscription ID)
  if (isPlanSwitch) {
    // If the active subscription has no Stripe subscription ID, it's a default/free plan
    // Cancel it before creating the new paid subscription
    if (!activeSubscription.stripeSubscriptionId) {
      await prisma.subscription.update({
        where: { id: activeSubscription.id },
        data: {
          status: SubscriptionStatus.CANCELED,
          updatedAt: new Date(),
        },
      });
      // Continue to create new checkout session below (don't return early)
    } else if (activeSubscription.stripeSubscriptionId) {
      try {
        // Check if we should update the subscription or cancel it
        // Stripe supports subscription updates (plan switching) which handles proration automatically
        const stripeSub = await stripeClient.subscriptions.retrieve(
          activeSubscription.stripeSubscriptionId
        );

      if (stripeSub.status === "active" || stripeSub.status === "trialing") {
        // Update existing subscription to new plan (Stripe handles proration)
        // This is the preferred method as it maintains billing continuity
        try {
          await stripeClient.subscriptions.update(activeSubscription.stripeSubscriptionId, {
            items: [
              {
                id: stripeSub.items.data[0].id,
                price: priceId,
              },
            ],
            metadata: {
              userId,
              planCode,
              priceType,
              switchedFrom: activeSubscription.planCode,
            },
            proration_behavior: "create_prorations",
          });

          logger.info(
            `Updated Stripe subscription ${activeSubscription.stripeSubscriptionId} to plan ${planCode}`,
            { userId, oldPlan: activeSubscription.planCode, newPlan: planCode }
          );

          // Update local subscription record
          await prisma.subscription.update({
            where: { id: activeSubscription.id },
            data: {
              planCode,
              priceType,
              status: SubscriptionStatus.ACTIVE,
              updatedAt: new Date(),
            },
          });

          // Log plan change
          await logPlanChange(userId, activeSubscription.planCode, planCode, "plan_switch_checkout");

          // Return success - no checkout needed since we updated the subscription
          return res.json({
            success: true,
            message: "Plan switched successfully",
            planCode,
            priceType,
            // Optionally redirect to billing page instead of checkout
            redirectUrl: `${env.FRONTEND_URL}/dashboard/billing`,
          });
        } catch (updateError) {
          logger.warn(
            "Failed to update Stripe subscription, falling back to new checkout",
            updateError
          );
          // Fall through to create new checkout session
        }
      } else {
        // Subscription is not active, cancel it in our DB
        await prisma.subscription.update({
          where: { id: activeSubscription.id },
          data: {
            status: SubscriptionStatus.CANCELED,
            updatedAt: new Date(),
          },
        });
      }
      } catch (error) {
        logger.error("Error handling plan switch in Stripe", error);
        // Cancel the old Stripe subscription so the user is not double-billed
        if (activeSubscription.stripeSubscriptionId) {
          try {
            await stripeClient.subscriptions.cancel(activeSubscription.stripeSubscriptionId);
          } catch (cancelError) {
            logger.error("Failed to cancel old subscription after plan-switch error", cancelError);
          }
        }
        // Mark the old local record as canceled before creating a new checkout
        await prisma.subscription.update({
          where: { id: activeSubscription.id },
          data: { status: SubscriptionStatus.CANCELED, updatedAt: new Date() },
        });
      }
    }
  }

  // Guard: Prevent duplicate checkout for the same plan
  if (activeSubscription && activeSubscription.planCode === planCode) {
    if (
      activeSubscription.status === SubscriptionStatus.ACTIVE ||
      activeSubscription.status === SubscriptionStatus.TRIALING
    ) {
      return res.json({
        alreadySubscribed: true,
        currentPlan: activeSubscription.planCode,
      });
    }
  }

  // Get or create Stripe customer
  let stripeCustomerId: string | undefined;
  const existingSubscription = await prisma.subscription.findFirst({
    where: { userId, status: SubscriptionStatus.INCOMPLETE },
    orderBy: { createdAt: "desc" },
  });

  if (existingSubscription?.stripeCustomerId) {
    stripeCustomerId = existingSubscription.stripeCustomerId;
  } else {
    // Create Stripe customer if needed
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.email) {
      try {
        const customer = await stripeClient.customers.create({
          email: user.email,
          metadata: { userId },
        });
        stripeCustomerId = customer.id;
      } catch (error) {
        logger.error("Failed to create Stripe customer", error);
      }
    }
  }

  // Create or update subscription record in INCOMPLETE state
  // This will be updated to ACTIVE when checkout completes via webhook
  let subscriptionRecord;
  if (existingSubscription && !isPlanSwitch) {
    // Update existing incomplete subscription
    subscriptionRecord = await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: {
        planCode,
        priceType,
        status: SubscriptionStatus.INCOMPLETE,
        stripeCustomerId: stripeCustomerId || existingSubscription.stripeCustomerId,
        updatedAt: new Date(),
      },
    });
  } else {
    // Create new subscription record
    subscriptionRecord = await prisma.subscription.create({
      data: {
        userId,
        planCode,
        priceType,
        status: SubscriptionStatus.INCOMPLETE,
        stripeCustomerId,
      },
    });
  }

  // Create Stripe checkout session
  const session = await stripeClient.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    success_url: `${env.FRONTEND_URL}/billing/success`,
    cancel_url: `${env.FRONTEND_URL}/billing/cancel`,
    subscription_data: {
      metadata: {
        userId,
        planCode,
        priceType,
        subscriptionId: subscriptionRecord.id,
        ...(isPlanSwitch ? { switchedFrom: activeSubscription?.planCode } : {}),
      },
    },
    metadata: {
      userId,
      planCode,
      priceType,
      subscriptionId: subscriptionRecord.id,
      ...(isPlanSwitch ? { switchedFrom: activeSubscription?.planCode } : {}),
    },
  });

  return res.json({ checkoutUrl: session.url, priceType });
});

router.post("/visual-topups/checkout", requireAuth, async (req, res) => {
  const schema = z.object({
    quantity: z.coerce.number().int().min(1).max(10).optional(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (!stripeClient || !env.STRIPE_VISUAL_TOPUP_PRICE_ID) {
    return res.status(503).json({ error: "Stripe top-ups not configured" });
  }

  const userId = req.user!.id;
  const subscription = await getActiveSubscription(userId);
  if (!subscription) {
    return res.status(403).json({ error: "Active subscription required" });
  }
  if (!subscription.plan?.baseVisualQuota) {
    return res.status(403).json({ error: "Visual quota not available for this plan" });
  }

  const quantity = parsed.data.quantity ?? 1;
  const price = await stripeClient.prices.retrieve(env.STRIPE_VISUAL_TOPUP_PRICE_ID, {
    expand: ["product"],
  });

  const product = price.product as Stripe.Product | null;
  const unitsPerPack = price.metadata.visualUnits
    ? parseInt(price.metadata.visualUnits)
    : product?.metadata?.visualUnits
    ? parseInt(product.metadata.visualUnits)
    : env.STRIPE_VISUAL_TOPUP_UNITS;

  if (!unitsPerPack || Number.isNaN(unitsPerPack)) {
    return res.status(500).json({ error: "Top-up units not configured" });
  }

  const totalUnits = unitsPerPack * quantity;

  const session = await stripeClient.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: price.id, quantity }],
    ...(subscription.stripeCustomerId ? { customer: subscription.stripeCustomerId } : {}),
    success_url: parsed.data.successUrl ?? `${env.FRONTEND_URL}/dashboard/submissions?topup=success`,
    cancel_url: parsed.data.cancelUrl ?? `${env.FRONTEND_URL}/dashboard/submissions?topup=cancel`,
    metadata: {
      userId,
      type: "visual_topup",
      topupUnits: unitsPerPack.toString(),
      topupQuantity: quantity.toString(),
      topupTotalUnits: totalUnits.toString(),
    },
  });

  return res.json({
    checkoutUrl: session.url,
    units: totalUnits,
  });
});

// Stripe Customer Portal session
router.post("/portal", requireAuth, async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({ error: "Stripe not configured" });
  }
  const stripe = stripeClient;

  const userId = req.user!.id;
  const subscription = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  let stripeCustomerId = subscription?.stripeCustomerId;

  // Attempt to recover customer ID from Stripe if missing but we have a subscription ID
  if (!stripeCustomerId && subscription?.stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      stripeCustomerId = String(stripeSub.customer);
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeCustomerId },
      });
    } catch (error) {
      logger.warn("Failed to recover Stripe customer from subscription", error);
    }
  }

  // As a fallback, create a customer if we have a user record but no customer yet
  if (!stripeCustomerId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(400).json({ error: "No user found for portal" });
    }
    try {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;
      if (subscription) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { stripeCustomerId },
        });
      }
    } catch (error) {
      logger.error("Failed to create Stripe customer for portal", error);
      return res.status(400).json({ error: "No Stripe customer found for this user" });
    }
  }

  const createPortalSession = async (customerId: string) => {
    return stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: env.FRONTEND_URL || env.APP_URL || "http://localhost:3000/dashboard/billing",
    });
  };

  try {
    const session = await createPortalSession(stripeCustomerId);
    return res.json({ url: session.url });
  } catch (error) {
    const err = error as Error & { code?: string };
    const isNoSuchCustomer =
      err instanceof Error &&
      (String(err.message).includes("No such customer") || err.code === "resource_missing");

    if (isNoSuchCustomer && subscription) {
      logger.warn("Stripe customer ID in DB not found; attempting recovery by email", {
        userId,
        oldCustomerId: stripeCustomerId,
      });
      await prisma.subscription.updateMany({
        where: { userId, stripeCustomerId },
        data: { stripeCustomerId: null },
      });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(400).json({ error: "No user found for portal" });
      }
      try {
        // Try to find existing Stripe customer by email so we keep invoice history
        let recoveredCustomerId: string | null = null;
        if (user.email) {
          const existing = await stripe.customers.list({
            email: user.email,
            limit: 1,
          });
          if (existing.data.length > 0) {
            recoveredCustomerId = existing.data[0].id;
            logger.info("Recovered Stripe customer by email for portal", {
              userId,
              email: user.email,
              customerId: recoveredCustomerId,
            });
          }
        }
        const customerId =
          recoveredCustomerId ||
          (await stripe.customers.create({
            email: user.email || undefined,
            metadata: { userId },
          })).id;
        await prisma.subscription.updateMany({
          where: { userId },
          data: { stripeCustomerId: customerId },
        });
        const retrySession = await createPortalSession(customerId);
        return res.json({ url: retrySession.url });
      } catch (createError) {
        logger.error("Failed to recover or create Stripe customer after invalid ID", createError);
        return res.status(500).json({ error: "Unable to create portal session" });
      }
    }

    logger.error("Failed to create billing portal session", error);
    return res.status(500).json({ error: "Unable to create portal session" });
  }
});

// Manual sync endpoint - syncs subscription status from Stripe
// Useful if webhooks are delayed or failed
router.post("/sync", requireAuth, billingSyncRateLimiter, async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  const userId = req.user!.id;

  try {
    // Get user's subscription - try to find one with stripeSubscriptionId first
    let subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        stripeSubscriptionId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
    });

    // If no subscription with stripeSubscriptionId, get the most recent one
    if (!subscription) {
      subscription = await prisma.subscription.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!subscription) {
      return res.status(404).json({ error: "No subscription found" });
    }

    // If subscription doesn't have stripeSubscriptionId, try to find it from Stripe customer
    if (!subscription.stripeSubscriptionId && subscription.stripeCustomerId) {
      try {
        const subscriptions = await stripeClient.subscriptions.list({
          customer: subscription.stripeCustomerId,
          status: "all",
          limit: 1,
        });

        if (subscriptions.data.length > 0) {
          const stripeSub = subscriptions.data[0];
          // Update subscription with stripeSubscriptionId
          subscription = await prisma.subscription.update({
            where: { id: subscription.id },
            data: { stripeSubscriptionId: stripeSub.id },
          });
        }
      } catch (err) {
        logger.warn("Failed to find Stripe subscription from customer", err);
      }
    }

    if (!subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: "No Stripe subscription found. Please wait for webhook to process." });
    }

    // Retrieve subscription from Stripe
    const stripeSub = await stripeClient.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
      {
        expand: ["items.data.price.product"],
      }
    );

    const item = stripeSub.items.data[0];
    const planInfo = await upsertPlanFromPrice(item?.price as Stripe.Price | undefined);

    if (!planInfo) {
      return res.status(400).json({ error: "Unable to determine plan from Stripe" });
    }

    const status = mapStripeStatus(stripeSub.status);
    const { startUnix, endUnix } = extractStripePeriodBounds(stripeSub);
    const currentPeriodStart = startUnix ? new Date(startUnix * 1000) : undefined;
    const currentPeriodEnd = endUnix ? new Date(endUnix * 1000) : undefined;
    const cancelAtPeriodEnd = (stripeSub as any).cancel_at_period_end || false;

    // Update subscription
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status,
          planCode: planInfo.planCode,
          priceType: planInfo.priceType,
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          stripeCustomerId: String(stripeSub.customer),
          updatedAt: new Date(),
        },
      });

      // Deactivate other active subscriptions
      if (status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING) {
        await tx.subscription.updateMany({
          where: {
            userId,
            id: { not: subscription.id },
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
            },
          },
          data: {
            status: SubscriptionStatus.CANCELED,
            updatedAt: new Date(),
          },
        });
      }
    });

    return res.json({
      success: true,
      message: "Subscription synced successfully",
      status,
      planCode: planInfo.planCode,
    });
  } catch (error) {
    logger.error("Error syncing subscription", error);
    return res.status(500).json({ error: "Unable to sync subscription" });
  }
});


export { router as billingRouter };

function serializePlan(plan: {
  code: string;
  name: string;
  category: string;
  isJewelry: boolean;
  platformLimit: number | null;
  baseVisualQuota: number | null;
  basePostQuota: number | null;
  postLimitType?: string | null;
  schedulerRole?: string | null;
  priceStandardCents: number;
  priceFounderCents: number;
  hasYearlyPrice?: boolean;
}) {
  return {
    code: plan.code,
    name: plan.name,
    category: plan.category,
    isJewelry: plan.isJewelry,
    platformLimit: plan.platformLimit,
    baseVisualQuota: plan.baseVisualQuota,
    basePostQuota: plan.basePostQuota,
    postLimitType: plan.postLimitType || "NONE",
    schedulerRole: plan.schedulerRole || "CLIENT",
    priceStandardCents: plan.priceStandardCents,
    priceFounderCents: plan.priceFounderCents,
    hasYearlyPrice: plan.hasYearlyPrice ?? false,
  };
}

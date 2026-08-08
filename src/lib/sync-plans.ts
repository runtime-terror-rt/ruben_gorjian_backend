import { stripeClient } from "../modules/billing/stripe";
import { prisma } from "./prisma";
import { logger } from "./logger";
import Stripe from "stripe";
import { upsertPlanFromPrice } from "../modules/billing/webhook";
import { toPlanCategory } from "../modules/billing/billing-utils";

const STARTUP_PLAN_CODES = ["ESSENTIALS", "SIGNATURE"] as const;

function buildPlanMetadata(plan: {
  code: string;
  name: string;
  category: string;
  isJewelry: boolean;
  platformLimit: number | null;
  platformQty: number;
  baseVisualQuota: number | null;
  basePostQuota: number | null;
  postLimitType: string;
  schedulerRole: string;
  priceStandardCents: number;
  priceFounderCents: number;
}) {
  return {
    code: plan.code,
    name: plan.name,
    category: plan.category,
    isJewelry: String(plan.isJewelry),
    platformLimit: String(plan.platformLimit ?? plan.platformQty),
    platformQty: String(plan.platformQty),
    baseVisualQuota: plan.baseVisualQuota != null ? String(plan.baseVisualQuota) : "",
    basePostQuota: plan.basePostQuota != null ? String(plan.basePostQuota) : "",
    postLimitType: plan.postLimitType,
    schedulerRole: plan.schedulerRole,
    priceStandardCents: String(plan.priceStandardCents),
    priceFounderCents: String(plan.priceFounderCents),
  };
}

async function findStripeProductForPlan(products: Stripe.Product[], planCode: string, planName: string) {
  const normalizedPlanCode = planCode.trim().toUpperCase();
  return (
    products.find((product) => (product.metadata?.code || "").toUpperCase() === normalizedPlanCode) ||
    products.find((product) => product.name.trim().toLowerCase() === planName.trim().toLowerCase()) ||
    null
  );
}

async function ensureStripePrice(params: {
  productId: string;
  recurringInterval: "month" | "year";
  unitAmount: number;
  currency?: string;
  metadata?: Record<string, string>;
}) {
  if (!stripeClient) {
    throw new Error("Stripe not configured");
  }

  const prices = await stripeClient.prices.list({
    product: params.productId,
    active: true,
    limit: 100,
  });

  const matchingPrice = prices.data.find(
    (price) =>
      price.recurring?.interval === params.recurringInterval &&
      price.unit_amount === params.unitAmount &&
      price.currency === (params.currency || "usd") &&
      (price.tax_behavior ?? "exclusive") === "exclusive"
  );

  if (matchingPrice) {
    return matchingPrice;
  }

  return stripeClient.prices.create({
    product: params.productId,
    unit_amount: params.unitAmount,
    currency: params.currency || "usd",
    recurring: { interval: params.recurringInterval },
    tax_behavior: "exclusive",
    metadata: params.metadata,
  });
}

/**
 * Sync the canonical app plans from the local database into Stripe on startup.
 * This creates or updates the Stripe products and ensures exclusive monthly/yearly prices exist.
 */
export async function syncPlansToStripeFromDatabase() {
  if (!stripeClient) {
    logger.warn("Stripe not configured, skipping Stripe plan bootstrap");
    return;
  }

  try {
    const plans = await prisma.plan.findMany({
      where: {
        code: { in: STARTUP_PLAN_CODES as unknown as string[] },
        isCustomEnterprise: false,
      },
      orderBy: { priceStandardCents: "asc" },
    });

    if (plans.length === 0) {
      logger.warn("No startup plans found in database, skipping Stripe bootstrap");
      return;
    }

    const products = await stripeClient.products.list({
      active: true,
      expand: ["data.default_price"],
      limit: 100,
    });

    let createdCount = 0;
    let updatedCount = 0;

    for (const plan of plans) {
      const metadata = buildPlanMetadata(plan);
      const existingProduct = await findStripeProductForPlan(products.data, plan.code, plan.name);

      let product: Stripe.Product;
      if (!existingProduct) {
        product = await stripeClient.products.create({
          name: plan.name,
          description: plan.name,
          metadata,
        });
        createdCount++;
        logger.info("Created Stripe product from local plan", { planCode: plan.code, productId: product.id });
      } else {
        product = existingProduct;
        await stripeClient.products.update(product.id, {
          name: plan.name,
          description: plan.name,
          metadata,
        });
        updatedCount++;
        logger.debug("Updated Stripe product metadata from local plan", { planCode: plan.code, productId: product.id });
      }

      const monthlyPrice = await ensureStripePrice({
        productId: product.id,
        recurringInterval: "month",
        unitAmount: plan.priceStandardCents,
        metadata: {
          interval: "month",
          planCode: plan.code,
          source: "talexia_startup_bootstrap",
        },
      });

      if (product.default_price !== monthlyPrice.id) {
        await stripeClient.products.update(product.id, { default_price: monthlyPrice.id });
        updatedCount++;
      }

      if (plan.hasYearlyPrice) {
        const yearlyUnitAmount = Math.round(plan.priceStandardCents * 12 * 0.8);
        await ensureStripePrice({
          productId: product.id,
          recurringInterval: "year",
          unitAmount: yearlyUnitAmount,
          metadata: {
            interval: "year",
            planCode: plan.code,
            source: "talexia_startup_bootstrap",
          },
        });
      }
    }

    logger.info("Stripe plan bootstrap completed", {
      createdCount,
      updatedCount,
      totalPlans: plans.length,
    });
  } catch (error) {
    logger.error("Failed to bootstrap Stripe plans from database", error);
  }
}

/**
 * Syncs all active plans from Stripe to the database.
 * This ensures the database always has the latest plan information from Stripe.
 * Called on server startup to keep plans in sync.
 */
export async function syncPlansFromStripe() {
  if (!stripeClient) {
    logger.warn("Stripe not configured, skipping plan sync");
    return;
  }

  try {
    logger.info("Starting plan sync from Stripe to database...");
    
    const products = await stripeClient.products.list({
      active: true,
      expand: ["data.default_price"],
      limit: 100,
    });

    logger.info(`Found ${products.data.length} active products in Stripe`);

    let syncedCount = 0;
    let skippedCount = 0;

    for (const product of products.data) {
      const price = product.default_price as Stripe.Price | null;
      if (!price) {
        logger.warn(`Product ${product.id} (${product.name}) has no default price, skipping`);
        skippedCount++;
        continue;
      }

      try {
        const planInfo = await upsertPlanFromPrice(price);
        if (!planInfo) {
          skippedCount++;
          continue;
        }

        // Check if a yearly price exists for this product
        const allPrices = await stripeClient.prices.list({ product: product.id, active: true });
        const hasYearlyPrice = allPrices.data.some((p) => p.recurring?.interval === "year");

        // Store the validated category and yearly-price flag
        await prisma.plan.update({
          where: { code: planInfo.planCode },
          data: {
            category: toPlanCategory(product.metadata?.category),
            hasYearlyPrice,
          },
        });

        syncedCount++;
        logger.debug(`Synced plan: ${planInfo.planCode} (${product.name})`);
      } catch (error) {
        logger.error(`Failed to sync plan for product ${product.id}`, error);
        skippedCount++;
      }
    }

    logger.info(
      `Plan sync completed: ${syncedCount} synced, ${skippedCount} skipped, ${products.data.length} total`
    );
  } catch (error) {
    logger.error("Failed to sync plans from Stripe", error);
    // Don't throw - allow server to start even if sync fails
  }
}



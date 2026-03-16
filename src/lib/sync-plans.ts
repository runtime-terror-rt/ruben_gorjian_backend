import { stripeClient } from "../modules/billing/stripe";
import { prisma } from "./prisma";
import { logger } from "./logger";
import Stripe from "stripe";
import { upsertPlanFromPrice } from "../modules/billing/webhook";
import { toPlanCategory } from "../modules/billing/billing-utils";

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



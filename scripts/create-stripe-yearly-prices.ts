/**
 * Create yearly recurring prices for all Stripe products that have a monthly price.
 * Yearly amount = 80% of monthly × 12 (e.g. $15/mo → $144/year).
 *
 * - Skips products that already have a yearly price.
 * - Adds product metadata priceFounderYearlyCents when priceFounderCents exists (founder yearly = 80% × 12 × founder monthly).
 *
 * Run: npm run stripe:yearly-prices
 * Requires: STRIPE_SECRET_KEY in .env
 */

import "dotenv/config";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is required. Set it in .env");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

/** Yearly = 80% of monthly × 12 */
const YEARLY_MULTIPLIER = 12 * 0.8;

async function main() {
  console.log("=== Talexia: Create yearly prices (80% of monthly × 12) ===\n");

  const products = await stripe.products.list({
    active: true,
    expand: ["data.default_price"],
    limit: 100,
  });

  if (products.data.length === 0) {
    console.log("No active products found.");
    return;
  }

  for (const product of products.data) {
    const code = product.metadata?.code || product.id;
    const defaultPrice = product.default_price as Stripe.Price | null;

    if (!defaultPrice || typeof defaultPrice === "string") {
      console.log(`[${code}] No default price, skipping.`);
      continue;
    }

    if (defaultPrice.recurring?.interval !== "month") {
      console.log(`[${code}] Default price is not monthly, skipping.`);
      continue;
    }

    const monthlyCents = defaultPrice.unit_amount ?? 0;
    const yearlyCents = Math.round(monthlyCents * YEARLY_MULTIPLIER);

    const existingPrices = await stripe.prices.list({
      product: product.id,
      active: true,
    });

    const hasYearly = existingPrices.data.some((p) => p.recurring?.interval === "year");
    if (hasYearly) {
      console.log(`[${code}] Yearly price already exists, skipping.`);
      continue;
    }

    console.log(
      `[${code}] Creating yearly price: $${(monthlyCents / 100).toFixed(2)}/mo → $${(yearlyCents / 100).toFixed(2)}/year`
    );

    const yearlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: yearlyCents,
      currency: "usd",
      recurring: { interval: "year" },
      metadata: { interval: "year" },
    });
    console.log(`  ✓ Price ID: ${yearlyPrice.id}`);

    const founderCentsRaw = product.metadata?.priceFounderCents;
    if (founderCentsRaw) {
      const founderMonthlyCents = parseInt(String(founderCentsRaw), 10);
      if (!Number.isNaN(founderMonthlyCents)) {
        const founderYearlyCents = Math.round(founderMonthlyCents * YEARLY_MULTIPLIER);
        await stripe.products.update(product.id, {
          metadata: {
            ...(product.metadata || {}),
            priceFounderYearlyCents: String(founderYearlyCents),
          },
        });
        console.log(`  ✓ Set priceFounderYearlyCents: ${founderYearlyCents} ($${(founderYearlyCents / 100).toFixed(2)}/year)`);
      }
    }

    console.log("");
  }

  console.log("=== Done. Yearly billing is now available for these plans. ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

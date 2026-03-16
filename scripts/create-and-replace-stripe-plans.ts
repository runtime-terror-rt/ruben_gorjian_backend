/**
 * Create the 3 Full Management Talexia plans in Stripe and retire others.
 *
 * Plans: FMP-20 (Full Management), FMP-35 (Plus), FM-70 (Premium)
 * - Aligned with pricing-catalog: 12/16/20 posts, 1/2/3 platforms, $395/$495/$949
 * - Creates Stripe products + monthly recurring prices
 * - Deactivates all Stripe products that are NOT in these 3 (retires old plans)
 *
 * Run: npx ts-node scripts/create-and-replace-stripe-plans.ts
 * Requires: STRIPE_SECRET_KEY in env
 */

import "dotenv/config";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

const NEW_PLAN_CODES = ["FMP-20", "FMP-35", "FM-70"] as const;

interface PlanSpec {
  code: string;
  name: string;
  category: string;
  isJewelry: boolean;
  platformLimit: number;
  baseVisualQuota: number | null;
  basePostQuota: number | null;
  postLimitType: "NONE" | "SOFT" | "HARD";
  schedulerRole: "CLIENT" | "ADMIN";
  priceStandardCents: number;
  priceFounderCents: number;
}

const PLANS: PlanSpec[] = [
  {
    code: "FMP-20",
    name: "Full Management",
    category: "FULL_MANAGEMENT",
    isJewelry: false,
    platformLimit: 1,
    baseVisualQuota: null,
    basePostQuota: 12,
    postLimitType: "HARD",
    schedulerRole: "ADMIN",
    priceStandardCents: 39500, // $395
    priceFounderCents: 27650, // $276.50
  },
  {
    code: "FMP-35",
    name: "Full Management Plus",
    category: "FULL_MANAGEMENT",
    isJewelry: false,
    platformLimit: 2,
    baseVisualQuota: null,
    basePostQuota: 16,
    postLimitType: "HARD",
    schedulerRole: "ADMIN",
    priceStandardCents: 49500, // $495
    priceFounderCents: 34650, // $346.50
  },
  {
    code: "FM-70",
    name: "Full Management Premium",
    category: "FULL_MANAGEMENT",
    isJewelry: false,
    platformLimit: 3,
    baseVisualQuota: null,
    basePostQuota: 20,
    postLimitType: "HARD",
    schedulerRole: "ADMIN",
    priceStandardCents: 94900, // $949
    priceFounderCents: 66430, // $664.30
  },
];

async function main() {
  console.log("=== Talexia: Replace Stripe plans with 3 Full Management plans ===\n");

  // 1) List existing products
  const existingProducts = await stripe.products.list({
    active: true,
    limit: 100,
  });
  const toRetire = existingProducts.data.filter(
    (p) => !(NEW_PLAN_CODES as readonly string[]).includes(p.metadata?.code || "")
  );

  // 2) Create or update the 5 new plans
  for (const plan of PLANS) {
    const existing = existingProducts.data.find((p) => p.metadata?.code === plan.code);
    if (existing) {
      console.log(`[${plan.code}] Already exists (${existing.id}), updating metadata...`);
      await stripe.products.update(existing.id, {
        name: plan.name,
        description: plan.name,
        metadata: {
          code: plan.code,
          name: plan.name,
          category: plan.category,
          isJewelry: String(plan.isJewelry),
          platformLimit: String(plan.platformLimit),
          baseVisualQuota: plan.baseVisualQuota != null ? String(plan.baseVisualQuota) : "",
          basePostQuota: plan.basePostQuota != null ? String(plan.basePostQuota) : "",
          postLimitType: plan.postLimitType,
          schedulerRole: plan.schedulerRole,
          priceFounderCents: String(plan.priceFounderCents),
        },
      });
      const prices = await stripe.prices.list({ product: existing.id, active: true });
      const monthlyPrice = prices.data.find(
        (p) => p.recurring?.interval === "month" && p.unit_amount === plan.priceStandardCents
      );
      if (!monthlyPrice) {
        const newPrice = await stripe.prices.create({
          product: existing.id,
          unit_amount: plan.priceStandardCents,
          currency: "usd",
          recurring: { interval: "month" },
        });
        await stripe.products.update(existing.id, { default_price: newPrice.id });
        console.log(`  → New price: ${newPrice.id} ($${(plan.priceStandardCents / 100).toFixed(2)}/mo)`);
      }
      continue;
    }

    console.log(`[${plan.code}] Creating product: ${plan.name} ($${(plan.priceStandardCents / 100).toFixed(2)}/mo)`);
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.name,
      metadata: {
        code: plan.code,
        name: plan.name,
        category: plan.category,
        isJewelry: String(plan.isJewelry),
        platformLimit: String(plan.platformLimit),
        baseVisualQuota: plan.baseVisualQuota != null ? String(plan.baseVisualQuota) : "",
        basePostQuota: plan.basePostQuota != null ? String(plan.basePostQuota) : "",
        postLimitType: plan.postLimitType,
        schedulerRole: plan.schedulerRole,
        priceFounderCents: String(plan.priceFounderCents),
      },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.priceStandardCents,
      currency: "usd",
      recurring: { interval: "month" },
    });
    await stripe.products.update(product.id, { default_price: price.id });
    console.log(`  ✓ Product: ${product.id}, Price: ${price.id}\n`);
  }

  // 3) Retire old products (deactivate so they don't appear for new signups)
  for (const product of toRetire) {
    const code = product.metadata?.code || product.id;
    console.log(`[Retire] Deactivating: ${code} (${product.id})`);
    await stripe.products.update(product.id, { active: false });
  }

  if (toRetire.length > 0) {
    console.log(`\nRetired ${toRetire.length} old plan(s). Existing subscribers are unchanged.`);
  }

  console.log("\n=== Done. Restart the backend to sync Stripe → DB (syncPlansFromStripe). ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

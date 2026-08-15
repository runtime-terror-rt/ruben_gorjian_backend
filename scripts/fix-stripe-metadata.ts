import "dotenv/config";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

const CORRECT_PRICES: Record<string, number> = {
  "ESSENTIALS": 39700,
  "SIGNATURE": 59700
};

async function main() {
  console.log("=== Talexia: Fixing product metadata in Stripe ===\n");

  const products = await stripe.products.list({ active: true, limit: 100 });
  
  for (const product of products.data) {
    const code = product.metadata?.code;
    if (code && CORRECT_PRICES[code]) {
      const targetMonthlyCents = CORRECT_PRICES[code];
      
      console.log(`[${code}] Checking metadata...`);
      
      const newMetadata = { ...product.metadata };
      let changed = false;

      if (newMetadata.priceStandardCents !== String(targetMonthlyCents)) {
        console.log(`  -> Fixing priceStandardCents from ${newMetadata.priceStandardCents} to ${targetMonthlyCents}`);
        newMetadata.priceStandardCents = String(targetMonthlyCents);
        changed = true;
      }
      
      if (newMetadata.priceFounderCents !== String(targetMonthlyCents)) {
        console.log(`  -> Fixing priceFounderCents from ${newMetadata.priceFounderCents} to ${targetMonthlyCents}`);
        newMetadata.priceFounderCents = String(targetMonthlyCents);
        changed = true;
      }
      
      if (changed) {
        await stripe.products.update(product.id, { metadata: newMetadata });
        console.log(`  -> Updated product metadata in Stripe.`);
      } else {
        console.log(`  -> Metadata is already correct.`);
      }
    }
  }

  console.log("\n=== Done. ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

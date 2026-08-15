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
  console.log("=== Talexia: Fixing default prices in Stripe ===\n");

  const products = await stripe.products.list({ active: true, limit: 100 });
  
  for (const product of products.data) {
    const code = product.metadata?.code;
    if (code && CORRECT_PRICES[code]) {
      const targetMonthlyCents = CORRECT_PRICES[code];
      
      console.log(`[${code}] Checking prices...`);
      const prices = await stripe.prices.list({ product: product.id, active: true });
      
      let correctMonthlyPrice = prices.data.find(
        p => p.recurring?.interval === "month" && p.unit_amount === targetMonthlyCents
      );
      
      if (!correctMonthlyPrice) {
        console.log(`  -> Correct monthly price ($${targetMonthlyCents/100}) not found, creating it...`);
        correctMonthlyPrice = await stripe.prices.create({
          product: product.id,
          unit_amount: targetMonthlyCents,
          currency: "usd",
          recurring: { interval: "month" },
          metadata: {
            interval: "month",
            planCode: code,
          }
        });
      }
      
      if (product.default_price !== correctMonthlyPrice.id) {
        console.log(`  -> Updating default_price to ${correctMonthlyPrice.id} ($${targetMonthlyCents/100}/mo)`);
        await stripe.products.update(product.id, {
          default_price: correctMonthlyPrice.id
        });
      } else {
        console.log(`  -> Default price is already correct.`);
      }
    }
  }

  console.log("\n=== Done. ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

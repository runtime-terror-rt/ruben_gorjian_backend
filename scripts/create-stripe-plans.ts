import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {} as any);

async function main() {
  console.log("Creating Stripe Products, Prices, and Coupons...\n");

  // Create Essentials Product
  const essentials = await stripe.products.create({
    name: "Essentials",
    metadata: {
      code: "ESSENTIALS",
      category: "FULL_MANAGEMENT",
      isJewelry: "false",
      platformQty: "2",
      basePostQuota: "12",
    },
  });

  const essentialsMonthly = await stripe.prices.create({
    product: essentials.id,
    unit_amount: 39700, // $397.00
    currency: "usd",
    recurring: { interval: "month" },
  });

  const essentialsYearly = await stripe.prices.create({
    product: essentials.id,
    unit_amount: 428800, // $4288.00
    currency: "usd",
    recurring: { interval: "year" },
  });

  // Create Signature Product
  const signature = await stripe.products.create({
    name: "Signature",
    metadata: {
      code: "SIGNATURE",
      category: "FULL_MANAGEMENT",
      isJewelry: "false",
      platformQty: "3",
      basePostQuota: "24",
    },
  });

  const signatureMonthly = await stripe.prices.create({
    product: signature.id,
    unit_amount: 59700, // $597.00
    currency: "usd",
    recurring: { interval: "month" },
  });

  const signatureYearly = await stripe.prices.create({
    product: signature.id,
    unit_amount: 644800, // $6448.00
    currency: "usd",
    recurring: { interval: "year" },
  });

  // Create Coupon for 1MFREE
  let coupon;
  try {
    const existingCoupons = await stripe.coupons.list({ limit: 100 });
    coupon = existingCoupons.data.find(c => c.name === "1 Month Free");
    if (!coupon) {
      coupon = await stripe.coupons.create({
        name: "1 Month Free",
        percent_off: 100,
        duration: "once", // Applies to the first invoice (first month)
        currency: "usd",
      });
    }
    
    // Create Promotion Code 1MFREE
    const promoCodes = await stripe.promotionCodes.list({ code: "1MFREE", active: true });
    if (promoCodes.data.length === 0) {
      await stripe.promotionCodes.create({
        // @ts-ignore
        coupon: coupon.id,
        code: "1MFREE",
      });
      console.log("✅ Created 1MFREE promotion code.");
    } else {
      console.log("✅ 1MFREE promotion code already exists.");
    }
  } catch (error) {
    console.error("Failed to create coupon:", error);
  }

  console.log("\n=========================================");
  console.log("Add the following lines to your .env file:");
  console.log("=========================================\n");
  
  console.log(`STRIPE_PRICE_ESSENTIALS_STANDARD=${essentialsMonthly.id}`);
  console.log(`STRIPE_PRICE_ESSENTIALS_STANDARD_YEARLY=${essentialsYearly.id}`);
  console.log(`STRIPE_PRICE_SIGNATURE_STANDARD=${signatureMonthly.id}`);
  console.log(`STRIPE_PRICE_SIGNATURE_STANDARD_YEARLY=${signatureYearly.id}`);
  
  console.log("\n=========================================");
}

main().catch(console.error);

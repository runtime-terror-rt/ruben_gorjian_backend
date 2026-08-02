import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {} as any);

async function main() {
  console.log("Fetching existing Stripe products...");
  const products = await stripe.products.list({ active: true, limit: 100 });

  const requiredNames = ["Signature", "Essentials", "Additional Platform"];
  const envOutput: Record<string, string> = {};

  for (const product of products.data) {
    if (!requiredNames.includes(product.name)) {
      console.log(`Archiving old product: ${product.name}`);
      await stripe.products.update(product.id, { active: false });
    } else {
      console.log(`Found required product: ${product.name}`);
    }
  }

  // Helper to get or create product
  async function getOrCreateProduct(name: string, metadata: any) {
    let product = (await stripe.products.list({ active: true })).data.find((p) => p.name === name);
    if (!product) {
      console.log(`Creating product: ${name}`);
      product = await stripe.products.create({ name, metadata });
    }
    return product;
  }

  // Helper to get or create price
  async function getOrCreatePrice(productId: string, amount: number, interval: "month" | "year") {
    let prices = await stripe.prices.list({ product: productId, active: true });
    let price = prices.data.find((p) => p.recurring?.interval === interval && p.unit_amount === amount);
    if (!price) {
      console.log(`Creating ${interval} price for product ${productId} ($${amount / 100})`);
      price = await stripe.prices.create({
        product: productId,
        unit_amount: amount,
        currency: "usd",
        recurring: { interval },
      });
    }
    return price;
  }

  // 1. Essentials
  const essentials = await getOrCreateProduct("Essentials", {
    code: "ESSENTIALS",
    category: "FULL_MANAGEMENT",
    isJewelry: "false",
    platformQty: "2",
    basePostQuota: "12",
  });
  const essMonthly = await getOrCreatePrice(essentials.id, 39700, "month");
  const essYearly = await getOrCreatePrice(essentials.id, 428800, "year");
  envOutput["STRIPE_PRICE_ESSENTIALS_STANDARD"] = essMonthly.id;
  envOutput["STRIPE_PRICE_ESSENTIALS_STANDARD_YEARLY"] = essYearly.id;

  // 2. Signature
  const signature = await getOrCreateProduct("Signature", {
    code: "SIGNATURE",
    category: "FULL_MANAGEMENT",
    isJewelry: "false",
    platformQty: "3",
    basePostQuota: "24",
  });
  const sigMonthly = await getOrCreatePrice(signature.id, 59700, "month");
  const sigYearly = await getOrCreatePrice(signature.id, 644800, "year");
  envOutput["STRIPE_PRICE_SIGNATURE_STANDARD"] = sigMonthly.id;
  envOutput["STRIPE_PRICE_SIGNATURE_STANDARD_YEARLY"] = sigYearly.id;

  // 3. Additional Platform
  const additionalPlatform = await getOrCreateProduct("Additional Platform", {
    isAddon: "true",
  });
  const addMonthly = await getOrCreatePrice(additionalPlatform.id, 500, "month"); // $5/mo
  const addYearly = await getOrCreatePrice(additionalPlatform.id, 6000, "year"); // $60/yr
  envOutput["STRIPE_PLATFORM_ADDON_PRICE_ID"] = addMonthly.id;
  envOutput["STRIPE_PLATFORM_ADDON_YEARLY_PRICE_ID"] = addYearly.id;

  console.log("\n=======================================================");
  console.log("✅ Cleanup and Setup Complete!");
  console.log("Please update your .env file with the following values:");
  console.log("=======================================================\n");

  for (const [key, value] of Object.entries(envOutput)) {
    console.log(`${key}=${value}`);
  }
  
  console.log("\n=======================================================\n");
}

main().catch(console.error);

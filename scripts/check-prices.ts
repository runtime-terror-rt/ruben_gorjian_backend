import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {} as any);

async function check() {
  const products = await stripe.products.list({ active: true });
  const essentials = products.data.find(p => p.name === "Essentials");
  if (!essentials) return;
  const prices = await stripe.prices.list({ product: essentials.id, active: true });
  for (const p of prices.data) {
    console.log(`Price ID: ${p.id}, Amount: ${p.unit_amount}, Interval: ${p.recurring?.interval}`);
  }
}
check();

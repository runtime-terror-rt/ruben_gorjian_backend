import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {} as any);

async function check() {
  const priceId = "price_1TzsBVP3Cjs6shL6qRpwnnXT";
  const p = await stripe.prices.retrieve(priceId);
  console.log(p.unit_amount);
}
check();

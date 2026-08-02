import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {} as any);

async function fix() {
  const products = await stripe.products.list({ active: true });
  const ess = products.data.find(p => p.name === "Essentials");
  const sig = products.data.find(p => p.name === "Signature");

  if (ess) {
    const prices = await stripe.prices.list({ product: ess.id, active: true });
    for (const p of prices.data) {
      if (p.unit_amount !== 39700 && p.unit_amount !== 428800) {
        console.log(`Archiving wrong Essentials price: ${p.id} ($${(p.unit_amount || 0) / 100})`);
        await stripe.prices.update(p.id, { active: false });
      } else {
        console.log(`Keeping Essentials price: ${p.id} ($${(p.unit_amount || 0) / 100})`);
      }
    }
  }

  if (sig) {
    const prices = await stripe.prices.list({ product: sig.id, active: true });
    for (const p of prices.data) {
      if (p.unit_amount !== 59700 && p.unit_amount !== 644800) {
        console.log(`Archiving wrong Signature price: ${p.id} ($${(p.unit_amount || 0) / 100})`);
        await stripe.prices.update(p.id, { active: false });
      } else {
        console.log(`Keeping Signature price: ${p.id} ($${(p.unit_amount || 0) / 100})`);
      }
    }
  }
}

fix().catch(console.error);

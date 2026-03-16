import Stripe from "stripe";
import { env } from "../../config/env";

export const stripeClient = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

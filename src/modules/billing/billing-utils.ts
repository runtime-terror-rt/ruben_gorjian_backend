import Stripe from "stripe";
import { PlanCategory, SubscriptionStatus } from "@prisma/client";

/**
 * Single source of truth for Stripe → local status mapping.
 * Centralised here so routes.ts and webhook.ts stay consistent.
 */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
    case "incomplete_expired":
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

/**
 * Validate and coerce a raw string from Stripe product metadata into a
 * known PlanCategory value.  Falls back to CALENDAR_ONLY for unknown strings
 * so that a misconfigured Stripe product never hard-errors the server.
 */
const VALID_PLAN_CATEGORIES = new Set<string>(Object.values(PlanCategory));

export function toPlanCategory(value: string | undefined | null): PlanCategory {
  if (value && VALID_PLAN_CATEGORIES.has(value)) return value as PlanCategory;
  return PlanCategory.CALENDAR_ONLY;
}

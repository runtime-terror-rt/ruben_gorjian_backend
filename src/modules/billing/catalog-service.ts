import { AddonType, BillingCycle, BillingQuoteStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const NY_TAX_RATE = 0.08625;
export const NY_TAX_RATE_PERCENT = "8.625";
export const ADDITIONAL_PLATFORM_ADDON_CODE = "ADDITIONAL_PLATFORM";

export function toBillingCycle(value: "monthly" | "yearly"): BillingCycle {
  return value === "yearly" ? BillingCycle.YEARLY : BillingCycle.MONTHLY;
}

export function fromBillingCycle(value: BillingCycle): "monthly" | "yearly" {
  return value === BillingCycle.YEARLY ? "yearly" : "monthly";
}

export function getAdditionalPlatformUnitAmountCents(billingCycle: BillingCycle): number {
  return billingCycle === BillingCycle.YEARLY ? 4800 : 500;
}

export function calculateTaxCents(amountCents: number) {
  return Math.round(amountCents * NY_TAX_RATE);
}

export async function ensureDefaultAdditionalPlatformAddon() {
  const existingAddon = await prisma.addon.findUnique({
    where: { code: ADDITIONAL_PLATFORM_ADDON_CODE },
    include: { prices: true },
  });

  if (existingAddon?.deletedAt) {
    return existingAddon;
  }

  const addon = existingAddon
    ? await prisma.addon.update({
      where: { id: existingAddon.id },
      data: {
        name: "Additional Platform",
        description: "Adds one more connected social platform to the active subscription.",
        type: AddonType.RECURRING,
        isActive: true,
      },
    })
    : await prisma.addon.create({
      data: {
        code: ADDITIONAL_PLATFORM_ADDON_CODE,
        name: "Additional Platform",
        description: "Adds one more connected social platform to the active subscription.",
        type: AddonType.RECURRING,
        isActive: true,
      },
    });

  await prisma.addonPrice.upsert({
    where: {
      addonId_billingCycle: {
        addonId: addon.id,
        billingCycle: BillingCycle.MONTHLY,
      },
    },
    update: {
      unitAmountCents: getAdditionalPlatformUnitAmountCents(BillingCycle.MONTHLY),
      isActive: true,
    },
    create: {
      addonId: addon.id,
      billingCycle: BillingCycle.MONTHLY,
      unitAmountCents: getAdditionalPlatformUnitAmountCents(BillingCycle.MONTHLY),
    },
  });

  await prisma.addonPrice.upsert({
    where: {
      addonId_billingCycle: {
        addonId: addon.id,
        billingCycle: BillingCycle.YEARLY,
      },
    },
    update: {
      unitAmountCents: getAdditionalPlatformUnitAmountCents(BillingCycle.YEARLY),
      isActive: true,
    },
    create: {
      addonId: addon.id,
      billingCycle: BillingCycle.YEARLY,
      unitAmountCents: getAdditionalPlatformUnitAmountCents(BillingCycle.YEARLY),
    },
  });

  return prisma.addon.findUniqueOrThrow({
    where: { id: addon.id },
    include: { prices: true },
  });
}

export async function getActiveTermsForPlan(planCode: string) {
  return prisma.planTermsVersion.findMany({
    where: {
      planCode,
      isActive: true,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export function normalizeTermsVersionIds(input: string[]) {
  return [...new Set(input.map((id) => id.trim()).filter(Boolean))];
}

export function parseAcceptedTermsJson(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createBillingQuote(params: {
  userId: string;
  planCode: string;
  billingCycle: BillingCycle;
  termsVersionIds: string[];
  additionalPlatformQty: number;
}) {
  const plan = await prisma.plan.findUnique({
    where: { code: params.planCode },
  });
  if (!plan) {
    throw new Error("Plan not found");
  }

  const normalizedTermsVersionIds = normalizeTermsVersionIds(params.termsVersionIds);
  if (normalizedTermsVersionIds.length === 0) {
    throw new Error("At least one active terms version must be accepted");
  }

  const termsVersions = await prisma.planTermsVersion.findMany({
    where: {
      id: { in: normalizedTermsVersionIds },
      planCode: params.planCode,
      isActive: true,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
  });
  if (termsVersions.length !== normalizedTermsVersionIds.length) {
    throw new Error("One or more selected terms are invalid, inactive, or deleted");
  }

  const additionalPlatformAddon = await ensureDefaultAdditionalPlatformAddon();
  if (!additionalPlatformAddon.isActive || additionalPlatformAddon.deletedAt) {
    throw new Error("Additional Platform add-on is not available");
  }
  const addonPrice = additionalPlatformAddon.prices.find(
    (price) => price.billingCycle === params.billingCycle && price.isActive
  );
  if (!addonPrice) {
    throw new Error("Additional Platform add-on pricing is not configured");
  }

  const planUnitAmount =
    params.billingCycle === BillingCycle.YEARLY
      ? Math.round(plan.priceStandardCents * 12 * 0.8)
      : plan.priceStandardCents;

  const additionalPlatformSubtotal = addonPrice.unitAmountCents * params.additionalPlatformQty;
  const subtotalCents = planUnitAmount + additionalPlatformSubtotal;
  const discountCents = 0;
  const taxableAmount = subtotalCents - discountCents;
  const taxCents = calculateTaxCents(taxableAmount);
  const totalCents = taxableAmount + taxCents;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  return prisma.billingQuote.create({
    data: {
      userId: params.userId,
      planCode: params.planCode,
      billingCycle: params.billingCycle,
      acceptedTermsJson: normalizedTermsVersionIds,
      additionalPlatformQty: params.additionalPlatformQty,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      taxRatePercent: NY_TAX_RATE_PERCENT,
      status: BillingQuoteStatus.PENDING,
      expiresAt,
    },
    include: {
      plan: true,
    },
  });
}

export function serializeBillingQuote(
  quote: Prisma.BillingQuoteGetPayload<{ include: { plan: true } }>,
  selectedTerms: Array<{ id: string; version: string; title: string }>
) {
  const additionalPlatformUnitAmountCents = getAdditionalPlatformUnitAmountCents(quote.billingCycle);
  return {
    id: quote.id,
    planCode: quote.planCode,
    billingCycle: fromBillingCycle(quote.billingCycle),
    currency: quote.currency,
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    taxCents: quote.taxCents,
    taxRatePercent: quote.taxRatePercent,
    totalCents: quote.totalCents,
    expiresAt: quote.expiresAt,
    status: quote.status,
    terms: selectedTerms,
    items: [
      {
        code: quote.plan.code,
        name: quote.plan.name,
        type: "plan",
        quantity: 1,
        unitAmountCents:
          quote.billingCycle === BillingCycle.YEARLY
            ? Math.round(quote.plan.priceStandardCents * 12 * 0.8)
            : quote.plan.priceStandardCents,
        totalAmountCents:
          quote.billingCycle === BillingCycle.YEARLY
            ? Math.round(quote.plan.priceStandardCents * 12 * 0.8)
            : quote.plan.priceStandardCents,
      },
      ...(quote.additionalPlatformQty > 0
        ? [
          {
            code: ADDITIONAL_PLATFORM_ADDON_CODE,
            name: "Additional Platform",
            type: "addon",
            quantity: quote.additionalPlatformQty,
            unitAmountCents: additionalPlatformUnitAmountCents,
            totalAmountCents:
              additionalPlatformUnitAmountCents * quote.additionalPlatformQty,
          },
        ]
        : []),
    ],
  };
}

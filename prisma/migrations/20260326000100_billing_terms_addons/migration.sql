-- Create enums
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "AddonType" AS ENUM ('RECURRING', 'ONE_TIME');
CREATE TYPE "BillingQuoteStatus" AS ENUM ('PENDING', 'CHECKOUT_CREATED', 'COMPLETED', 'EXPIRED', 'CANCELED');

-- Alter Subscription
ALTER TABLE "Subscription"
ADD COLUMN "billingInterval" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "latestQuoteId" TEXT;

-- Create PlanTermsVersion
CREATE TABLE "PlanTermsVersion" (
    "id" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTermsVersion_pkey" PRIMARY KEY ("id")
);

-- Create TermsAcceptance
CREATE TABLE "TermsAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "termsVersionId" TEXT NOT NULL,
    "billingQuoteId" TEXT,
    "stripeSessionId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- Create Addon
CREATE TABLE "Addon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "AddonType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

-- Create AddonPrice
CREATE TABLE "AddonPrice" (
    "id" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "unitAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripePriceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddonPrice_pkey" PRIMARY KEY ("id")
);

-- Create BillingQuote
CREATE TABLE "BillingQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "termsVersionId" TEXT NOT NULL,
    "additionalPlatformQty" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "taxRatePercent" TEXT NOT NULL DEFAULT '8.625',
    "status" "BillingQuoteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingQuote_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "PlanTermsVersion_planCode_version_key" ON "PlanTermsVersion"("planCode", "version");
CREATE INDEX "PlanTermsVersion_planCode_isActive_idx" ON "PlanTermsVersion"("planCode", "isActive");
CREATE INDEX "TermsAcceptance_userId_planCode_idx" ON "TermsAcceptance"("userId", "planCode");
CREATE INDEX "TermsAcceptance_termsVersionId_idx" ON "TermsAcceptance"("termsVersionId");
CREATE UNIQUE INDEX "Addon_code_key" ON "Addon"("code");
CREATE UNIQUE INDEX "AddonPrice_addonId_billingCycle_key" ON "AddonPrice"("addonId", "billingCycle");
CREATE INDEX "AddonPrice_addonId_billingCycle_isActive_idx" ON "AddonPrice"("addonId", "billingCycle", "isActive");
CREATE INDEX "BillingQuote_userId_status_idx" ON "BillingQuote"("userId", "status");
CREATE INDEX "BillingQuote_planCode_idx" ON "BillingQuote"("planCode");

-- Add foreign keys
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_latestQuoteId_fkey" FOREIGN KEY ("latestQuoteId") REFERENCES "BillingQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanTermsVersion" ADD CONSTRAINT "PlanTermsVersion_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "PlanTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_billingQuoteId_fkey" FOREIGN KEY ("billingQuoteId") REFERENCES "BillingQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AddonPrice" ADD CONSTRAINT "AddonPrice_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingQuote" ADD CONSTRAINT "BillingQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingQuote" ADD CONSTRAINT "BillingQuote_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingQuote" ADD CONSTRAINT "BillingQuote_termsVersionId_fkey" FOREIGN KEY ("termsVersionId") REFERENCES "PlanTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

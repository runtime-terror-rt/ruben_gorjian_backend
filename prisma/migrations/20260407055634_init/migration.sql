-- CreateEnum
CREATE TYPE "AddonType" AS ENUM ('RECURRING', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "BillingQuoteStatus" AS ENUM ('PENDING', 'CHECKOUT_CREATED', 'COMPLETED', 'EXPIRED', 'CANCELED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "calendlyEventUri" TEXT,
ADD COLUMN     "calendlyInviteeUri" TEXT,
ADD COLUMN     "calendlyLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "calendlySyncError" TEXT,
ADD COLUMN     "calendlySyncStatus" "CalendlySyncStatus";

-- CreateTable
CREATE TABLE "PlanTermsVersion" (
    "id" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTermsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Addon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "AddonType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddonPrice" (
    "id" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "unitAmountCents" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddonPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "acceptedTermsJson" JSONB NOT NULL,
    "additionalPlatformQty" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxRatePercent" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "BillingQuoteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTermsVersion_planCode_idx" ON "PlanTermsVersion"("planCode");

-- CreateIndex
CREATE INDEX "PlanTermsVersion_planCode_isActive_idx" ON "PlanTermsVersion"("planCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTermsVersion_planCode_version_key" ON "PlanTermsVersion"("planCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Addon_code_key" ON "Addon"("code");

-- CreateIndex
CREATE INDEX "Addon_type_idx" ON "Addon"("type");

-- CreateIndex
CREATE INDEX "Addon_isActive_idx" ON "Addon"("isActive");

-- CreateIndex
CREATE INDEX "AddonPrice_billingCycle_idx" ON "AddonPrice"("billingCycle");

-- CreateIndex
CREATE INDEX "AddonPrice_isActive_idx" ON "AddonPrice"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AddonPrice_addonId_billingCycle_key" ON "AddonPrice"("addonId", "billingCycle");

-- CreateIndex
CREATE INDEX "BillingQuote_userId_idx" ON "BillingQuote"("userId");

-- CreateIndex
CREATE INDEX "BillingQuote_planCode_idx" ON "BillingQuote"("planCode");

-- CreateIndex
CREATE INDEX "BillingQuote_status_idx" ON "BillingQuote"("status");

-- CreateIndex
CREATE INDEX "BillingQuote_expiresAt_idx" ON "BillingQuote"("expiresAt");

-- CreateIndex
CREATE INDEX "Post_calendlySyncStatus_idx" ON "Post"("calendlySyncStatus");

-- AddForeignKey
ALTER TABLE "PlanTermsVersion" ADD CONSTRAINT "PlanTermsVersion_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddonPrice" ADD CONSTRAINT "AddonPrice_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingQuote" ADD CONSTRAINT "BillingQuote_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

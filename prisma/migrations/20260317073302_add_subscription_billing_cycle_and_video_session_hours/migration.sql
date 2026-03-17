-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "videoSessionHours" INTEGER NOT NULL DEFAULT 0;

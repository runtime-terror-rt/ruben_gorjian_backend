-- Add soft-delete columns for payment catalog records
ALTER TABLE "PlanTermsVersion"
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Addon"
ADD COLUMN "deletedAt" TIMESTAMP(3);

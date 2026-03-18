-- AlterTable
-- Preserve existing comma-separated plan codes while converting TEXT -> TEXT[]
ALTER TABLE "Coupon"
ALTER COLUMN "applicablePlans" TYPE TEXT[]
USING CASE
  WHEN "applicablePlans" IS NULL OR btrim("applicablePlans") = '' THEN ARRAY[]::TEXT[]
  ELSE string_to_array(replace("applicablePlans", ' ', ''), ',')
END,
ALTER COLUMN "applicablePlans" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "applicablePlans" SET NOT NULL;

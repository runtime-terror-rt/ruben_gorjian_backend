ALTER TABLE "Plan"
ADD COLUMN "platformQty" INTEGER NOT NULL DEFAULT 1;

UPDATE "Plan"
SET
  "platformQty" = COALESCE("platformQty", "platformLimit", 1),
  "platformLimit" = 4;
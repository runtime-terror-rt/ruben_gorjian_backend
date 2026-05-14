-- Ensure all Plan.platformLimit values are set to the global limit (4)
BEGIN;
UPDATE "Plan" SET "platformLimit" = 4 WHERE "platformLimit" IS DISTINCT FROM 4 OR "platformLimit" IS NULL;
COMMIT;

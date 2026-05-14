-- Set platformLimit to 4 for all existing Plan rows
BEGIN;
UPDATE "Plan" SET "platformLimit" = 4 WHERE "platformLimit" IS DISTINCT FROM 4 OR "platformLimit" IS NULL;
COMMIT;

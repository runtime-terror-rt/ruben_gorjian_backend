/*
  Warnings:

  - The `industry` column on the `EnterprisePlanProposal` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "EnterprisePlanProposal" DROP COLUMN "industry",
ADD COLUMN     "industry" TEXT;

-- DropEnum
DROP TYPE "EnterpriseIndustry";

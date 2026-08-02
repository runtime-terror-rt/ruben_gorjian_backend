/*
  Warnings:

  - A unique constraint covering the columns `[referenceCode]` on the table `BrandBrief` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `agreedAuthorizationText` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `referenceCode` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "BrandBrief_userId_proposalId_key";

-- AlterTable
ALTER TABLE "BrandBrief" ADD COLUMN     "agreedAuthorizationText" TEXT NOT NULL,
ADD COLUMN     "pdfStorageKey" TEXT,
ADD COLUMN     "referenceCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandBriefLastReminderAt" TIMESTAMP(3),
ADD COLUMN     "brandBriefReminderLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "BrandBrief_referenceCode_key" ON "BrandBrief"("referenceCode");

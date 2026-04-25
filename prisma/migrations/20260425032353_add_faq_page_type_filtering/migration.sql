-- CreateEnum
CREATE TYPE "FaqPageType" AS ENUM ('FAQ_PAGE', 'PRICING_PAGE');

-- AlterTable
ALTER TABLE "Faq" ADD COLUMN     "pageType" "FaqPageType" NOT NULL DEFAULT 'FAQ_PAGE';

-- CreateIndex
CREATE INDEX "Faq_pageType_idx" ON "Faq"("pageType");

-- CreateIndex
CREATE INDEX "Faq_isActive_pageType_idx" ON "Faq"("isActive", "pageType");

-- CreateTable
CREATE TABLE "BrandBrief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "cuisineType" TEXT NOT NULL,
    "dietaryCertifications" TEXT[],
    "websiteUrl" TEXT,
    "instagramHandle" TEXT NOT NULL,
    "facebookPageUrl" TEXT,
    "tiktokHandle" TEXT,
    "onlineOrderingUrl" TEXT,
    "foodDescription" TEXT NOT NULL,
    "uniqueSellingPoint" TEXT NOT NULL,
    "customerReviews" TEXT NOT NULL,
    "forbiddenPhrases" TEXT,
    "preferredPhrases" TEXT,
    "captionSample1" TEXT NOT NULL,
    "captionSample2" TEXT NOT NULL,
    "captionSample3" TEXT NOT NULL,
    "toneAndVoice" TEXT[],
    "captionTargeting" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "signatureDishes" TEXT[],
    "signatureDishDetails" TEXT NOT NULL,
    "excludedItems" TEXT,
    "upcomingPromotions" TEXT,
    "hashtagStyle" TEXT NOT NULL,
    "confirmMinDishes" TEXT NOT NULL,
    "actionShotsPossible" TEXT,
    "preferredShootTime" TEXT,
    "physicalConstraints" TEXT,
    "specialNotes" TEXT,
    "clientName" TEXT NOT NULL,
    "restaurantNameAuth" TEXT NOT NULL,
    "submissionDate" TIMESTAMP(3) NOT NULL,
    "talexiaPlan" TEXT NOT NULL,

    CONSTRAINT "BrandBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandBrief_userId_idx" ON "BrandBrief"("userId");

-- CreateIndex
CREATE INDEX "BrandBrief_proposalId_idx" ON "BrandBrief"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandBrief_userId_proposalId_key" ON "BrandBrief"("userId", "proposalId");

-- AddForeignKey
ALTER TABLE "BrandBrief" ADD CONSTRAINT "BrandBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandBrief" ADD CONSTRAINT "BrandBrief_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "EnterprisePlanProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

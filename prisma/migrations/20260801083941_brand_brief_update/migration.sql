/*
  Warnings:

  - You are about to drop the column `actionShotsPossible` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `captionSample1` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `captionSample2` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `captionSample3` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `clientName` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `confirmMinDishes` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `cuisineType` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `customerReviews` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `dietaryCertifications` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `excludedItems` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `facebookPageUrl` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `foodDescription` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `forbiddenPhrases` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `instagramHandle` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `onlineOrderingUrl` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `physicalConstraints` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `preferredPhrases` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `preferredShootTime` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `restaurantName` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `restaurantNameAuth` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `signatureDishDetails` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `signatureDishes` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `specialNotes` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `submissionDate` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `talexiaPlan` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `tiktokHandle` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `toneAndVoice` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `uniqueSellingPoint` on the `BrandBrief` table. All the data in the column will be lost.
  - You are about to drop the column `upcomingPromotions` on the `BrandBrief` table. All the data in the column will be lost.
  - Added the required column `authIHaveReadAndAgree` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authOnBehalfOf` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authSignedAs` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authSubmissionDate` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authTalexiaPlan` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `birthstoneTheming` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `brandName` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `brandStory` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `googleDriveEmails` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `industryCategory` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `keyCollections` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `materialsCertifications` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `preferredColorPalette` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `preferredCommunication` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `primaryContactEmail` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `primaryContactName` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `primaryLocation` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sampleCaptions` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stagingPreferences` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetAudience` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timezone` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `typicalPriceRange` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.
  - Added the required column `visualReferences` to the `BrandBrief` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BrandBrief" DROP COLUMN "actionShotsPossible",
DROP COLUMN "captionSample1",
DROP COLUMN "captionSample2",
DROP COLUMN "captionSample3",
DROP COLUMN "clientName",
DROP COLUMN "confirmMinDishes",
DROP COLUMN "cuisineType",
DROP COLUMN "customerReviews",
DROP COLUMN "dietaryCertifications",
DROP COLUMN "excludedItems",
DROP COLUMN "facebookPageUrl",
DROP COLUMN "foodDescription",
DROP COLUMN "forbiddenPhrases",
DROP COLUMN "instagramHandle",
DROP COLUMN "location",
DROP COLUMN "onlineOrderingUrl",
DROP COLUMN "physicalConstraints",
DROP COLUMN "preferredPhrases",
DROP COLUMN "preferredShootTime",
DROP COLUMN "restaurantName",
DROP COLUMN "restaurantNameAuth",
DROP COLUMN "signatureDishDetails",
DROP COLUMN "signatureDishes",
DROP COLUMN "specialNotes",
DROP COLUMN "submissionDate",
DROP COLUMN "talexiaPlan",
DROP COLUMN "tiktokHandle",
DROP COLUMN "toneAndVoice",
DROP COLUMN "uniqueSellingPoint",
DROP COLUMN "upcomingPromotions",
ADD COLUMN     "additionalPostingNotes" TEXT,
ADD COLUMN     "aestheticDirection" TEXT[],
ADD COLUMN     "authIHaveReadAndAgree" BOOLEAN NOT NULL,
ADD COLUMN     "authOnBehalfOf" TEXT NOT NULL,
ADD COLUMN     "authSignedAs" TEXT NOT NULL,
ADD COLUMN     "authSubmissionDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "authTalexiaPlan" TEXT NOT NULL,
ADD COLUMN     "birthstoneTheming" TEXT NOT NULL,
ADD COLUMN     "brandName" TEXT NOT NULL,
ADD COLUMN     "brandStory" TEXT NOT NULL,
ADD COLUMN     "brandVoiceDescriptors" TEXT[],
ADD COLUMN     "googleDriveEmails" TEXT NOT NULL,
ADD COLUMN     "industryCategory" TEXT NOT NULL,
ADD COLUMN     "keyCollections" TEXT NOT NULL,
ADD COLUMN     "materialsCertifications" TEXT NOT NULL,
ADD COLUMN     "platformAuthorizationContact" TEXT,
ADD COLUMN     "platforms" TEXT[],
ADD COLUMN     "preferredColorPalette" TEXT NOT NULL,
ADD COLUMN     "preferredCommunication" TEXT NOT NULL,
ADD COLUMN     "preferredPostingDays" TEXT[],
ADD COLUMN     "preferredTimeWindows" TEXT[],
ADD COLUMN     "primaryContactEmail" TEXT NOT NULL,
ADD COLUMN     "primaryContactName" TEXT NOT NULL,
ADD COLUMN     "primaryLocation" TEXT NOT NULL,
ADD COLUMN     "productFocus" TEXT[],
ADD COLUMN     "productIdentificationNotes" TEXT,
ADD COLUMN     "sampleCaptions" TEXT NOT NULL,
ADD COLUMN     "seasonalCalendar" TEXT,
ADD COLUMN     "secondaryContactEmail" TEXT,
ADD COLUMN     "secondaryContactName" TEXT,
ADD COLUMN     "sensitiveTopics" TEXT,
ADD COLUMN     "skuFilenameConvention" TEXT,
ADD COLUMN     "stagingPreferences" TEXT NOT NULL,
ADD COLUMN     "taglines" TEXT,
ADD COLUMN     "targetAudience" TEXT NOT NULL,
ADD COLUMN     "timeCriticalDates" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL,
ADD COLUMN     "typicalPriceRange" TEXT NOT NULL,
ADD COLUMN     "visualReferences" TEXT NOT NULL,
ADD COLUMN     "whatsappNumber" TEXT;

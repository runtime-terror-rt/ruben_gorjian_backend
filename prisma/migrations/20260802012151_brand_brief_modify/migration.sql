-- AlterTable
ALTER TABLE "BrandBrief" ADD COLUMN     "brandsYouAdmire" TEXT,
ADD COLUMN     "whatToAvoid" TEXT,
ALTER COLUMN "keyCollections" DROP NOT NULL,
ALTER COLUMN "preferredColorPalette" DROP NOT NULL,
ALTER COLUMN "stagingPreferences" DROP NOT NULL,
ALTER COLUMN "typicalPriceRange" DROP NOT NULL,
ALTER COLUMN "visualReferences" DROP NOT NULL;

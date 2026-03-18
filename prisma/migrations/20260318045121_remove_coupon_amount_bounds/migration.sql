/*
  Warnings:

  - You are about to drop the column `maxDiscountAmount` on the `Coupon` table. All the data in the column will be lost.
  - You are about to drop the column `minPurchaseAmount` on the `Coupon` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Coupon" DROP COLUMN "maxDiscountAmount",
DROP COLUMN "minPurchaseAmount";

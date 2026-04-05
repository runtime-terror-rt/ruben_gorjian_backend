/*
  Warnings:

  - You are about to drop the column `calendlySyncStatus` on the `Post` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Post_calendlySyncStatus_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "calendlySyncStatus";

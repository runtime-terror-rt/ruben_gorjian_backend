/*
  Warnings:

  - Added the required column `platformUsername` to the `SocialPlatformLink` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SocialPlatformLink" ADD COLUMN     "platformUsername" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

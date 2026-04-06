-- AlterTable
ALTER TABLE "ContactSubmission" ADD COLUMN     "isResolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "repliedBy" TEXT,
ADD COLUMN     "replyMessage" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "ContactSubmission_status_idx" ON "ContactSubmission"("status");

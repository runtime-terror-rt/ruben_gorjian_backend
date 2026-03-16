-- CreateEnum
CREATE TYPE "PostLimitType" AS ENUM ('NONE', 'SOFT', 'HARD');

-- CreateEnum
CREATE TYPE "SchedulerRole" AS ENUM ('CLIENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlanCategory" AS ENUM ('CALENDAR_ONLY', 'VISUAL_ADD_ON', 'VISUAL_CALENDAR', 'FULL_MANAGEMENT', 'JEWELRY_CALENDAR_ONLY', 'JEWELRY_VISUAL', 'JEWELRY_FULL_MANAGEMENT');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'BLOCK_USER', 'UNBLOCK_USER', 'CANCEL_SUBSCRIPTION', 'RESEND_VERIFICATION', 'REFRESH_SUBSCRIPTION', 'POST_AS_USER_CREATE', 'POST_AS_USER_PUBLISH', 'POST_AS_USER_SCHEDULE', 'POST_AS_USER_CANCEL', 'ADMIN_POST_PERMISSION_GRANT', 'ADMIN_POST_PERMISSION_REVOKE', 'MEDIA_ADMIN_UPLOAD', 'MEDIA_ADMIN_DELETE');

-- CreateEnum
CREATE TYPE "AdminOperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('STANDARD', 'FOUNDER');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('ORIGINAL', 'ENHANCED');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('USER_UPLOAD', 'ADMIN_UPLOAD');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PostInitiator" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PostTargetStatus" AS ENUM ('PENDING', 'SCHEDULED', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "PublishingProvider" AS ENUM ('NATIVE', 'UPLOAD_POST');

-- CreateEnum
CREATE TYPE "ProviderRoutingMode" AS ENUM ('AUTO', 'FORCE_NATIVE', 'FORCE_UPLOAD_POST');

-- CreateEnum
CREATE TYPE "ExternalIdentifierType" AS ENUM ('JOB_ID', 'REQUEST_ID');

-- CreateEnum
CREATE TYPE "ExternalJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ENHANCED_SENT', 'NEEDS_CHANGES', 'COMPLETED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionPlanCategory" AS ENUM ('FULL_MANAGEMENT', 'VISUAL_ONLY');

-- CreateEnum
CREATE TYPE "SubmissionEventAction" AS ENUM ('SUBMISSION_CREATED', 'STATUS_UPDATED', 'ENHANCED_DELIVERY_SENT');

-- CreateEnum
CREATE TYPE "SubmissionActorRole" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VisualQuotaEventType" AS ENUM ('SUBMISSION_RESERVED', 'SUBMISSION_RELEASED', 'SUBMISSION_CONSUMED', 'TOPUP_CREDIT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SUBMISSION_CREATED', 'SUBMISSION_STATUS_UPDATED', 'ENHANCED_DELIVERY_SENT', 'ADMIN_POST_CREATED', 'ADMIN_POST_PUBLISHED', 'ADMIN_POST_FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isFounder" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "signupDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "googleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "calendarOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "visualOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "fullManagementOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "pendingPlanCode" TEXT,
    "pendingPlanCodeSetAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PlanCategory" NOT NULL,
    "isJewelry" BOOLEAN NOT NULL DEFAULT false,
    "platformLimit" INTEGER,
    "baseVisualQuota" INTEGER,
    "basePostQuota" INTEGER,
    "postLimitType" "PostLimitType" NOT NULL DEFAULT 'NONE',
    "schedulerRole" "SchedulerRole" NOT NULL DEFAULT 'CLIENT',
    "priceStandardCents" INTEGER NOT NULL,
    "priceFounderCents" INTEGER NOT NULL,
    "stripePriceStandardId" TEXT,
    "stripePriceFounderId" TEXT,
    "hasYearlyPrice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "priceType" "PriceType" NOT NULL DEFAULT 'STANDARD',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "addonPlatformQty" INTEGER NOT NULL DEFAULT 0,
    "videoAddonEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChangeLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldPlanCode" TEXT,
    "newPlanCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Founder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Founder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "userId" TEXT NOT NULL,
    "industry" TEXT,
    "productTypes" TEXT,
    "businessType" TEXT,
    "tone" TEXT,
    "audience" TEXT,
    "competitors" TEXT,
    "ctaPreferences" TEXT,
    "hashtagPreferences" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "calendarOnboardingData" JSONB,
    "visualOnboardingData" JSONB,
    "fullManagementOnboardingData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BrandFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brandProfileUserId" TEXT,

    CONSTRAINT "BrandFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'ORIGINAL',
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT,
    "source" "AssetSource" NOT NULL DEFAULT 'USER_UPLOAD',
    "uploadedByAdminId" TEXT,
    "uploadContext" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "captionVariants" JSONB,
    "hashtags" JSONB,
    "ctas" JSONB,
    "shortDescription" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialOAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "state" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT,
    "contentItemId" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "caption" TEXT,
    "hashtags" JSONB,
    "cta" TEXT,
    "shortDescription" TEXT,
    "initiatedBy" "PostInitiator" NOT NULL DEFAULT 'USER',
    "adminId" TEXT,
    "adminReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostTarget" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "status" "PostTargetStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRoutingConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "ProviderRoutingMode" NOT NULL DEFAULT 'FORCE_NATIVE',
    "useInstagram" BOOLEAN NOT NULL DEFAULT true,
    "useFacebook" BOOLEAN NOT NULL DEFAULT true,
    "useLinkedin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRoutingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalPublishingRoutingConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "mode" "ProviderRoutingMode" NOT NULL DEFAULT 'FORCE_NATIVE',
    "applyScope" TEXT NOT NULL DEFAULT 'USERS_ONLY',
    "useInstagram" BOOLEAN NOT NULL DEFAULT true,
    "useFacebook" BOOLEAN NOT NULL DEFAULT true,
    "useLinkedin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalPublishingRoutingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadPostProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "remoteStatusJson" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadPostProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPublishJob" (
    "id" TEXT NOT NULL,
    "postTargetId" TEXT NOT NULL,
    "provider" "PublishingProvider" NOT NULL,
    "remoteJobId" TEXT NOT NULL,
    "identifierType" "ExternalIdentifierType" NOT NULL DEFAULT 'JOB_ID',
    "remoteStatus" "ExternalJobStatus" NOT NULL DEFAULT 'PENDING',
    "lastMessage" TEXT,
    "rawLastResponse" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextPollAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostEvent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMonthly" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "visualsUsed" INTEGER NOT NULL DEFAULT 0,
    "visualsReserved" INTEGER NOT NULL DEFAULT 0,
    "visualsBonus" INTEGER NOT NULL DEFAULT 0,
    "postsUsed" INTEGER NOT NULL DEFAULT 0,
    "platformsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMonthly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSubmission" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "websiteHandle" TEXT,
    "interests" TEXT[],
    "postsPerMonth" TEXT,
    "message" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdIp" TEXT,

    CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "businessName" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "timezone" TEXT,
    "bio" TEXT,
    "avatarStorageKey" TEXT,
    "avatarContentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminOperation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetUserId" TEXT,
    "status" "AdminOperationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostAsset" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "planCategory" "SubmissionPlanCategory" NOT NULL DEFAULT 'FULL_MANAGEMENT',
    "quotaUnitsReserved" INTEGER NOT NULL DEFAULT 0,
    "quotaUnitsConsumed" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "description" TEXT,
    "userNote" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFile" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionEvent" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL,
    "action" "SubmissionEventAction" NOT NULL DEFAULT 'STATUS_UPDATED',
    "actorRole" "SubmissionActorRole",
    "note" TEXT,
    "createdBy" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualQuotaLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL,
    "eventType" "VisualQuotaEventType" NOT NULL,
    "submissionId" TEXT,
    "stripeEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualQuotaLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminPostPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canPostDirectly" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "grantedByAdminId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPostPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnhancedDelivery" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnhancedDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnhancedDeliveryFile" (
    "id" TEXT NOT NULL,
    "enhancedDeliveryId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnhancedDeliveryFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "PlanChangeLog_userId_idx" ON "PlanChangeLog"("userId");

-- CreateIndex
CREATE INDEX "PlanChangeLog_createdAt_idx" ON "PlanChangeLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_eventId_key" ON "ProcessedWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_createdAt_idx" ON "ProcessedWebhookEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Founder_userId_key" ON "Founder"("userId");

-- CreateIndex
CREATE INDEX "BrandFile_userId_idx" ON "BrandFile"("userId");

-- CreateIndex
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");

-- CreateIndex
CREATE INDEX "Asset_uploadedByAdminId_idx" ON "Asset"("uploadedByAdminId");

-- CreateIndex
CREATE INDEX "Asset_source_idx" ON "Asset"("source");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "ContentItem_userId_idx" ON "ContentItem"("userId");

-- CreateIndex
CREATE INDEX "ContentItem_assetId_idx" ON "ContentItem"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_platform_externalAccountId_key" ON "SocialAccount"("userId", "platform", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialOAuthState_state_key" ON "SocialOAuthState"("state");

-- CreateIndex
CREATE INDEX "SocialOAuthState_userId_idx" ON "SocialOAuthState"("userId");

-- CreateIndex
CREATE INDEX "SocialOAuthState_expiresAt_idx" ON "SocialOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "Post_userId_idx" ON "Post"("userId");

-- CreateIndex
CREATE INDEX "Post_scheduledFor_idx" ON "Post"("scheduledFor");

-- CreateIndex
CREATE INDEX "Post_adminId_idx" ON "Post"("adminId");

-- CreateIndex
CREATE INDEX "Post_initiatedBy_idx" ON "Post"("initiatedBy");

-- CreateIndex
CREATE INDEX "PostTarget_postId_idx" ON "PostTarget"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRoutingConfig_userId_key" ON "ProviderRoutingConfig"("userId");

-- CreateIndex
CREATE INDEX "ProviderRoutingConfig_mode_idx" ON "ProviderRoutingConfig"("mode");

-- CreateIndex
CREATE UNIQUE INDEX "UploadPostProfile_userId_key" ON "UploadPostProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadPostProfile_username_key" ON "UploadPostProfile"("username");

-- CreateIndex
CREATE INDEX "ExternalPublishJob_postTargetId_idx" ON "ExternalPublishJob"("postTargetId");

-- CreateIndex
CREATE INDEX "ExternalPublishJob_remoteStatus_idx" ON "ExternalPublishJob"("remoteStatus");

-- CreateIndex
CREATE INDEX "ExternalPublishJob_nextPollAt_idx" ON "ExternalPublishJob"("nextPollAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPublishJob_provider_identifierType_remoteJobId_key" ON "ExternalPublishJob"("provider", "identifierType", "remoteJobId");

-- CreateIndex
CREATE INDEX "PostEvent_postId_idx" ON "PostEvent"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMonthly_userId_periodStart_periodEnd_key" ON "UsageMonthly"("userId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_token_key" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_token_idx" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "ContactSubmission_email_idx" ON "ContactSubmission"("email");

-- CreateIndex
CREATE INDEX "ContactSubmission_createdAt_idx" ON "ContactSubmission"("createdAt");

-- CreateIndex
CREATE INDEX "RecentActivity_userId_idx" ON "RecentActivity"("userId");

-- CreateIndex
CREATE INDEX "RecentActivity_createdAt_idx" ON "RecentActivity"("createdAt");

-- CreateIndex
CREATE INDEX "Campaign_userId_idx" ON "Campaign"("userId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_name_idx" ON "Campaign"("name");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminOperation_key_key" ON "AdminOperation"("key");

-- CreateIndex
CREATE INDEX "AdminOperation_actorId_idx" ON "AdminOperation"("actorId");

-- CreateIndex
CREATE INDEX "AdminOperation_targetUserId_idx" ON "AdminOperation"("targetUserId");

-- CreateIndex
CREATE INDEX "AdminOperation_action_idx" ON "AdminOperation"("action");

-- CreateIndex
CREATE INDEX "PostAsset_assetId_idx" ON "PostAsset"("assetId");

-- CreateIndex
CREATE INDEX "PostAsset_postId_idx" ON "PostAsset"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostAsset_postId_assetId_key" ON "PostAsset"("postId", "assetId");

-- CreateIndex
CREATE INDEX "Submission_userId_idx" ON "Submission"("userId");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- CreateIndex
CREATE INDEX "Submission_createdAt_idx" ON "Submission"("createdAt");

-- CreateIndex
CREATE INDEX "SubmissionFile_submissionId_idx" ON "SubmissionFile"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionEvent_submissionId_idx" ON "SubmissionEvent"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "VisualQuotaLedger_stripeEventId_key" ON "VisualQuotaLedger"("stripeEventId");

-- CreateIndex
CREATE INDEX "VisualQuotaLedger_userId_idx" ON "VisualQuotaLedger"("userId");

-- CreateIndex
CREATE INDEX "VisualQuotaLedger_periodStart_periodEnd_idx" ON "VisualQuotaLedger"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "VisualQuotaLedger_submissionId_idx" ON "VisualQuotaLedger"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPostPermission_userId_key" ON "AdminPostPermission"("userId");

-- CreateIndex
CREATE INDEX "AdminPostPermission_userId_idx" ON "AdminPostPermission"("userId");

-- CreateIndex
CREATE INDEX "AdminPostPermission_grantedByAdminId_idx" ON "AdminPostPermission"("grantedByAdminId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "EnhancedDelivery_submissionId_idx" ON "EnhancedDelivery"("submissionId");

-- CreateIndex
CREATE INDEX "EnhancedDelivery_adminId_idx" ON "EnhancedDelivery"("adminId");

-- CreateIndex
CREATE INDEX "EnhancedDelivery_createdAt_idx" ON "EnhancedDelivery"("createdAt");

-- CreateIndex
CREATE INDEX "EnhancedDeliveryFile_enhancedDeliveryId_idx" ON "EnhancedDeliveryFile"("enhancedDeliveryId");

-- CreateIndex
CREATE INDEX "EnhancedDeliveryFile_storageKey_idx" ON "EnhancedDeliveryFile"("storageKey");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeLog" ADD CONSTRAINT "PlanChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Founder" ADD CONSTRAINT "Founder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandFile" ADD CONSTRAINT "BrandFile_brandProfileUserId_fkey" FOREIGN KEY ("brandProfileUserId") REFERENCES "BrandProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandFile" ADD CONSTRAINT "BrandFile_brandProfile_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOAuthState" ADD CONSTRAINT "SocialOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRoutingConfig" ADD CONSTRAINT "ProviderRoutingConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadPostProfile" ADD CONSTRAINT "UploadPostProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPublishJob" ADD CONSTRAINT "ExternalPublishJob_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostEvent" ADD CONSTRAINT "PostEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMonthly" ADD CONSTRAINT "UsageMonthly_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentActivity" ADD CONSTRAINT "RecentActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminOperation" ADD CONSTRAINT "AdminOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAsset" ADD CONSTRAINT "PostAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAsset" ADD CONSTRAINT "PostAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFile" ADD CONSTRAINT "SubmissionFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionEvent" ADD CONSTRAINT "SubmissionEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualQuotaLedger" ADD CONSTRAINT "VisualQuotaLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualQuotaLedger" ADD CONSTRAINT "VisualQuotaLedger_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPostPermission" ADD CONSTRAINT "AdminPostPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPostPermission" ADD CONSTRAINT "AdminPostPermission_grantedByAdminId_fkey" FOREIGN KEY ("grantedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnhancedDelivery" ADD CONSTRAINT "EnhancedDelivery_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnhancedDelivery" ADD CONSTRAINT "EnhancedDelivery_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnhancedDeliveryFile" ADD CONSTRAINT "EnhancedDeliveryFile_enhancedDeliveryId_fkey" FOREIGN KEY ("enhancedDeliveryId") REFERENCES "EnhancedDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

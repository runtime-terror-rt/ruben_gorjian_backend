import {
  Asset,
  PostStatus,
  Prisma,
  SocialAccount,
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { buildStorageUrl } from "../../lib/validators";
import { logger } from "../../lib/logger";
import { getSubscriptionPeriod } from "../../lib/subscription-period";
import { validatePostAsUserPermission } from "../../middleware/requireAdminPostPermission";
import { SchedulerStorageService, validateSchedulerContentType } from "./storage";
import {
  Actor,
  SchedulerCreateInput,
  SchedulerListFilters,
  SchedulerMultipartUploadInput,
  SchedulerPublishStatusInput,
  SchedulerUpdateInput,
  SchedulerUploadInput,
} from "./interfaces";
import { isAdmin, normalizeDateRange } from "./functions";

const SCHEDULER_UPLOAD_CONTEXT = "SCHEDULER_POST";

function formatHashtags(hashtags?: string[] | null) {
  if (!hashtags) return Prisma.JsonNull;
  const sanitized = hashtags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  return sanitized.length ? sanitized : Prisma.JsonNull;
}


export class SchedulerService {
  private readonly storage = new SchedulerStorageService();

  private toSchedulerStatus(status: PostStatus): "pending" | "completed" | "failed" {
    if (status === "POSTED") return "completed";
    if (status === "FAILED") return "failed";
    return "pending";
  }

  private async resolveTargetUser(actor: Actor, targetUserId?: string) {
    if (!targetUserId || targetUserId === actor.id || !isAdmin(actor)) {
      return actor.id;
    }

    const permission = await validatePostAsUserPermission(actor.id, targetUserId);
    if (!permission.allowed) {
      throw new Error(permission.error || "Not allowed to manage posts for this user");
    }

    return targetUserId;
  }

  private async getOwnedPost(actor: Actor, postId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
          },
        },
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        PostAsset: {
          include: {
            Asset: true,
          },
          orderBy: { order: "asc" },
        },
        targets: {
          include: {
            socialAccount: {
              select: {
                id: true,
                platform: true,
                displayName: true,
                externalAccountId: true,
                expiresAt: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 15,
        },
      },
    });

    if (!post) {
      throw new Error("Scheduled post not found");
    }

    if (!isAdmin(actor) && post.userId !== actor.id) {
      throw new Error("You do not have access to this scheduled post");
    }

    if (isAdmin(actor) && post.userId !== actor.id) {
      const permission = await validatePostAsUserPermission(actor.id, post.userId);
      if (!permission.allowed) {
        throw new Error(permission.error || "Not allowed to manage posts for this user");
      }
    }

    return post;
  }

  private async getSchedulingSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
      select: {
        id: true,
        userId: true,
        status: true,
        planCode: true,
        addonPlatformQty: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        plan: {
          select: {
            code: true,
            platformLimit: true,
            basePostQuota: true,
            postLimitType: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async assertSchedulingAccess(userId: string) {
    const [user, subscription] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
        },
      }),
      this.getSchedulingSubscription(userId),
    ]);

    if (!user) {
      throw new Error("Target user not found");
    }

    if (user.status === "BLOCKED") {
      throw new Error("Blocked users cannot use the scheduler");
    }

    if (user.status === "DELETED") {
      throw new Error("Deleted users cannot use the scheduler");
    }

    if (!subscription?.plan) {
      throw new Error("An active subscription is required to schedule posts");
    }

    return { user, subscription };
  }

  private async validateSocialAccounts(
    userId: string,
    socialAccountIds: string[],
    platformLimit: number | null
  ) {
    const uniqueIds = Array.from(new Set(socialAccountIds));
    const socialAccounts = await prisma.socialAccount.findMany({
      where: {
        id: { in: uniqueIds },
        userId,
      },
      select: {
        id: true,
        platform: true,
        displayName: true,
        externalAccountId: true,
        expiresAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (socialAccounts.length !== uniqueIds.length) {
      throw new Error("Selected target platforms must already be connected by this client");
    }

    if (platformLimit !== null && uniqueIds.length > platformLimit) {
      throw new Error(
        `Selected platform count exceeds the allowed limit for this subscription (${platformLimit})`
      );
    }

    return socialAccounts;
  }

  private async validateAssets(userId: string, assetIds: string[]) {
    const uniqueIds = Array.from(new Set(assetIds));
    const assets = await prisma.asset.findMany({
      where: {
        id: { in: uniqueIds },
        userId,
        status: "READY",
      },
      orderBy: { createdAt: "asc" },
    });

    if (assets.length !== uniqueIds.length) {
      throw new Error("One or more media references are invalid or still uploading");
    }

    const invalidMedia = assets.some((asset) => asset.type !== "IMAGE" && asset.type !== "VIDEO");
    if (invalidMedia) {
      throw new Error("Only image and video assets are supported for scheduled posts");
    }

    return assets;
  }

  private validateMediaRules(accounts: Array<Pick<SocialAccount, "platform">>, assets: Asset[]) {
    const selectedPlatforms = new Set(accounts.map((account) => account.platform));
    const hasInstagram = selectedPlatforms.has("INSTAGRAM");
    const hasMixedMedia =
      assets.length > 1 && new Set(assets.map((asset) => asset.type)).size > 1;

    if (hasInstagram && assets.length === 0) {
      throw new Error("Instagram scheduled posts require at least one media file");
    }

    if (hasInstagram && assets.length > 1) {
      throw new Error("Instagram scheduled posts support only one media file in the current publishing flow");
    }

    if (hasMixedMedia) {
      throw new Error("Mixed image and video uploads are not supported in a single scheduled post");
    }

    if (assets.length > 0 && !env.STORAGE_BASE_URL) {
      throw new Error("STORAGE_BASE_URL must be configured before scheduling media posts");
    }
  }

  private async enforceQuota(
    userId: string,
    subscription: Awaited<ReturnType<SchedulerService["getSchedulingSubscription"]>>,
    excludePostId?: string
  ) {
    if (!subscription?.plan?.basePostQuota || subscription.plan.postLimitType !== "HARD") {
      return;
    }

    const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
    const activeStatuses: PostStatus[] = ["SCHEDULED", "PUBLISHING", "POSTED"];

    const scheduledCount = await prisma.post.count({
      where: {
        userId,
        status: { in: activeStatuses },
        scheduledFor: {
          gte: periodStart,
          lte: periodEnd,
        },
        ...(excludePostId ? { id: { not: excludePostId } } : {}),
      },
    });

    if (scheduledCount >= subscription.plan.basePostQuota) {
      throw new Error(
        `You have reached the scheduled post limit for this billing period (${subscription.plan.basePostQuota})`
      );
    }
  }

  private formatPostResponse(
    post: Awaited<ReturnType<SchedulerService["getOwnedPost"]>>,
    actor: Actor
  ) {
    const ownerSummary = isAdmin(actor)
      ? {
          id: post.user.id,
          email: post.user.email,
          name: post.user.name,
        }
      : undefined;

    const media = post.PostAsset.map((entry) => ({
      id: entry.Asset.id,
      storageKey: entry.Asset.storageKey,
      url: env.STORAGE_BASE_URL
        ? buildStorageUrl(env.STORAGE_BASE_URL, entry.Asset.storageKey)
        : null,
      mimeType: entry.Asset.contentType,
      mediaType: entry.Asset.type,
      source: entry.Asset.source,
      uploadContext: entry.Asset.uploadContext,
      createdAt: entry.Asset.createdAt,
    }));

    const failureReason =
      post.targets.find((target) => target.errorMessage)?.errorMessage ??
      (post.status === "FAILED" ? "One or more publish targets failed" : null);

    return {
      id: post.id,
      caption: post.caption,
      captionPreview: post.caption ? post.caption.slice(0, 140) : null,
      hashtags: Array.isArray(post.hashtags) ? (post.hashtags as string[]) : [],
      cta: post.cta,
      shortDescription: post.shortDescription,
      scheduledAt: post.scheduledFor,
      timezone: null,
      status: post.status,
      schedulerStatus: this.toSchedulerStatus(post.status),
      failureReason,
      selectedPlatforms: post.targets.map((target) => target.platform),
      targets: post.targets.map((target) => ({
        id: target.id,
        platform: target.platform,
        status: target.status,
        scheduledAt: target.scheduledFor,
        publishedAt: target.publishedAt,
        failureReason: target.errorMessage,
        socialAccount: target.socialAccount
          ? {
              id: target.socialAccount.id,
              platform: target.socialAccount.platform,
              displayName: target.socialAccount.displayName,
              externalAccountId: target.socialAccount.externalAccountId,
              expiresAt: target.socialAccount.expiresAt,
            }
          : null,
      })),
      media,
      assets: media.map((item) => item.url).filter((url): url is string => Boolean(url)),
      owner: ownerSummary,
      initiatedBy: post.initiatedBy,
      admin: post.admin,
      adminReason: post.adminReason,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      events: post.events.map((event) => ({
        type: event.type,
        message: event.message,
        createdAt: event.createdAt,
      })),
    };
  }

  private async createAdminNotification(
    targetUserId: string,
    message: string,
    payload: Record<string, unknown>
  ) {
    await prisma.notification.create({
      data: {
        userId: targetUserId,
        type: "ADMIN_POST_CREATED",
        title: "Scheduler updated by admin",
        message,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  async createMediaUploads(actor: Actor, data: SchedulerUploadInput) {
    const userId = await this.resolveTargetUser(actor, data.userId);
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!targetUser) {
      throw new Error("Target user not found");
    }

    if (targetUser.status !== "ACTIVE") {
      throw new Error("Media uploads are only allowed for active users");
    }

    const uploads = await Promise.all(
      data.files.map(async (file) => {
        if (!validateSchedulerContentType(file.contentType)) {
          throw new Error(`Unsupported media type: ${file.contentType}`);
        }

        const signed = await this.storage.createSignedUpload({
          userId,
          fileName: file.fileName,
          contentType: file.contentType,
          fileSize: file.fileSize,
        });

        const asset = await prisma.asset.create({
          data: {
            userId,
            type: signed.mediaType,
            kind: "ORIGINAL",
            storageKey: signed.storageKey,
            contentType: file.contentType,
            source: isAdmin(actor) && userId !== actor.id ? "ADMIN_UPLOAD" : "USER_UPLOAD",
            uploadedByAdminId: isAdmin(actor) && userId !== actor.id ? actor.id : null,
            uploadContext: SCHEDULER_UPLOAD_CONTEXT,
            status: "UPLOADING",
          },
        });

        return {
          id: asset.id,
          storageKey: asset.storageKey,
          uploadUrl: signed.uploadUrl,
          previewUrl: signed.previewUrl,
          mimeType: file.contentType,
          mediaType: signed.mediaType,
          originalFileName: file.fileName,
          status: asset.status,
        };
      })
    );

    return { userId, media: uploads };
  }

  async uploadMediaFiles(actor: Actor, data: SchedulerMultipartUploadInput) {
    const userId = await this.resolveTargetUser(actor, data.userId);
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!targetUser) {
      throw new Error("Target user not found");
    }

    if (targetUser.status !== "ACTIVE") {
      throw new Error("Media uploads are only allowed for active users");
    }

    if (!data.files.length) {
      throw new Error("At least one file is required");
    }

    const assets = [];
    for (const file of data.files) {
      if (!validateSchedulerContentType(file.mimetype)) {
        throw new Error(`Unsupported media type: ${file.mimetype}`);
      }

      const storageKey = this.storage.buildStorageKey(userId, file.originalname);
      await this.storage.uploadBuffer({
        storageKey,
        contentType: file.mimetype,
        body: file.buffer,
      });

      const mediaType = this.storage.inferMediaType(file.originalname, file.mimetype);
      const asset = await prisma.asset.create({
        data: {
          userId,
          type: mediaType,
          kind: "ORIGINAL",
          storageKey,
          contentType: file.mimetype,
          source: isAdmin(actor) && userId !== actor.id ? "ADMIN_UPLOAD" : "USER_UPLOAD",
          uploadedByAdminId: isAdmin(actor) && userId !== actor.id ? actor.id : null,
          uploadContext: SCHEDULER_UPLOAD_CONTEXT,
          status: "READY",
        },
      });

      assets.push({
        id: asset.id,
        storageKey: asset.storageKey,
        previewUrl: this.storage.buildPreviewUrl(asset.storageKey),
        mimeType: asset.contentType,
        mediaType: asset.type,
        originalFileName: file.originalname,
        size: file.size,
        status: asset.status,
      });
    }

    return { userId, media: assets };
  }

  async finalizeMediaUploads(actor: Actor, input: { userId?: string; assetIds: string[] }) {
    const userId = await this.resolveTargetUser(actor, input.userId);
    const uniqueAssetIds = Array.from(new Set(input.assetIds));
    const assets = await prisma.asset.findMany({
      where: {
        id: { in: uniqueAssetIds },
        userId,
        uploadContext: SCHEDULER_UPLOAD_CONTEXT,
      },
    });

    if (assets.length !== uniqueAssetIds.length) {
      throw new Error("One or more scheduler media records were not found");
    }

    const finalized = await Promise.all(
      assets.map((asset) =>
        prisma.asset.update({
          where: { id: asset.id },
          data: {
            status: "READY",
          },
        })
      )
    );

    return {
      userId,
      media: finalized.map((asset) => ({
        id: asset.id,
        storageKey: asset.storageKey,
        previewUrl: this.storage.buildPreviewUrl(asset.storageKey),
        mimeType: asset.contentType,
        mediaType: asset.type,
        status: asset.status,
      })),
    };
  }

  async createScheduledPost(actor: Actor, input: SchedulerCreateInput) {
    const userId = await this.resolveTargetUser(actor, input.userId);

    if (input.scheduledAt <= new Date()) {
      throw new Error("Scheduled time must be in the future");
    }

    const { subscription } = await this.assertSchedulingAccess(userId);
    await this.enforceQuota(userId, subscription);

    const platformLimit =
      subscription.plan.platformLimit !== null && subscription.plan.platformLimit !== undefined
        ? subscription.plan.platformLimit + (subscription.addonPlatformQty ?? 0)
        : null;

    const socialAccounts = await this.validateSocialAccounts(
      userId,
      input.socialAccountIds,
      platformLimit
    );
    const assets = await this.validateAssets(userId, input.assetIds ?? []);
    this.validateMediaRules(socialAccounts, assets);

    const postId = await prisma.$transaction(async (tx) => {
      const post = await tx.post.create({
        data: {
          userId,
          caption: input.caption,
          hashtags: formatHashtags(input.hashtags),
          cta: input.cta ?? null,
          shortDescription: input.shortDescription ?? null,
          scheduledFor: input.scheduledAt,
          status: "SCHEDULED",
          initiatedBy: isAdmin(actor) && userId !== actor.id ? "ADMIN" : "USER",
          adminId: isAdmin(actor) && userId !== actor.id ? actor.id : null,
          adminReason: isAdmin(actor) && userId !== actor.id ? input.adminReason ?? null : null,
          assetId: assets[0]?.id ?? null,
        },
      });

      if (assets.length > 0) {
        await tx.postAsset.createMany({
          data: assets.map((asset, index) => ({
            postId: post.id,
            assetId: asset.id,
            order: index,
          })),
        });
      }

      await tx.postTarget.createMany({
        data: socialAccounts.map((account) => ({
          postId: post.id,
          socialAccountId: account.id,
          platform: account.platform,
          status: "SCHEDULED",
          scheduledFor: input.scheduledAt,
        })),
      });

      await tx.postEvent.create({
        data: {
          postId: post.id,
          type: "SCHEDULER_CREATED",
          message:
            isAdmin(actor) && userId !== actor.id
              ? `Scheduled by admin ${actor.id} for ${input.scheduledAt.toISOString()}`
              : `Scheduled by user for ${input.scheduledAt.toISOString()}`,
        },
      });

      return post.id;
    });

    if (isAdmin(actor) && userId !== actor.id) {
      await this.createAdminNotification(
        userId,
        `An admin scheduled a post for ${input.scheduledAt.toLocaleString()}.`,
        { postId, scheduledAt: input.scheduledAt.toISOString() }
      );
    }

    return this.getScheduledPost(actor, postId);
  }

  async updateScheduledPost(actor: Actor, postId: string, input: SchedulerUpdateInput) {
    const existingPost = await this.getOwnedPost(actor, postId);

    if (existingPost.status === "POSTED") {
      throw new Error("Posted scheduled posts cannot be edited");
    }

    const targetUserId = await this.resolveTargetUser(actor, input.userId ?? existingPost.userId);
    if (targetUserId !== existingPost.userId && !isAdmin(actor)) {
      throw new Error("You cannot reassign scheduled posts");
    }

    const { subscription } = await this.assertSchedulingAccess(existingPost.userId);
    const nextScheduledAt = input.scheduledAt ?? existingPost.scheduledFor;

    if (!nextScheduledAt) {
      throw new Error("Scheduled time is required");
    }
    if (nextScheduledAt <= new Date()) {
      throw new Error("Scheduled time must be in the future");
    }

    await this.enforceQuota(existingPost.userId, subscription, existingPost.id);

    const platformLimit =
      subscription.plan.platformLimit !== null && subscription.plan.platformLimit !== undefined
        ? subscription.plan.platformLimit + (subscription.addonPlatformQty ?? 0)
        : null;

    const nextSocialAccountIds =
      input.socialAccountIds ??
      existingPost.targets
        .map((target) => target.socialAccountId)
        .filter((id): id is string => Boolean(id));
    const nextAssetIds = input.assetIds ?? existingPost.PostAsset.map((entry) => entry.Asset.id);

    const socialAccounts = await this.validateSocialAccounts(
      existingPost.userId,
      nextSocialAccountIds,
      platformLimit
    );
    const assets = await this.validateAssets(existingPost.userId, nextAssetIds);
    this.validateMediaRules(socialAccounts, assets);

    const previousAssetIds = existingPost.PostAsset.map((entry) => entry.Asset.id);
    const removedAssetIds = previousAssetIds.filter((assetId) => !nextAssetIds.includes(assetId));

    await prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: postId },
        data: {
          caption: input.caption ?? existingPost.caption,
          hashtags: input.hashtags ? formatHashtags(input.hashtags) : undefined,
          cta: input.cta !== undefined ? input.cta : existingPost.cta,
          shortDescription:
            input.shortDescription !== undefined
              ? input.shortDescription
              : existingPost.shortDescription,
          scheduledFor: nextScheduledAt,
          status: "SCHEDULED",
          assetId: assets[0]?.id ?? null,
          ...(isAdmin(actor) && existingPost.userId !== actor.id && input.adminReason !== undefined
            ? { adminReason: input.adminReason }
            : {}),
        },
      });

      await tx.postAsset.deleteMany({
        where: { postId },
      });

      if (assets.length > 0) {
        await tx.postAsset.createMany({
          data: assets.map((asset, index) => ({
            postId,
            assetId: asset.id,
            order: index,
          })),
        });
      }

      await tx.postTarget.deleteMany({
        where: { postId },
      });

      await tx.postTarget.createMany({
        data: socialAccounts.map((account) => ({
          postId,
          socialAccountId: account.id,
          platform: account.platform,
          status: "SCHEDULED",
          scheduledFor: nextScheduledAt,
        })),
      });

      await tx.postEvent.create({
        data: {
          postId,
          type: "SCHEDULER_UPDATED",
          message:
            isAdmin(actor) && existingPost.userId !== actor.id
              ? `Updated by admin ${actor.id}`
              : "Updated by owner",
        },
      });
    });

    await this.cleanupOrphanedSchedulerAssets(removedAssetIds, postId);

    if (isAdmin(actor) && existingPost.userId !== actor.id) {
      await this.createAdminNotification(
        existingPost.userId,
        `An admin updated a scheduled post for ${nextScheduledAt.toLocaleString()}.`,
        { postId, scheduledAt: nextScheduledAt.toISOString() }
      );
    }

    return this.getScheduledPost(actor, postId);
  }

  async deleteScheduledPost(actor: Actor, postId: string) {
    const existingPost = await this.getOwnedPost(actor, postId);

    if (existingPost.status === "POSTED") {
      throw new Error("Posted scheduled posts cannot be deleted");
    }

    const assetIds = existingPost.PostAsset.map((entry) => entry.Asset.id);

    await prisma.$transaction(async (tx) => {
      await tx.postTarget.deleteMany({ where: { postId } });
      await tx.postAsset.deleteMany({ where: { postId } });
      await tx.postEvent.deleteMany({ where: { postId } });
      await tx.post.delete({ where: { id: postId } });
    });

    await this.cleanupOrphanedSchedulerAssets(assetIds, postId);

    if (isAdmin(actor) && existingPost.userId !== actor.id) {
      await this.createAdminNotification(existingPost.userId, "An admin deleted a scheduled post.", {
        postId,
      });
    }

    logger.info("Scheduled post deleted", {
      postId,
      actorId: actor.id,
      userId: existingPost.userId,
    });

    return { success: true };
  }

  async getScheduledPost(actor: Actor, postId: string) {
    const post = await this.getOwnedPost(actor, postId);
    return this.formatPostResponse(post, actor);
  }

  async updatePublishStatus(actor: Actor, postId: string, input: SchedulerPublishStatusInput) {
    if (!isAdmin(actor)) {
      throw new Error("Only admin or super admin can update publish status");
    }

    const existingPost = await this.getOwnedPost(actor, postId);
    const targetUserId = await this.resolveTargetUser(actor, input.userId ?? existingPost.userId);
    if (targetUserId !== existingPost.userId) {
      throw new Error("You cannot reassign scheduled posts");
    }

    const nextPostStatus: PostStatus = input.status === "completed" ? "POSTED" : "FAILED";
    const now = new Date();
    const failureReason =
      input.status === "failed"
        ? input.failureReason?.trim() || "Publish failed"
        : null;
    const adminReason = input.adminReason ?? existingPost.adminReason ?? null;
    const nextTargetStatus = input.status === "completed" ? "POSTED" : "FAILED";

    await prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: postId },
        data: {
          status: nextPostStatus,
          adminId: actor.id,
          adminReason,
          updatedAt: now,
        },
      });

      await tx.postTarget.updateMany({
        where: { postId },
        data: {
          status: nextTargetStatus,
          publishedAt: input.status === "completed" ? now : null,
          errorMessage: failureReason,
          updatedAt: now,
        },
      });

      await tx.postEvent.create({
        data: {
          postId,
          type: "SCHEDULER_PUBLISH_STATUS_UPDATED",
          message:
            input.status === "completed"
              ? `Marked completed by admin ${actor.id}`
              : `Marked failed by admin ${actor.id}${failureReason ? `: ${failureReason}` : ""}`,
        },
      });
    });

    await this.createAdminNotification(
      existingPost.userId,
      input.status === "completed"
        ? "Your scheduled post has been marked as completed."
        : "Your scheduled post has been marked as failed.",
      {
        postId,
        schedulerStatus: input.status === "completed" ? "completed" : "failed",
        failureReason,
      }
    );

    return this.getScheduledPost(actor, postId);
  }

  async listScheduledPosts(actor: Actor, filters: SchedulerListFilters) {
    const range = normalizeDateRange(filters);
    const targetUserId =
      filters.userId && isAdmin(actor)
        ? await this.resolveTargetUser(actor, filters.userId)
        : null;

    const where: Prisma.PostWhereInput = {
      ...(isAdmin(actor)
        ? targetUserId
          ? { userId: targetUserId }
          : {}
        : { userId: actor.id }),
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(range.start || range.end
        ? {
            scheduledFor: {
              ...(range.start ? { gte: range.start } : {}),
              ...(range.end ? { lte: range.end } : {}),
            },
          }
        : {}),
      ...(filters.platform?.length
        ? {
            targets: {
              some: {
                platform: { in: filters.platform },
              },
            },
          }
        : {}),
      ...(filters.failure
        ? {
            OR: [
              { status: "FAILED" },
              { targets: { some: { status: "FAILED" } } },
              { targets: { some: { errorMessage: { not: null } } } },
            ],
          }
        : {}),
    };

    const totalCount = await prisma.post.count({ where });
    const skip = (filters.page - 1) * filters.pageSize;
    const posts = await prisma.post.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
          },
        },
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        PostAsset: {
          include: {
            Asset: true,
          },
          orderBy: { order: "asc" },
        },
        targets: {
          include: {
            socialAccount: {
              select: {
                id: true,
                platform: true,
                displayName: true,
                externalAccountId: true,
                expiresAt: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      skip,
      take: filters.pageSize,
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize));

    return {
      items: posts.map((post) => this.formatPostResponse(post as Awaited<ReturnType<SchedulerService["getOwnedPost"]>>, actor)),
      filters: {
        view: filters.view,
        date: filters.date?.toISOString() ?? null,
        from: range.start?.toISOString() ?? null,
        to: range.end?.toISOString() ?? null,
        status: filters.status ?? [],
        failure: filters.failure ?? false,
        userId: targetUserId,
        platform: filters.platform ?? [],
        page: filters.page,
        pageSize: filters.pageSize,
      },
      meta: {
        count: posts.length,
        totalCount,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages,
        hasNextPage: filters.page < totalPages,
        hasPreviousPage: filters.page > 1,
      },
    };
  }

  private async cleanupOrphanedSchedulerAssets(assetIds: string[], deletedPostId: string) {
    if (assetIds.length === 0) {
      return;
    }

    for (const assetId of assetIds) {
      const asset = await prisma.asset.findUnique({
        where: { id: assetId },
        include: {
          posts: {
            where: { id: { not: deletedPostId } },
            select: { id: true },
          },
          PostAsset: {
            where: { postId: { not: deletedPostId } },
            select: { id: true },
          },
          contentItems: {
            select: { id: true },
            take: 1,
          },
        },
      });

      if (!asset) {
        continue;
      }

      const isReferencedElsewhere =
        asset.posts.length > 0 || asset.PostAsset.length > 0 || asset.contentItems.length > 0;

      if (isReferencedElsewhere || asset.uploadContext !== SCHEDULER_UPLOAD_CONTEXT) {
        continue;
      }

      try {
        await this.storage.deleteObject(asset.storageKey);
      } catch (error) {
        logger.warn("Failed to delete scheduler media from S3", {
          assetId: asset.id,
          storageKey: asset.storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await prisma.asset.delete({
        where: { id: asset.id },
      });
    }
  }
}

import { Prisma, SocialPlatform, PostStatus, PostTargetStatus, AssetType } from "@prisma/client";
import { logger } from "../../lib/logger";
import { enqueuePostPublish } from "../jobs/post-queue";
import { validatePostAsUserPermission } from "../../middleware/requireAdminPostPermission";
import { prisma } from "../../lib/prisma";
import { getSubscriptionPeriod } from "../../lib/subscription-period";

export interface CreateAdminPostData {
  userId: string; // Target user to post as
  adminId: string; // Admin who initiated this
  content: {
    caption: string;
    hashtags?: string[];
    cta?: string;
    shortDescription?: string;
  };
  mediaIds?: string[]; // Asset IDs
  platforms: SocialPlatform[]; // Platforms to publish to
  socialAccountIds?: string[]; // Specific social accounts (optional, will use all if not provided)
  publishMode: "NOW" | "SCHEDULE";
  scheduledFor?: Date; // Required if publishMode is SCHEDULE
  timezone?: string; // User timezone for display purposes
  reason?: string; // Admin's reason for posting
}

export interface AdminPostResult {
  post: {
    id: string;
    userId: string;
    caption: string | null;
    hashtags: any;
    status: PostStatus;
    scheduledFor: Date | null;
    initiatedBy: string;
    adminId: string | null;
    adminReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  targets: Array<{
    id: string;
    postId: string;
    platform: SocialPlatform;
    status: PostTargetStatus;
    socialAccountId: string | null;
    scheduledFor: Date | null;
    errorMessage: string | null;
  }>;
  requiresApproval: boolean;
}

export class AdminPostService {
  /**
   * Create a post on behalf of a user
   */
  async createPostAsUser(data: CreateAdminPostData): Promise<AdminPostResult> {
    // 1. Validate admin can post for this user
    const permission = await validatePostAsUserPermission(data.adminId, data.userId);
    if (!permission.allowed) {
      throw new Error(permission.error || "Admin cannot post for this user");
    }

    // 2. Validate target user exists and is active
    const targetUser = await prisma.user.findUnique({
      where: { id: data.userId },
      select: {
        id: true,
        email: true,
        status: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          select: {
            currentPeriodStart: true,
            currentPeriodEnd: true,
            plan: { select: { basePostQuota: true, postLimitType: true, schedulerRole: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!targetUser) {
      throw new Error("Target user not found");
    }

    if (targetUser.status === "BLOCKED" || targetUser.status === "DELETED") {
      throw new Error(`Cannot post for ${targetUser.status.toLowerCase()} users`);
    }

    // 3. Validate platforms - user must have connected social accounts
    const socialAccounts = await prisma.socialAccount.findMany({
      where: {
        userId: data.userId,
        platform: { in: data.platforms },
        ...(data.socialAccountIds && data.socialAccountIds.length > 0
          ? { id: { in: data.socialAccountIds } }
          : {}),
      },
      select: {
        id: true,
        platform: true,
        displayName: true,
        expiresAt: true,
      },
    });

    if (socialAccounts.length === 0) {
      throw new Error("User has not connected any of the selected platforms");
    }

    const connectedPlatforms = new Set(socialAccounts.map((sa) => sa.platform));
    const missingPlatforms = data.platforms.filter((p) => !connectedPlatforms.has(p));
    if (missingPlatforms.length > 0) {
      throw new Error(`User has not connected: ${missingPlatforms.join(", ")}`);
    }

    // Check for expired tokens
    const expiredAccounts = socialAccounts.filter(
      (sa) => sa.expiresAt && sa.expiresAt < new Date()
    );
    if (expiredAccounts.length > 0) {
      logger.warn("Some social accounts have expired tokens", {
        userId: data.userId,
        platforms: expiredAccounts.map((sa) => sa.platform),
      });
      // Don't block - let the publisher handle token refresh
    }

    // 4. Validate media assets
    if (data.platforms.includes("INSTAGRAM") && (!data.mediaIds || data.mediaIds.length === 0)) {
      throw new Error("Instagram posts require at least one image or video");
    }

    if (data.mediaIds && data.mediaIds.length > 0) {
      const assets = await prisma.asset.findMany({
        where: {
          id: { in: data.mediaIds },
          userId: data.userId,
        },
        select: { id: true, type: true, kind: true },
      });

      if (assets.length !== data.mediaIds.length) {
        throw new Error("One or more media assets not found or do not belong to user");
      }

      // Instagram requires at least one image/video
      if (data.platforms.includes("INSTAGRAM")) {
        const hasMedia = assets.some((a) => a.type === "IMAGE" || a.type === "VIDEO");
        if (!hasMedia) {
          throw new Error("Instagram posts require at least one image or video");
        }
      }
    }

    // 5. Validate scheduling
    if (data.publishMode === "SCHEDULE") {
      if (!data.scheduledFor) {
        throw new Error("scheduledFor is required when publishMode is SCHEDULE");
      }
      if (data.scheduledFor <= new Date()) {
        throw new Error("Scheduled time must be in the future");
      }
      // Max 365 days in advance
      const maxScheduleDate = new Date();
      maxScheduleDate.setDate(maxScheduleDate.getDate() + 365);
      if (data.scheduledFor > maxScheduleDate) {
        throw new Error("Cannot schedule more than 365 days in advance");
      }
    }

    // 6. Check plan permissions and post quota
    const subscription = targetUser.subscriptions[0];
    if (subscription?.plan?.schedulerRole !== "ADMIN") {
      throw new Error("This user does not have an admin-managed plan.");
    }

    if (subscription?.plan?.basePostQuota) {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);

      const usage = await prisma.usageMonthly.findFirst({
        where: {
          userId: data.userId,
          periodStart,
          periodEnd,
        },
      });

      const postsUsed = usage?.postsUsed ?? 0;
      if (subscription.plan.postLimitType === "HARD" && postsUsed >= subscription.plan.basePostQuota) {
        throw new Error(
          `User has reached monthly post limit (${subscription.plan.basePostQuota})`
        );
      }
    }

    // 7. Sanitize and format content
    const hashtags = data.content.hashtags
      ? data.content.hashtags
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
          .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
      : [];

    // 8. Create the post
    const postStatus: PostStatus =
      permission.requiresApproval
        ? "DRAFT"
        : data.publishMode === "NOW"
          ? "PUBLISHING"
          : "SCHEDULED";

    const post = await prisma.post.create({
      data: {
        userId: data.userId,
        caption: data.content.caption,
        hashtags: hashtags.length > 0 ? (hashtags as any) : Prisma.JsonNull,
        cta: data.content.cta ?? null,
        shortDescription: data.content.shortDescription ?? null,
        status: postStatus,
        scheduledFor: permission.requiresApproval ? data.scheduledFor ?? null : data.scheduledFor ?? null,
        initiatedBy: "ADMIN",
        adminId: data.adminId,
        adminReason: data.reason ?? null,
        // Link first asset if provided
        assetId: data.mediaIds && data.mediaIds.length > 0 ? data.mediaIds[0] : null,
      },
      select: {
        id: true,
        userId: true,
        caption: true,
        hashtags: true,
        status: true,
        scheduledFor: true,
        initiatedBy: true,
        adminId: true,
        adminReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (subscription?.plan?.basePostQuota && postStatus !== "DRAFT") {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
      await prisma.usageMonthly.upsert({
        where: {
          userId_periodStart_periodEnd: {
            userId: data.userId,
            periodStart,
            periodEnd,
          },
        },
        update: {
          postsUsed: { increment: 1 },
        },
        create: {
          userId: data.userId,
          periodStart,
          periodEnd,
          postsUsed: 1,
          visualsUsed: 0,
          platformsUsed: 0,
        },
      });
    }

    // 9. Link multiple assets if provided
    if (data.mediaIds && data.mediaIds.length > 0) {
      await prisma.postAsset.createMany({
        data: data.mediaIds.map((assetId, index) => ({
          postId: post.id,
          assetId,
          order: index,
        })),
      });
    }

    // 10. Create post targets for each social account
    const targetData = socialAccounts.map((sa) => ({
      postId: post.id,
      socialAccountId: sa.id,
      platform: sa.platform,
      status:
        permission.requiresApproval
          ? ("PENDING" as PostTargetStatus)
          : postStatus === "PUBLISHING"
            ? ("PENDING" as PostTargetStatus)
            : ("SCHEDULED" as PostTargetStatus),
      scheduledFor: data.scheduledFor ?? null,
    }));

    await prisma.postTarget.createMany({
      data: targetData,
    });

    const targets = await prisma.postTarget.findMany({
      where: { postId: post.id },
      select: {
        id: true,
        postId: true,
        platform: true,
        status: true,
        socialAccountId: true,
        scheduledFor: true,
        errorMessage: true,
      },
    });

    // 11. Create post event
    await prisma.postEvent.create({
      data: {
        postId: post.id,
        type: "ADMIN_POST_CREATED",
        message: `Post created by admin (${data.adminId}) on behalf of user. Reason: ${
          data.reason ?? "N/A"
        }`,
      },
    });

    // 12. Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: data.adminId,
        actorEmail: (await prisma.user.findUnique({ where: { id: data.adminId }, select: { email: true } }))
          ?.email || "unknown",
        action:
          permission.requiresApproval
            ? "POST_AS_USER_CREATE"
            : data.publishMode === "NOW"
              ? "POST_AS_USER_PUBLISH"
              : "POST_AS_USER_SCHEDULE",
        targetUserId: data.userId,
        metadata: {
          postId: post.id,
          platforms: data.platforms,
          publishMode: data.publishMode,
          scheduledFor: data.scheduledFor?.toISOString(),
          reason: data.reason,
          // Do NOT log tokens, media URLs, or sensitive data
          hasMedia: (data.mediaIds?.length ?? 0) > 0,
          mediaCount: data.mediaIds?.length ?? 0,
        },
      },
    });

    // 13. Create notification for user
    await prisma.notification.create({
      data: {
        userId: data.userId,
        type: "ADMIN_POST_CREATED",
        title: "Admin posted on your behalf",
        message:
          permission.requiresApproval
            ? `An admin requested approval to post to ${data.platforms.join(", ")}.`
            : data.publishMode === "NOW"
              ? `An admin created and published a post to ${data.platforms.join(", ")}.`
              : `An admin scheduled a post to ${data.platforms.join(", ")} for ${data.scheduledFor?.toLocaleString()}.`,
        payload: {
          postId: post.id,
          platforms: data.platforms,
          publishMode: data.publishMode,
          scheduledFor: data.scheduledFor?.toISOString(),
          adminReason: data.reason,
          requiresApproval: permission.requiresApproval,
        },
      },
    });

    // 14. Enqueue for publishing if NOW
    if (data.publishMode === "NOW" && permission.requiresApproval === false) {
      const queued = await enqueuePostPublish(post.id);
      if (!queued) {
        logger.warn("Failed to enqueue admin post for immediate publishing, will be picked up by scheduler", {
          postId: post.id,
        });
      }
    }

    logger.info("Admin post created successfully", {
      postId: post.id,
      adminId: data.adminId,
      userId: data.userId,
      platforms: data.platforms,
      publishMode: data.publishMode,
      requiresApproval: permission.requiresApproval,
    });

    return {
      post,
      targets,
      requiresApproval: permission.requiresApproval,
    };
  }

  /**
   * Get admin-initiated posts for a user
   */
  async getAdminPostsForUser(
    userId: string,
    options?: {
      page?: number;
      pageSize?: number;
      status?: PostStatus;
    }
  ) {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;

    const where = {
      userId,
      initiatedBy: "ADMIN" as const,
      ...(options?.status ? { status: options.status } : {}),
    };

    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          caption: true,
          hashtags: true,
          status: true,
          scheduledFor: true,
          adminId: true,
          adminReason: true,
          createdAt: true,
          updatedAt: true,
          admin: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          targets: {
            select: {
              id: true,
              platform: true,
              status: true,
              publishedAt: true,
              externalPostId: true,
              errorMessage: true,
              socialAccount: {
                select: {
                  id: true,
                  displayName: true,
                },
              },
            },
          },
          PostAsset: {
            select: {
              Asset: {
                select: {
                  id: true,
                  type: true,
                  storageKey: true,
                },
              },
            },
            orderBy: { order: "asc" },
          },
        },
      }),
    ]);

    return {
      items: posts,
      page,
      pageSize,
      total,
    };
  }

  /**
   * Cancel a scheduled admin post
   */
  async cancelAdminPost(postId: string, adminId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        userId: true,
        status: true,
        initiatedBy: true,
        adminId: true,
      },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.initiatedBy !== "ADMIN") {
      throw new Error("This is not an admin-initiated post");
    }

    if (post.status !== "SCHEDULED") {
      throw new Error(`Cannot cancel post with status: ${post.status}`);
    }

    // Update post status
    const updated = await prisma.post.update({
      where: { id: postId },
      data: {
        status: "DRAFT",
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

    // Update targets
    await prisma.postTarget.updateMany({
      where: { postId },
      data: { status: "PENDING" },
    });

    // Create event
    await prisma.postEvent.create({
      data: {
        postId,
        type: "ADMIN_POST_CANCELED",
        message: `Post canceled by admin (${adminId})`,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorEmail: (await prisma.user.findUnique({ where: { id: adminId }, select: { email: true } }))
          ?.email || "unknown",
        action: "POST_AS_USER_CANCEL",
        targetUserId: post.userId,
        metadata: { postId },
      },
    });

    // Notification
    await prisma.notification.create({
      data: {
        userId: post.userId,
        type: "SUBMISSION_STATUS_UPDATED",
        title: "Scheduled post canceled",
        message: "An admin canceled a scheduled post.",
        payload: { postId },
      },
    });

    logger.info("Admin post canceled", { postId, adminId, userId: post.userId });

    return updated;
  }

  /**
   * Approve a pending admin post
   */
  async approveAdminPost(postId: string, adminId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        userId: true,
        status: true,
        initiatedBy: true,
        adminId: true,
        scheduledFor: true,
      },
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.initiatedBy !== "ADMIN") {
      throw new Error("This is not an admin-initiated post");
    }

    if (post.status !== "DRAFT") {
      throw new Error(`Cannot approve post with status: ${post.status}`);
    }

    const permission = await validatePostAsUserPermission(adminId, post.userId);
    if (!permission.allowed) {
      throw new Error(permission.error || "Admin cannot post for this user");
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: post.userId },
      select: {
        id: true,
        status: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          select: {
            currentPeriodStart: true,
            currentPeriodEnd: true,
            plan: { select: { basePostQuota: true, postLimitType: true, schedulerRole: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!targetUser) {
      throw new Error("Target user not found");
    }

    if (targetUser.status === "BLOCKED" || targetUser.status === "DELETED") {
      throw new Error(`Cannot post for ${targetUser.status.toLowerCase()} users`);
    }

    const subscription = targetUser.subscriptions[0];
    if (subscription?.plan?.schedulerRole !== "ADMIN") {
      throw new Error("This user does not have an admin-managed plan.");
    }

    if (subscription?.plan?.basePostQuota) {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);

      const usage = await prisma.usageMonthly.findFirst({
        where: {
          userId: post.userId,
          periodStart,
          periodEnd,
        },
      });

      const postsUsed = usage?.postsUsed ?? 0;
      if (subscription.plan.postLimitType === "HARD" && postsUsed >= subscription.plan.basePostQuota) {
        throw new Error(
          `User has reached monthly post limit (${subscription.plan.basePostQuota})`
        );
      }
    }

    const now = new Date();
    const shouldSchedule = post.scheduledFor && post.scheduledFor > now;
    const nextStatus: PostStatus = shouldSchedule ? "SCHEDULED" : "PUBLISHING";
    const targetStatus: PostTargetStatus = shouldSchedule ? "SCHEDULED" : "PENDING";

    const updated = await prisma.post.update({
      where: { id: postId },
      data: {
        status: nextStatus,
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        updatedAt: true,
      },
    });

    if (subscription?.plan?.basePostQuota) {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
      await prisma.usageMonthly.upsert({
        where: {
          userId_periodStart_periodEnd: {
            userId: post.userId,
            periodStart,
            periodEnd,
          },
        },
        update: {
          postsUsed: { increment: 1 },
        },
        create: {
          userId: post.userId,
          periodStart,
          periodEnd,
          postsUsed: 1,
          visualsUsed: 0,
          platformsUsed: 0,
        },
      });
    }

    await prisma.postTarget.updateMany({
      where: { postId },
      data: { status: targetStatus },
    });

    await prisma.postEvent.create({
      data: {
        postId,
        type: "ADMIN_POST_APPROVED",
        message: `Post approved by admin (${adminId})`,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorEmail: (await prisma.user.findUnique({ where: { id: adminId }, select: { email: true } }))
          ?.email || "unknown",
        action: shouldSchedule ? "POST_AS_USER_SCHEDULE" : "POST_AS_USER_PUBLISH",
        targetUserId: post.userId,
        metadata: { postId, status: nextStatus },
      },
    });

    await prisma.notification.create({
      data: {
        userId: post.userId,
        type: "ADMIN_POST_CREATED",
        title: "Admin post approved",
        message: shouldSchedule
          ? `Your admin post was approved and scheduled for ${post.scheduledFor?.toLocaleString()}.`
          : "Your admin post was approved and queued for publishing.",
        payload: { postId, scheduledFor: post.scheduledFor?.toISOString() },
      },
    });

    if (!shouldSchedule) {
      const queued = await enqueuePostPublish(postId);
      if (!queued) {
        logger.warn("Failed to enqueue approved admin post, will be picked up by scheduler", {
          postId,
        });
      }
    }

    logger.info("Admin post approved", { postId, adminId, userId: post.userId, status: nextStatus });

    return updated;
  }

  /**
   * Get user's connected platforms for admin posting
   */
  async getUserConnectedPlatforms(userId: string) {
    const accounts = await prisma.socialAccount.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        displayName: true,
        externalAccountId: true,
        expiresAt: true,
        updatedAt: true,
      },
      orderBy: { platform: "asc" },
    });

    return accounts.map((acc) => ({
      id: acc.id,
      platform: acc.platform,
      displayName: acc.displayName,
      externalAccountId: acc.externalAccountId,
      isExpired: acc.expiresAt ? acc.expiresAt < new Date() : false,
      lastUpdated: acc.updatedAt,
    }));
  }

  /**
   * Get user's media assets for admin posting
   */
  async getUserMedia(
    userId: string,
    options?: {
      type?: AssetType;
      page?: number;
      pageSize?: number;
    }
  ) {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;

    const where = {
      userId,
      ...(options?.type ? { type: options.type } : {}),
    };

    const [total, assets] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          kind: true,
          storageKey: true,
          contentType: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items: assets,
      page,
      pageSize,
      total,
    };
  }
}

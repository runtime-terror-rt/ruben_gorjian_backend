import { Prisma, PostStatus, SocialPlatform, AssetType, PostTargetStatus } from "@prisma/client";
import { SocialPublisher } from "../social/publisher";
import { logger } from "../../lib/logger";
import { getSubscriptionPeriod } from "../../lib/subscription-period";
import { decidePublishingProvider } from "../social/provider-routing";
import { UploadPostService } from "../providers/upload-post/service";
import { prisma } from "../../lib/prisma";

const publisher = new SocialPublisher();
const uploadPostService = new UploadPostService();

export interface CreatePostData {
  assetId?: string;
  assetIds?: string[];
  contentItemId?: string;
  caption: string;
  hashtags?: string[];
  scheduledFor?: Date;
  platforms: SocialPlatform[];
  socialAccountIds?: string[];
}

export interface CalendarPost {
  id: string;
  caption: string | null;
  hashtags?: string[] | null;
  scheduledFor: Date | null;
  status: PostStatus;
  asset?: {
    id: string;
    storageKey: string;
    type: AssetType;
    contentType: string | null;
  };
  targets: {
    id: string;
    platform: SocialPlatform;
    status: PostTargetStatus;
    errorMessage?: string | null;
    externalPostId?: string | null;
    publishedAt?: Date | null;
    socialAccount?: {
      id: string;
      displayName: string | null;
    };
  }[];
}

export class PostService {
  private formatHashtags(hashtags?: string[] | null) {
    if (!hashtags) return null;
    const sanitized = hashtags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
    return sanitized.length ? sanitized : null;
  }

  async createPost(userId: string, data: CreatePostData) {
    // Check plan rules for client scheduling
    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    });

    const shouldCountUsage = Boolean(data.scheduledFor);

    if (subscription?.plan?.basePostQuota && shouldCountUsage) {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);

      const usage = await prisma.usageMonthly.findFirst({
        where: {
          userId,
          periodStart,
          periodEnd,
        },
      });

      const postsUsed = usage?.postsUsed ?? 0;
      if (subscription.plan.postLimitType === "HARD" && postsUsed >= subscription.plan.basePostQuota) {
        throw new Error(`You have reached your monthly post limit (${subscription.plan.basePostQuota}). Please upgrade your plan to schedule more posts.`);
      }
    }

    // Validate user owns the assets and social accounts
    const assetIdsToValidate = data.assetIds && data.assetIds.length > 0
      ? data.assetIds
      : data.assetId
        ? [data.assetId]
        : [];

    if (assetIdsToValidate.length > 0) {
      const assets = await prisma.asset.findMany({
        where: { id: { in: assetIdsToValidate }, userId }
      });
      if (assets.length !== assetIdsToValidate.length) {
        throw new Error("One or more assets not found");
      }
    }

    // Validate social accounts belong to user
    // If socialAccountIds not provided, fetch based on platforms
    const requestedSocialAccountIds = data.socialAccountIds ?? [];
    let socialAccounts;
    if (requestedSocialAccountIds.length > 0) {
      socialAccounts = await prisma.socialAccount.findMany({
        where: { 
          id: { in: requestedSocialAccountIds },
          userId 
        }
      });

      if (socialAccounts.length !== requestedSocialAccountIds.length) {
        throw new Error("One or more social accounts not found");
      }

      for (const account of socialAccounts) {
        const nativeAllowed =
          Boolean(account.accessToken) &&
          !String(account.externalAccountId || "").startsWith("upload-post:");
        await decidePublishingProvider({
          userId,
          platform: account.platform,
          nativeAllowed,
        });
      }
    } else {
      // Derive from platforms
      socialAccounts = await prisma.socialAccount.findMany({
        where: {
          userId,
          platform: { in: data.platforms }
        }
      });

      if (socialAccounts.length === 0) {
        const providers = await Promise.all(
          data.platforms.map(async (platform) => {
            const provider = await decidePublishingProvider({
              userId,
              platform,
              nativeAllowed: false,
            });
            return { platform, provider };
          })
        );
        const hasUploadPostPath = providers.some((p) => p.provider === "UPLOAD_POST");
        if (!hasUploadPostPath) {
          throw new Error("No social accounts found for the specified platforms");
        }
      }
    }

    // Determine platforms from both explicit selection and connected account resolution
    const selectedPlatforms = Array.from(new Set(data.platforms));

    // Validate Instagram requires media (single asset only)
    const hasInstagram = selectedPlatforms.includes("INSTAGRAM");
    if (hasInstagram && assetIdsToValidate.length === 0) {
      throw new Error("Instagram requires media. Please attach an image or video before scheduling for Instagram.");
    }
    if (hasInstagram && assetIdsToValidate.length > 1) {
      throw new Error("Instagram only supports a single media file. Please select only one asset when posting to Instagram.");
    }

    // Validate STORAGE_BASE_URL is set if Instagram is selected and asset exists
    if (hasInstagram && assetIdsToValidate.length > 0) {
      const baseUrl = process.env.STORAGE_BASE_URL;
      if (!baseUrl) {
        throw new Error("Media storage is not configured. Instagram posts require accessible media URLs. Please contact support.");
      }
    }

    // Build target definitions.
    // If socialAccountIds are explicitly provided, use only those.
    const targetDefs: Array<{ socialAccountId: string | null; platform: SocialPlatform }> = [];
    if (requestedSocialAccountIds.length > 0) {
      for (const socialAccountId of requestedSocialAccountIds) {
        const account = socialAccounts.find(acc => acc.id === socialAccountId);
        if (!account) continue;
        targetDefs.push({ socialAccountId, platform: account.platform });
      }
    } else {
      for (const account of socialAccounts) {
        if (selectedPlatforms.includes(account.platform)) {
          targetDefs.push({ socialAccountId: account.id, platform: account.platform });
        }
      }

      // Add Upload-Post-only targets for selected platforms lacking native accounts.
      for (const platform of selectedPlatforms) {
        const alreadyPresent = targetDefs.some((t) => t.platform === platform);
        if (alreadyPresent) continue;
        const provider = await decidePublishingProvider({
          userId,
          platform,
          nativeAllowed: false,
        });
        if (provider === "UPLOAD_POST") {
          targetDefs.push({ socialAccountId: null, platform });
        }
      }

      if (targetDefs.length === 0) {
        throw new Error("No social accounts found for the specified platforms");
      }
    }

    // Create the post
    // Store the first assetId for backward compatibility, but we'll use assetIds when publishing
    const primaryAssetId = assetIdsToValidate.length > 0 ? assetIdsToValidate[0] : data.assetId;
    const post = await prisma.post.create({
      data: {
        userId,
        assetId: primaryAssetId,
        contentItemId: data.contentItemId,
        caption: data.caption,
        hashtags: this.formatHashtags(data.hashtags) ?? Prisma.JsonNull,
        scheduledFor: data.scheduledFor,
        status: data.scheduledFor ? "SCHEDULED" : "DRAFT"
      }
    });

    if (assetIdsToValidate.length > 0) {
      await prisma.postAsset.createMany({
        data: assetIdsToValidate.map((assetId, index) => ({
          postId: post.id,
          assetId,
          order: index,
        })),
        skipDuplicates: true,
      });
    }

    if (subscription?.plan?.basePostQuota && shouldCountUsage) {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
      await prisma.usageMonthly.upsert({
        where: {
          userId_periodStart_periodEnd: {
            userId,
            periodStart,
            periodEnd,
          },
        },
        update: {
          postsUsed: { increment: 1 },
        },
        create: {
          userId,
          periodStart,
          periodEnd,
          postsUsed: 1,
          visualsUsed: 0,
          platformsUsed: 0,
        },
      });
    }

    // Store multiple asset IDs in a JSON field if available, or we'll fetch them from a relation
    // For now, we'll store them in a separate table or fetch during publish
    // Since Prisma doesn't have a direct array field, we'll handle this in publishPost

    // Create post targets for each platform/account
    const targets = await Promise.all(
      targetDefs.map(async (target) =>
        prisma.postTarget.create({
          data: {
            postId: post.id,
            socialAccountId: target.socialAccountId,
            platform: target.platform,
            status: "PENDING"
          }
        })
      )
    );

    return { post, targets };
  }

  async listPosts(
    userId: string,
    options: {
      cursor?: string;
      limit?: number;
      status?: PostStatus[];
      search?: string;
    }
  ) {
    const take = Math.min(options.limit ?? 20, 50);
    const posts = await prisma.post.findMany({
      where: {
        userId,
        ...(options.status?.length ? { status: { in: options.status } } : {}),
        ...(options.search
          ? {
              OR: [
                { caption: { contains: options.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: {
        asset: {
          select: {
            id: true,
            storageKey: true,
            type: true,
            contentType: true,
          },
        },
        targets: {
          include: {
            socialAccount: {
              select: {
                id: true,
                platform: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (posts.length > take) {
      const next = posts.pop();
      nextCursor = next?.id ?? null;
    }

    return {
      items: posts,
      nextCursor,
    };
  }

  async getPost(userId: string, postId: string) {
    const post = await prisma.post.findFirst({
      where: { id: postId, userId },
      include: {
        asset: {
          select: {
            id: true,
            storageKey: true,
            type: true,
            contentType: true,
          },
        },
        targets: {
          include: {
            socialAccount: {
              select: {
                id: true,
                platform: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return post;
  }

  async getCalendarPosts(
    userId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<CalendarPost[]> {
    const posts = await prisma.post.findMany({
      where: {
        userId,
        scheduledFor: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        asset: {
          select: {
            id: true,
            storageKey: true,
            type: true,
            contentType: true
          }
        },
        targets: {
          include: {
            socialAccount: {
              select: {
                id: true,
                displayName: true
              }
            }
          }
        }
      },
      orderBy: { scheduledFor: "asc" }
    });

    return posts.map(post => ({
      id: post.id,
      caption: post.caption,
      hashtags: post.hashtags as string[] | null,
      scheduledFor: post.scheduledFor,
      status: post.status,
      asset: post.asset
        ? {
            id: post.asset.id,
            storageKey: post.asset.storageKey,
            type: post.asset.type,
            contentType: post.asset.contentType ?? null
          }
        : undefined,
      targets: post.targets.map(target => ({
        id: target.id,
        platform: target.platform,
        status: target.status,
        errorMessage: target.errorMessage ?? undefined,
        externalPostId: target.externalPostId ?? undefined,
        publishedAt: target.publishedAt ?? undefined,
        socialAccount: target.socialAccount || undefined
      }))
    }));
  }

  async updatePost(userId: string, postId: string, updates: Partial<CreatePostData>) {
    // Verify ownership
    const existingPost = await prisma.post.findFirst({
      where: { id: postId, userId },
      include: {
        targets: {
          include: {
            socialAccount: true
          }
        }
      }
    });

    if (!existingPost) {
      throw new Error("Post not found");
    }

    if (existingPost.status === "POSTED") {
      throw new Error("Cannot update posted content");
    }

    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    // Validate Instagram media requirement if platforms are being updated
    if (updates.socialAccountIds) {
      const socialAccounts = await prisma.socialAccount.findMany({
        where: { 
          id: { in: updates.socialAccountIds },
          userId 
        }
      });

      const hasInstagram = socialAccounts.some(acc => acc.platform === "INSTAGRAM");
      const finalAssetId = updates.assetId ?? existingPost.assetId;
      
      if (hasInstagram && !finalAssetId) {
        throw new Error("Instagram requires media. Please attach an image or video before scheduling for Instagram.");
      }

      if (hasInstagram && finalAssetId) {
        const baseUrl = process.env.STORAGE_BASE_URL;
        if (!baseUrl) {
          throw new Error("Media storage is not configured. Instagram posts require accessible media URLs. Please contact support.");
        }
      }
    } else {
      // Check existing targets for Instagram
      const hasInstagram = existingPost.targets.some(t => t.socialAccount?.platform === "INSTAGRAM");
      const finalAssetId = updates.assetId ?? existingPost.assetId;
      
      if (hasInstagram && !finalAssetId) {
        throw new Error("Instagram requires media. Please attach an image or video before scheduling for Instagram.");
      }

      if (hasInstagram && finalAssetId) {
        const baseUrl = process.env.STORAGE_BASE_URL;
        if (!baseUrl) {
          throw new Error("Media storage is not configured. Instagram posts require accessible media URLs. Please contact support.");
        }
      }
    }

    const scheduledNow = !existingPost.scheduledFor && Boolean(updates.scheduledFor);
    let usageWindow: { periodStart: Date; periodEnd: Date } | null = null;

    if (scheduledNow && subscription?.plan?.basePostQuota) {
      usageWindow = getSubscriptionPeriod(subscription);
      const usage = await prisma.usageMonthly.findFirst({
        where: { userId, periodStart: usageWindow.periodStart, periodEnd: usageWindow.periodEnd },
      });
      const postsUsed = usage?.postsUsed ?? 0;

      if (subscription.plan.postLimitType === "HARD" && postsUsed >= subscription.plan.basePostQuota) {
        throw new Error(`You have reached your monthly post limit (${subscription.plan.basePostQuota}). Please upgrade your plan to schedule more posts.`);
      }
    }

    // Update the post
    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        caption: updates.caption,
        scheduledFor: updates.scheduledFor,
        assetId: updates.assetId,
        contentItemId: updates.contentItemId,
        ...(updates.scheduledFor ? { status: "SCHEDULED" } : {}),
        hashtags: updates.hashtags
          ? (this.formatHashtags(updates.hashtags) ?? Prisma.JsonNull)
          : undefined,
      }
    });

    if (scheduledNow && subscription?.plan?.basePostQuota && usageWindow) {
      await prisma.usageMonthly.upsert({
        where: {
          userId_periodStart_periodEnd: {
            userId,
            periodStart: usageWindow.periodStart,
            periodEnd: usageWindow.periodEnd,
          },
        },
        update: {
          postsUsed: { increment: 1 },
        },
        create: {
          userId,
          periodStart: usageWindow.periodStart,
          periodEnd: usageWindow.periodEnd,
          postsUsed: 1,
          visualsUsed: 0,
          platformsUsed: 0,
        },
      });
    }

    // Update targets if platforms changed
    if (updates.socialAccountIds) {
      // Delete existing targets
      await prisma.postTarget.deleteMany({
        where: { postId }
      });

      // Create new targets
      const socialAccounts = await prisma.socialAccount.findMany({
        where: { 
          id: { in: updates.socialAccountIds },
          userId 
        }
      });

      await Promise.all(
        updates.socialAccountIds.map(async (socialAccountId) => {
          const account = socialAccounts.find(acc => acc.id === socialAccountId);
          return prisma.postTarget.create({
            data: {
              postId,
              socialAccountId,
              platform: account!.platform,
              status: "PENDING"
            }
          });
        })
      );
    }

    return updatedPost;
  }

  async deletePost(userId: string, postId: string) {
    const post = await prisma.post.findFirst({
      where: { id: postId, userId }
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.status === "POSTED") {
      throw new Error("Cannot delete posted content");
    }

    // Delete targets first (foreign key constraint)
    await prisma.postTarget.deleteMany({
      where: { postId }
    });

    // Delete the post
    await prisma.post.delete({
      where: { id: postId }
    });

    return { success: true };
  }

  async schedulePost(userId: string, postId: string) {
    const post = await prisma.post.findFirst({
      where: { id: postId, userId },
      include: { targets: true }
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.targets.length === 0) {
      throw new Error("No platforms selected for this post");
    }

    if (post.status === "SCHEDULED") {
      return { success: true };
    }

    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    if (subscription?.plan?.basePostQuota) {
      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
      const usage = await prisma.usageMonthly.findFirst({
        where: { userId, periodStart, periodEnd },
      });
      const postsUsed = usage?.postsUsed ?? 0;
      if (subscription.plan.postLimitType === "HARD" && postsUsed >= subscription.plan.basePostQuota) {
        throw new Error(`You have reached your monthly post limit (${subscription.plan.basePostQuota}). Please upgrade your plan to schedule more posts.`);
      }

      await prisma.usageMonthly.upsert({
        where: {
          userId_periodStart_periodEnd: {
            userId,
            periodStart,
            periodEnd,
          },
        },
        update: {
          postsUsed: { increment: 1 },
        },
        create: {
          userId,
          periodStart,
          periodEnd,
          postsUsed: 1,
          visualsUsed: 0,
          platformsUsed: 0,
        },
      });
    }

    // Update status to scheduled
    await prisma.post.update({
      where: { id: postId },
      data: { status: "SCHEDULED" }
    });

    return { success: true };
  }

  async publishPost(postId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        asset: true,
        PostAsset: {
          include: {
            Asset: true,
          },
          orderBy: { order: "asc" },
        },
        targets: {
          include: { socialAccount: true }
        }
      }
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (!post.scheduledFor) {
      const subscription = await prisma.subscription.findFirst({
        where: { userId: post.userId, status: "ACTIVE" },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      });

      if (subscription?.plan?.basePostQuota) {
        const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
        const usage = await prisma.usageMonthly.findFirst({
          where: { userId: post.userId, periodStart, periodEnd },
        });
        const postsUsed = usage?.postsUsed ?? 0;
        if (subscription.plan.postLimitType === "HARD" && postsUsed >= subscription.plan.basePostQuota) {
          throw new Error(
            `You have reached your monthly post limit (${subscription.plan.basePostQuota}). Please upgrade your plan to publish more posts.`
          );
        }
      }
    }

    const hashtags = Array.isArray(post.hashtags)
      ? (post.hashtags as string[])
      : typeof post.hashtags === "string"
        ? [post.hashtags]
        : [];
    const captionWithHashtags = [post.caption ?? "", hashtags.join(" ").trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    // Fetch all assets for this post
    const baseUrl = process.env.STORAGE_BASE_URL;
    const assets = post.PostAsset.length > 0
      ? post.PostAsset.map((entry) => entry.Asset)
      : post.asset
        ? [post.asset]
        : [];
    
    // Build mediaUrls array for multiple media support
    const mediaUrls = assets
      .filter((asset) => asset.storageKey && baseUrl)
      .map((asset) => {
        return {
          url: `${baseUrl!.replace(/\/$/, "")}/${asset.storageKey}`,
          type: (asset.type === "IMAGE" ? "image" : "video") as "image" | "video",
        };
      });

    const results = await Promise.all(
      post.targets.map(async (target) => {
        try {
          // For Instagram, use single media (first asset)
          // For Facebook, use multiple media if available
          const isInstagram = target.platform === "INSTAGRAM";
          const mediaToUse = isInstagram && mediaUrls.length > 0
            ? [mediaUrls[0]]
            : mediaUrls;

          const content = {
            text: captionWithHashtags,
            ...(mediaToUse.length === 1
              ? {
                  mediaUrl: mediaToUse[0].url,
                  mediaType: mediaToUse[0].type,
                }
              : mediaToUse.length > 1
                ? {
                    mediaUrls: mediaToUse,
                  }
                : {}),
          };

          // Validate Instagram media requirement before publishing
          if (target.platform === "INSTAGRAM" && mediaToUse.length === 0) {
            const errorMsg = "Instagram requires media. Media URL is missing.";
            await prisma.postTarget.update({
              where: { id: target.id },
              data: {
                status: "FAILED",
                errorMessage: errorMsg
              }
            });
            logger.warn(`Instagram post ${postId} target ${target.id} failed: ${errorMsg}`);
            return { targetId: target.id, success: false, error: errorMsg };
          }

          const provider = await decidePublishingProvider({
            userId: post.userId,
            platform: target.platform,
            nativeAllowed:
              Boolean(target.socialAccount?.id) &&
              Boolean(target.socialAccount?.accessToken) &&
              !String(target.socialAccount?.externalAccountId || "").startsWith("upload-post:"),
          });
          let providerUsed = provider;

          let result: { success: boolean; externalPostId?: string; error?: string };
          let pending = false;
          if (provider === "UPLOAD_POST") {
            const uploadResult = await uploadPostService.publishForTarget({
              postTargetId: target.id,
              userId: post.userId,
              platform: target.platform,
              caption: content.text,
              mediaUrls: mediaToUse,
            });

            // Upload-Post may return "posted" (sync) or "completed" (async status API)
            const statusLower = String(uploadResult.status || "").toLowerCase();
            const isTerminalPosted = statusLower === "posted" || statusLower === "completed";
            const isTerminalFailed = statusLower === "failed" || statusLower === "partially_posted";
            if (isTerminalPosted) {
              result = {
                success: true,
                externalPostId: uploadResult.identifier,
              };
            } else if (isTerminalFailed) {
              result = {
                success: false,
                externalPostId: uploadResult.identifier,
                error: uploadResult.message || "Upload-Post reported failure",
              };
            } else {
              pending = true;
              result = {
                success: false,
                externalPostId: uploadResult.identifier,
                error: undefined,
              };
            }
          } else {
            if (!target.socialAccount) {
              return { targetId: target.id, success: false, error: "Social account not found" };
            }
            result = await publisher.publishPost(target.socialAccount.id, content);
          }
          
          // Log publish result for telemetry
          logger.info(`Post publish result for target ${target.id}`, {
            postId,
            targetId: target.id,
            platform: target.platform,
            provider: providerUsed,
            success: result.success,
            externalPostId: result.externalPostId,
            error: result.error
          });
          
          // Update target status
          await prisma.postTarget.update({
            where: { id: target.id },
            data: {
              status: pending ? "PENDING" : result.success ? "POSTED" : "FAILED",
              externalPostId: result.externalPostId,
              errorMessage: result.error,
              publishedAt: result.success ? new Date() : undefined
            }
          });

          return { targetId: target.id, pending, ...result };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          logger.error(`Post publish error for target ${target.id}`, {
            postId,
            targetId: target.id,
            platform: target.platform,
            error: errorMsg,
            stack: error instanceof Error ? error.stack : undefined
          });

          await prisma.postTarget.update({
            where: { id: target.id },
            data: {
              status: "FAILED",
              errorMessage: errorMsg
            }
          });

          return { 
            targetId: target.id, 
            success: false, 
            error: errorMsg
          };
        }
      })
    );

    // Update post status based on results
    const allSuccessful = results.every((r) => r.success);
    const anySuccessful = results.some((r) => r.success);
    const anyPending = results.some((r) => "pending" in r && r.pending);

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: anyPending ? "PUBLISHING" : anySuccessful ? "POSTED" : "FAILED"
      }
    });

    if (anySuccessful && !post.scheduledFor) {
      const subscription = await prisma.subscription.findFirst({
        where: { userId: post.userId, status: "ACTIVE" },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
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
    }

    // Send notification for admin-initiated posts
    if (post.initiatedBy === "ADMIN" && post.adminId) {
      const successfulPlatforms = results
        .filter(r => r.success)
        .map(r => post.targets.find(t => t.id === r.targetId)?.platform)
        .filter((p): p is SocialPlatform => p !== undefined);

      const failedPlatforms = results
        .filter(r => !r.success)
        .map(r => post.targets.find(t => t.id === r.targetId)?.platform)
        .filter((p): p is SocialPlatform => p !== undefined);

      if (anySuccessful) {
        await prisma.notification.create({
          data: {
            userId: post.userId,
            type: "ADMIN_POST_PUBLISHED",
            title: "Admin post published",
            message: `Your post was published to ${successfulPlatforms.join(", ")} by an admin.`,
            payload: {
              postId: post.id,
              platforms: successfulPlatforms,
              adminId: post.adminId,
              publishedAt: new Date().toISOString(),
            },
          },
        });
      }

      if (failedPlatforms.length > 0) {
        await prisma.notification.create({
          data: {
            userId: post.userId,
            type: "ADMIN_POST_FAILED",
            title: "Admin post failed",
            message: `Failed to publish to ${failedPlatforms.join(", ")}.`,
            payload: {
              postId: post.id,
              failedPlatforms,
              errors: results
                .filter(r => !r.success)
                .map(r => ({
                  platform: post.targets.find(t => t.id === r.targetId)?.platform ?? null,
                  error: r.error ?? null,
                })),
            },
          },
        });
      }
    }

    return { results, allSuccessful, anySuccessful };
  }

  async getDueScheduledPosts(): Promise<string[]> {
    const now = new Date();
    const posts = await prisma.post.findMany({
      where: {
        status: "SCHEDULED",
        scheduledFor: {
          lte: now
        }
      },
      select: { id: true }
    });

    return posts.map(p => p.id);
  }

  async getPostWithErrors(userId: string, postId: string) {
    const post = await prisma.post.findFirst({
      where: { id: postId, userId },
      include: {
        asset: {
          select: {
            id: true,
            storageKey: true,
            type: true,
            contentType: true
          }
        },
        targets: {
          include: {
            socialAccount: {
              select: {
                id: true,
                platform: true,
                displayName: true
              }
            }
          },
          orderBy: { createdAt: "asc" }
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 10
        }
      }
    });

    if (!post) return null;

    return {
      id: post.id,
      caption: post.caption,
      status: post.status,
      scheduledFor: post.scheduledFor,
      asset: post.asset,
      targets: post.targets.map(target => ({
        id: target.id,
        platform: target.platform,
        status: target.status,
        errorMessage: target.errorMessage,
        externalPostId: target.externalPostId,
        publishedAt: target.publishedAt,
        socialAccount: target.socialAccount
      })),
      events: post.events.map(event => ({
        type: event.type,
        message: event.message,
        createdAt: event.createdAt
      }))
    };
  }
}

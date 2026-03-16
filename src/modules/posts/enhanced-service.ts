import { Prisma, PostStatus, SocialPlatform, AssetType, PostTargetStatus } from "@prisma/client";
import { SocialPublisher } from "../social/publisher";
import dayjs from "dayjs";
import { prisma } from "../../lib/prisma";

const publisher = new SocialPublisher();

export interface CreatePostData {
  assetId?: string;
  contentItemId?: string;
  caption: string;
  scheduledFor: Date;
  platforms: SocialPlatform[];
  socialAccountIds: string[];
  tags?: string[];
  intervalInDays?: number; // For recurring posts
}

export interface CalendarFilters {
  startDate: Date;
  endDate: Date;
  platforms?: SocialPlatform[];
  status?: PostStatus[];
  tags?: string[];
}

export interface PostStatistics {
  totalPosts: number;
  scheduledPosts: number;
  publishedPosts: number;
  failedPosts: number;
  draftPosts: number;
  platformBreakdown: Record<SocialPlatform, number>;
}

type CreatedPost = Awaited<ReturnType<EnhancedPostService["createPost"]>>;

export class EnhancedPostService {
  async getCalendarPosts(userId: string, filters: CalendarFilters) {
    const posts = await prisma.post.findMany({
      where: {
        userId,
        scheduledFor: {
          gte: filters.startDate,
          lte: filters.endDate
        },
        ...(filters.status && { status: { in: filters.status } }),
        ...(filters.platforms && {
          targets: {
            some: {
              platform: { in: filters.platforms }
            }
          }
        })
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
                displayName: true,
                platform: true
              }
            }
          }
        }
      },
      orderBy: { scheduledFor: "asc" }
    });

    return posts.map((post) => ({
      id: post.id,
      caption: post.caption,
      scheduledFor: post.scheduledFor,
      status: post.status,
      asset: post.asset
        ? {
            id: post.asset.id,
            storageKey: post.asset.storageKey,
            type: post.asset.type as AssetType,
            contentType: post.asset.contentType ?? null
          }
        : undefined,
      targets: post.targets.map((target) => ({
        id: target.id,
        platform: target.platform,
        status: target.status,
        socialAccount: target.socialAccount || undefined
      })),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt
    }));
  }

  async createPost(userId: string, data: CreatePostData) {
    // Validate user owns the asset and social accounts
    if (data.assetId) {
      const asset = await prisma.asset.findFirst({
        where: { id: data.assetId, userId }
      });
      if (!asset) {
        throw new Error("Asset not found");
      }
    }

    // Validate social accounts belong to user
    const socialAccounts = await prisma.socialAccount.findMany({
      where: { 
        id: { in: data.socialAccountIds },
        userId 
      }
    });

    if (socialAccounts.length !== data.socialAccountIds.length) {
      throw new Error("One or more social accounts not found");
    }

    // Create the post
    const post = await prisma.post.create({
      data: {
        userId,
        assetId: data.assetId,
        contentItemId: data.contentItemId,
        caption: data.caption,
        scheduledFor: data.scheduledFor,
        status: "DRAFT"
      }
    });

    // Create post targets for each platform/account
    const targets = await Promise.all(
      data.socialAccountIds.map(async (socialAccountId) => {
        const account = socialAccounts.find(acc => acc.id === socialAccountId);
        if (!account) {
          throw new Error("Social account not found");
        }
        return prisma.postTarget.create({
          data: {
            postId: post.id,
            socialAccountId,
            platform: account.platform,
            status: "PENDING"
          }
        });
      })
    );

    return { post, targets };
  }

  async duplicatePost(userId: string, postId: string, newScheduledFor?: Date) {
    const originalPost = await prisma.post.findFirst({
      where: { id: postId, userId },
      include: {
        targets: {
          include: {
            socialAccount: true
          }
        }
      }
    });

    if (!originalPost) {
      throw new Error("Post not found");
    }

    // Calculate new scheduled time (1 hour later if not specified)
    const scheduledFor = newScheduledFor || dayjs(originalPost.scheduledFor).add(1, "hour").toDate();

    const duplicateData: CreatePostData = {
      caption: `${originalPost.caption ?? ""} (Copy)`,
      scheduledFor,
      platforms: originalPost.targets.map(t => t.platform),
      socialAccountIds: originalPost.targets
        .map((target) => target.socialAccountId)
        .filter((id): id is string => Boolean(id)),
      assetId: originalPost.assetId || undefined,
      contentItemId: originalPost.contentItemId || undefined
    };

    return this.createPost(userId, duplicateData);
  }

  async movePost(userId: string, postId: string, newScheduledFor: Date) {
    const post = await prisma.post.findFirst({
      where: { id: postId, userId }
    });

    if (!post) {
      throw new Error("Post not found");
    }

    if (post.status === "POSTED") {
      throw new Error("Cannot move posted content");
    }

    // Don't allow moving to past dates
    if (dayjs(newScheduledFor).isBefore(dayjs(), "minute")) {
      throw new Error("Cannot schedule posts in the past");
    }

    return prisma.post.update({
      where: { id: postId },
      data: {
        scheduledFor: newScheduledFor,
        updatedAt: new Date()
      }
    });
  }

  async findOptimalTimeSlot(userId: string, platforms: SocialPlatform[], duration = 60) {
    // Get user's connected social accounts for the platforms
    const socialAccounts = await prisma.socialAccount.findMany({
      where: {
        userId,
        platform: { in: platforms }
      }
    });

    if (socialAccounts.length === 0) {
      throw new Error("No connected accounts for specified platforms");
    }

    // Get existing posts for the next 7 days
    const startDate = dayjs().startOf("hour").toDate();
    const endDate = dayjs().add(7, "days").endOf("day").toDate();

    const existingPosts = await prisma.post.findMany({
      where: {
        userId,
        scheduledFor: {
          gte: startDate,
          lte: endDate
        },
        status: { in: ["DRAFT", "SCHEDULED"] }
      },
      select: {
        scheduledFor: true
      }
    });

    // Find gaps in the schedule
    const busySlots = new Set(
      existingPosts
        .map((post) => post.scheduledFor)
        .filter((date): date is Date => Boolean(date))
        .map((date) => dayjs(date).format("YYYY-MM-DD HH:00"))
    );

    // Look for optimal times (9 AM - 9 PM, avoiding busy slots)
    for (let day = 0; day < 7; day++) {
      for (let hour = 9; hour <= 21; hour++) {
        const candidate = dayjs().add(day, "day").hour(hour).startOf("hour");
        const slotKey = candidate.format("YYYY-MM-DD HH:00");
        
        if (!busySlots.has(slotKey) && candidate.isAfter(dayjs())) {
          return candidate.toDate();
        }
      }
    }

    // If no optimal slot found, return next available hour
    return dayjs().add(1, "hour").startOf("hour").toDate();
  }

  async getPostStatistics(userId: string, filters?: Partial<CalendarFilters>): Promise<PostStatistics> {
    const whereClause: Prisma.PostWhereInput = { userId };
    
    if (filters?.startDate && filters?.endDate) {
      whereClause.scheduledFor = {
        gte: filters.startDate,
        lte: filters.endDate
      };
    }

    const posts = await prisma.post.findMany({
      where: whereClause,
      include: {
        targets: {
          select: {
            platform: true
          }
        }
      }
    });

    const stats: PostStatistics = {
      totalPosts: posts.length,
      scheduledPosts: posts.filter(p => p.status === "SCHEDULED").length,
      publishedPosts: posts.filter(p => p.status === "POSTED").length,
      failedPosts: posts.filter(p => p.status === "FAILED").length,
      draftPosts: posts.filter(p => p.status === "DRAFT").length,
      platformBreakdown: {} as Record<SocialPlatform, number>
    };

    // Calculate platform breakdown
    const platformCounts: Record<string, number> = {};
    posts.forEach(post => {
      post.targets.forEach(target => {
        platformCounts[target.platform] = (platformCounts[target.platform] || 0) + 1;
      });
    });

    stats.platformBreakdown = platformCounts as Record<SocialPlatform, number>;

    return stats;
  }

  async bulkUpdateStatus(userId: string, postIds: string[], status: PostStatus) {
    // Validate all posts belong to user
    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        userId
      }
    });

    if (posts.length !== postIds.length) {
      throw new Error("One or more posts not found");
    }

    // Don't allow changing status of already posted content
    const postedPosts = posts.filter(p => p.status === "POSTED");
    if (postedPosts.length > 0) {
      throw new Error("Cannot change status of already posted content");
    }

    return prisma.post.updateMany({
      where: {
        id: { in: postIds },
        userId
      },
      data: {
        status,
        updatedAt: new Date()
      }
    });
  }

  async createRecurringPost(userId: string, data: CreatePostData & { intervalInDays: number, endDate?: Date }) {
    if (!data.intervalInDays || data.intervalInDays < 1) {
      throw new Error("Interval must be at least 1 day");
    }

    const posts: CreatedPost[] = [];
    const endDate = data.endDate || dayjs(data.scheduledFor).add(30, "days").toDate(); // Default 30 days
    let currentDate = dayjs(data.scheduledFor);

    while (currentDate.isBefore(endDate)) {
      const postData = {
        ...data,
        scheduledFor: currentDate.toDate()
      };

      const result = await this.createPost(userId, postData);
      posts.push(result);

      currentDate = currentDate.add(data.intervalInDays, "days");
    }

    return posts;
  }
}

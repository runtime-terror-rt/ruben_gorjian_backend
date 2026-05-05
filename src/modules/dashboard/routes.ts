import express from "express";
import { PostStatus, SocialPlatform, SubmissionStatus, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { getActiveSubscription } from "../billing/subscription-service";
import { getSubscriptionPeriod } from "../../lib/subscription-period";

const router = express.Router();

router.use(requireAuth);

const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

const upcomingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(5),
});

async function getLatestSubscription(userId: string) {
  const active = await getActiveSubscription(userId);
  if (active) {
    return active;
  }

  return prisma.subscription.findFirst({
    where: { userId },
    include: { plan: true },
    orderBy: { updatedAt: "desc" },
  });
}

function getDaysLeft(currentPeriodEnd?: Date | null) {
  if (!currentPeriodEnd) {
    return null;
  }
  const msLeft = currentPeriodEnd.getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
}

function toPercentage(value: number) {
  return Math.round(value * 100) / 100;
}

function getSubscriptionExpiryProgress(periodStart: Date, periodEnd: Date, now = new Date()) {
  const totalMs = Math.max(periodEnd.getTime() - periodStart.getTime(), 1);
  const elapsedRaw = now.getTime() - periodStart.getTime();
  const elapsedMs = Math.min(Math.max(elapsedRaw, 0), totalMs);
  const remainingMs = Math.max(totalMs - elapsedMs, 0);

  const elapsedPercent = toPercentage((elapsedMs / totalMs) * 100);
  const remainingPercent = toPercentage((remainingMs / totalMs) * 100);

  return {
    elapsedPercent,
    remainingPercent,
    elapsedMs,
    remainingMs,
    totalMs,
    isExpired: now.getTime() >= periodEnd.getTime(),
    daysLeft: Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
  };
}

function groupSocialAccounts(accounts: Array<{ platform: SocialPlatform; expiresAt: Date | null }>) {
  const byPlatform = {
    INSTAGRAM: 0,
    FACEBOOK: 0,
    TIKTOK: 0,
  };

  for (const account of accounts) {
    if (account.platform === "INSTAGRAM" || account.platform === "FACEBOOK" || account.platform === "TIKTOK") {
      byPlatform[account.platform] += 1;
    }
  }

  const now = Date.now();
  const in7Days = now + 7 * 24 * 60 * 60 * 1000;
  const expiringSoon = accounts.filter((account) => {
    if (!account.expiresAt) {
      return false;
    }
    const ts = account.expiresAt.getTime();
    return ts >= now && ts <= in7Days;
  }).length;

  return { byPlatform, expiringSoon };
}

function buildAlerts(params: {
  onboardingCompleted: boolean;
  postsUsed: number;
  postQuota: number | null;
  visualsUsed: number;
  visualQuota: number | null;
  failedPosts: number;
  expiringSocialAccounts: number;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionDaysLeft: number | null;
  submissionsNeedChanges: number;
}) {
  const alerts: Array<{
    type: "info" | "warning" | "error";
    code: string;
    message: string;
  }> = [];

  if (params.postQuota && params.postQuota > 0) {
    const postUsagePercent = Math.floor((params.postsUsed / params.postQuota) * 100);
    if (postUsagePercent >= 80) {
      alerts.push({
        type: "warning",
        code: "POST_QUOTA_HIGH",
        message: `You have used ${postUsagePercent}% of your post quota.`,
      });
    }
  }

  if (params.visualQuota && params.visualQuota > 0) {
    const visualUsagePercent = Math.floor((params.visualsUsed / params.visualQuota) * 100);
    if (visualUsagePercent >= 80) {
      alerts.push({
        type: "warning",
        code: "VISUAL_QUOTA_HIGH",
        message: `You have used ${visualUsagePercent}% of your visual quota.`,
      });
    }
  }

  if (params.subscriptionStatus === SubscriptionStatus.PAST_DUE) {
    alerts.push({
      type: "error",
      code: "SUBSCRIPTION_PAST_DUE",
      message: "Your subscription payment is past due.",
    });
  }

  if (params.subscriptionDaysLeft !== null && params.subscriptionDaysLeft <= 7) {
    alerts.push({
      type: "warning",
      code: "SUBSCRIPTION_RENEWAL_SOON",
      message: `Your subscription renews in ${params.subscriptionDaysLeft} day(s).`,
    });
  }

  if (params.failedPosts > 0) {
    alerts.push({
      type: "warning",
      code: "FAILED_POSTS",
      message: `${params.failedPosts} post(s) failed and need your attention.`,
    });
  }

  if (params.expiringSocialAccounts > 0) {
    alerts.push({
      type: "warning",
      code: "SOCIAL_RECONNECT_SOON",
      message: `${params.expiringSocialAccounts} social account(s) need reconnection soon.`,
    });
  }

  if (params.submissionsNeedChanges > 0) {
    alerts.push({
      type: "info",
      code: "SUBMISSIONS_NEED_CHANGES",
      message: `${params.submissionsNeedChanges} submission(s) need changes.`,
    });
  }

  if (!params.onboardingCompleted) {
    alerts.push({
      type: "info",
      code: "ONBOARDING_INCOMPLETE",
      message: "Complete onboarding to unlock all dashboard capabilities.",
    });
  }

  return alerts;
}

router.get("/overview", async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();

  const subscription = await getLatestSubscription(userId);
  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription ?? null, now);

  const [usage, socialAccounts] = await Promise.all([
    prisma.usageMonthly.findFirst({
      where: {
        userId,
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
      orderBy: { periodStart: "desc" },
    }),
    prisma.socialAccount.findMany({
      where: { userId },
      select: {
        platform: true,
        expiresAt: true,
      },
    }),
  ]);

  const postQuota = subscription?.plan?.basePostQuota ?? null;
  const visualQuota = subscription?.plan?.baseVisualQuota ?? null;
  const planIncluded = subscription?.plan ? (subscription.plan.platformQty ?? subscription.plan.platformLimit ?? null) : null;
  const platformLimit = planIncluded !== null && planIncluded !== undefined
    ? (subscription?.plan?.isCustomEnterprise ? planIncluded : planIncluded + (subscription?.addonPlatformQty ?? 0))
    : null;

  const postsUsed = usage?.postsUsed ?? 0;
  const visualsUsed = usage?.visualsUsed ?? 0;
  const visualsBonus = usage?.visualsBonus ?? 0;
  // Platform usage should reflect currently connected accounts, not a stale monthly snapshot.
  const platformsUsed = socialAccounts.length;

  const postsRemaining = postQuota !== null ? Math.max(postQuota - postsUsed, 0) : null;
  const visualsRemaining = visualQuota !== null ? Math.max(visualQuota + visualsBonus - visualsUsed, 0) : null;
  const platformsRemaining = platformLimit !== null ? Math.max(platformLimit - platformsUsed, 0) : null;

  const { byPlatform, expiringSoon } = groupSocialAccounts(socialAccounts);
  const subscriptionDaysLeft = getDaysLeft(subscription?.currentPeriodEnd ?? null);

  return res.json({
    success: true,
    data: {
      plan: subscription
        ? {
          planCode: subscription.planCode,
          planCategory: subscription.plan?.category ?? null,
          status: subscription.status,
          priceType: subscription.priceType,
          billingCycle: subscription.billingCycle,
          currentPeriodEnd: subscription.currentPeriodEnd,
          daysLeft: subscriptionDaysLeft,
          postLimitType: subscription.plan?.postLimitType ?? null,
          postQuota,
          visualQuota,
          platformLimit,
        }
        : null,
      usage: {
        periodStart,
        periodEnd,
        postsUsed,
        postsRemaining,
        visualsUsed,
        visualsRemaining,
        visualsBonus,
        platformsUsed,
        platformsRemaining,
      },
      socialAccounts: {
        connectedTotal: socialAccounts.length,
        byPlatform,
        expiringSoon,
      },
    },
  });
});

router.get("/overview/subscription-progress", async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();

  const subscription = await getLatestSubscription(userId);

  if (!subscription) {
    return res.json({
      success: true,
      data: {
        subscription: null,
        chart: {
          type: "pie",
          unit: "percent",
          usedPercent: 0,
          remainingPercent: 100,
          segments: [
            { key: "used", label: "Used", value: 0 },
            { key: "remaining", label: "Remaining", value: 100 },
          ],
        },
      },
    });
  }

  const { periodStart, periodEnd } = getSubscriptionPeriod(subscription, now);
  const progress = getSubscriptionExpiryProgress(periodStart, periodEnd, now);

  return res.json({
    success: true,
    data: {
        subscription: {
        id: subscription.id,
        planCode: subscription.planCode,
        name: subscription.plan?.name ?? null,
        addonPlatformQty: subscription.addonPlatformQty ?? 0,
        videoAddonEnabled: subscription.videoAddonEnabled ?? false,
        videoSessionHours: subscription.videoSessionHours ?? 0,
        basePostQuota: subscription.plan?.basePostQuota ?? null,
        platformLimit: subscription.plan ? (subscription.plan.platformLimit ?? 4) : 4,
        thisPlanPlatformLimit: (subscription.addonPlatformQty || 0) + (subscription.plan?.platformQty || 0),
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        daysLeft: progress.daysLeft,
        isExpired: progress.isExpired,
      },
      chart: {
        type: "pie",
        unit: "percent",
        usedPercent: progress.elapsedPercent,
        remainingPercent: progress.remainingPercent,
        segments: [
          { key: "used", label: "Used", value: progress.elapsedPercent },
          { key: "remaining", label: "Remaining", value: progress.remainingPercent },
        ],
      },
    },
  });
});

router.get("/overview/recent-activity", async (req, res) => {
  const userId = req.user!.id;
  const parsed = activityQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    prisma.recentActivity.count({ where: { userId } }),
    prisma.recentActivity.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return res.json({
    success: true,
    data: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      items,
    },
  });
});

router.get("/overview/upcoming-posts", async (req, res) => {
  const userId = req.user!.id;
  const parsed = upcomingQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const items = await prisma.post.findMany({
    where: {
      userId,
      status: PostStatus.SCHEDULED,
      scheduledFor: { not: null },
    },
    orderBy: { scheduledFor: "desc" },
    take: parsed.data.limit,
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      targets: {
        select: {
          platform: true,
          status: true,
        },
      },
    },
  });

  return res.json({
    success: true,
    data: {
      limit: parsed.data.limit,
      items: items.map((item) => ({
        postId: item.id,
        status: item.status,
        scheduledFor: item.scheduledFor,
        targets: item.targets,
      })),
    },
  });
});

router.get("/overview/post-pipeline", async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const [draft, scheduled, publishing, failed, postedThisWeek] = await Promise.all([
    prisma.post.count({ where: { userId, status: PostStatus.DRAFT } }),
    prisma.post.count({ where: { userId, status: PostStatus.SCHEDULED } }),
    prisma.post.count({ where: { userId, status: PostStatus.PUBLISHING } }),
    prisma.post.count({ where: { userId, status: PostStatus.FAILED } }),
    prisma.post.count({ where: { userId, status: PostStatus.POSTED, updatedAt: { gte: startOfWeek } } }),
  ]);

  return res.json({
    success: true,
    data: {
      draft,
      scheduled,
      publishing,
      failed,
      postedThisWeek,
    },
  });
});

router.get("/overview/system-alerts", async (req, res) => {
  const userId = req.user!.id;
  const now = new Date();

  const [user, subscription, usage, failedPosts, socialAccounts, submissionsNeedsChanges] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        onboardingCompleted: true,
      },
    }),
    getLatestSubscription(userId),
    prisma.usageMonthly.findFirst({
      where: {
        userId,
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
      orderBy: { periodStart: "desc" },
    }),
    prisma.post.count({ where: { userId, status: PostStatus.FAILED } }),
    prisma.socialAccount.findMany({ where: { userId }, select: { expiresAt: true, platform: true } }),
    prisma.submission.count({ where: { userId, status: SubmissionStatus.NEEDS_CHANGES } }),
  ]);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { expiringSoon } = groupSocialAccounts(socialAccounts);
  const alerts = buildAlerts({
    onboardingCompleted: user.onboardingCompleted,
    postsUsed: usage?.postsUsed ?? 0,
    postQuota: subscription?.plan?.basePostQuota ?? null,
    visualsUsed: usage?.visualsUsed ?? 0,
    visualQuota: subscription?.plan?.baseVisualQuota ?? null,
    failedPosts,
    expiringSocialAccounts: expiringSoon,
    subscriptionStatus: subscription?.status,
    subscriptionDaysLeft: getDaysLeft(subscription?.currentPeriodEnd ?? null),
    submissionsNeedChanges: submissionsNeedsChanges,
  });

  return res.json({
    success: true,
    data: {
      count: alerts.length,
      items: alerts,
    },
  });
});

export { router as dashboardRouter };

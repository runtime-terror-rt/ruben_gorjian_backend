import express from "express";
import { BillingCycle, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../middleware/requireAuth";
import { requireAdmin } from "../../../middleware/requireAdmin";

const router = express.Router();

const YEARLY_MULTIPLIER = 12 * 0.8;
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const revenueQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.string().trim().optional(),
});

const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(20),
});

function toRevenueCents(planStandardCents: number, billingCycle: BillingCycle) {
  if (billingCycle === BillingCycle.YEARLY) {
    return Math.round(planStandardCents * YEARLY_MULTIPLIER);
  }
  return planStandardCents;
}

router.use(requireAuth, requireAdmin);

router.get("/stats", async (_req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);

  const [
    totalUsers,
    activeUsers,
    blockedUsers,
    deletedUsers,
    verifiedUsers,
    newUsersThisMonth,
    newUsersThisWeek,
    totalSubscriptions,
    activeSubscriptions,
    expiredSubscriptions,
    canceledSubscriptions,
    incompleteSubscriptions,
    monthlySubscriptions,
    yearlySubscriptions,
    newSubscriptionsThisMonth,
    totalScheduledPosts,
    pendingScheduledPosts,
    postedScheduledPosts,
    failedScheduledPosts,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "BLOCKED" } }),
    prisma.user.count({ where: { status: "DELETED" } }),
    prisma.user.count({ where: { emailVerified: true } }),
    prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.user.count({ where: { createdAt: { gte: startOfWeek } } }),
    prisma.subscription.count(),
    prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
    prisma.subscription.count({
      where: {
        currentPeriodEnd: { lt: now },
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
      },
    }),
    prisma.subscription.count({ where: { status: SubscriptionStatus.CANCELED } }),
    prisma.subscription.count({ where: { status: SubscriptionStatus.INCOMPLETE } }),
    prisma.subscription.count({ where: { billingCycle: BillingCycle.MONTHLY } }),
    prisma.subscription.count({ where: { billingCycle: BillingCycle.YEARLY } }),
    prisma.subscription.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.scheduledPost.count(),
    prisma.scheduledPost.count({ where: { status: "PENDING" } }),
    prisma.scheduledPost.count({ where: { status: "POSTED" } }),
    prisma.scheduledPost.count({ where: { status: "FAILED" } }),
  ]);

  return res.json({
    success: true,
    data: {
      timestamp: now.toISOString(),
      users: {
        total: totalUsers,
        active: activeUsers,
        blocked: blockedUsers,
        deleted: deletedUsers,
        emailVerified: verifiedUsers,
        newThisMonth: newUsersThisMonth,
        newLast7Days: newUsersThisWeek,
      },
      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        expired: expiredSubscriptions,
        canceled: canceledSubscriptions,
        incomplete: incompleteSubscriptions,
        monthly: monthlySubscriptions,
        yearly: yearlySubscriptions,
        newThisMonth: newSubscriptionsThisMonth,
      },
      schedules: {
        total: totalScheduledPosts,
        pending: pendingScheduledPosts,
        posted: postedScheduledPosts,
        failed: failedScheduledPosts,
      },
    },
  });
});

router.get("/revenue", async (req, res) => {
  const parsed = revenueQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const selectedYear = parsed.data.year ?? new Date().getFullYear();
  const rawMonth = parsed.data.month?.trim() || "All";
  const startOfYear = new Date(selectedYear, 0, 1);
  const endOfYear = new Date(selectedYear + 1, 0, 1);
  const normalizedMonth = rawMonth.toLowerCase();
  const monthIndex = normalizedMonth === "all"
    ? null
    : MONTH_LABELS.findIndex((month) => month.toLowerCase() === normalizedMonth);

  if (normalizedMonth !== "all" && monthIndex === -1) {
    return res.status(400).json({
      error: "Invalid month filter",
      allowedValues: ["All", ...MONTH_LABELS],
    });
  }

  const subscriptions = await prisma.subscription.findMany({
    where: {
      createdAt: {
        gte: startOfYear,
        lt: endOfYear,
      },
      status: {
        in: [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.CANCELED,
        ],
      },
    },
    select: {
      id: true,
      createdAt: true,
      planCode: true,
      billingCycle: true,
      plan: {
        select: {
          name: true,
          priceStandardCents: true,
        },
      },
    },
  });

  const monthlyBuckets = MONTH_LABELS.map((label, index) => ({
    month: label,
    monthNumber: index + 1,
    subscriptions: 0,
    revenueCents: 0,
  }));

  const filteredSubscriptions = subscriptions.filter((subscription) => {
    if (monthIndex === null) return true;
    return subscription.createdAt.getMonth() === monthIndex;
  });

  for (const subscription of subscriptions) {
    const bucket = monthlyBuckets[subscription.createdAt.getMonth()];
    const standardCents = subscription.plan?.priceStandardCents ?? 0;
    const revenueCents = toRevenueCents(standardCents, subscription.billingCycle);

    bucket.subscriptions += 1;
    bucket.revenueCents += revenueCents;
  }

  const planMap = new Map<string, { planCode: string; planName: string; subscriptions: number; revenueCents: number }>();

  for (const subscription of filteredSubscriptions) {
    const key = subscription.planCode;
    const standardCents = subscription.plan?.priceStandardCents ?? 0;
    const revenueCents = toRevenueCents(standardCents, subscription.billingCycle);
    const existing = planMap.get(key);

    if (existing) {
      existing.subscriptions += 1;
      existing.revenueCents += revenueCents;
    } else {
      planMap.set(key, {
        planCode: subscription.planCode,
        planName: subscription.plan?.name ?? subscription.planCode,
        subscriptions: 1,
        revenueCents,
      });
    }
  }

  const trend = monthIndex === null
    ? monthlyBuckets
    : monthlyBuckets.filter((bucket) => bucket.monthNumber === monthIndex + 1);

  const totalRevenueCents = trend.reduce((sum, month) => sum + month.revenueCents, 0);
  const totalSubscriptionsInTrend = trend.reduce((sum, month) => sum + month.subscriptions, 0);

  return res.json({
    success: true,
    data: {
      filters: {
        year: selectedYear,
        month: rawMonth,
      },
      summary: {
        totalRevenueCents,
        totalSubscriptions: totalSubscriptionsInTrend,
      },
      trend,
      plans: Array.from(planMap.values()).sort((a, b) => b.revenueCents - a.revenueCents),
    },
  });
});

router.get("/activity", async (req, res) => {
  const parsed = activityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const page = parsed.data.page;
  const limit = parsed.data.limit;
  const offset = (page - 1) * limit;

  const [newUsers, newSubscriptions, newSchedules] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    }),
    prisma.subscription.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        planCode: true,
        billingCycle: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
    prisma.scheduledPost.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        scheduledAt: true,
        platform: true,
        title: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const userEvents = newUsers.map((user) => ({
    id: `user-${user.id}`,
    type: "USER_CREATED",
    message: `${user.name?.trim() || user.email} created a new account`,
    createdAt: user.createdAt.toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    metadata: {
      userId: user.id,
    },
  }));

  const subscriptionEvents = newSubscriptions.map((subscription) => ({
    id: `subscription-${subscription.id}`,
    type: "SUBSCRIPTION_CREATED",
    message: `${subscription.user.name?.trim() || subscription.user.email} started a ${subscription.billingCycle.toLowerCase()} subscription on ${subscription.planCode}`,
    createdAt: subscription.createdAt.toISOString(),
    user: {
      id: subscription.user.id,
      email: subscription.user.email,
      name: subscription.user.name,
    },
    metadata: {
      subscriptionId: subscription.id,
      planCode: subscription.planCode,
      billingCycle: subscription.billingCycle,
    },
  }));

  const scheduleEvents = newSchedules.map((schedule) => ({
    id: `schedule-${schedule.id}`,
    type: "SCHEDULE_CREATED",
    message: `${schedule.user.name?.trim() || schedule.user.email} created a new ${schedule.platform.toLowerCase()} schedule`,
    createdAt: schedule.createdAt.toISOString(),
    user: {
      id: schedule.user.id,
      email: schedule.user.email,
      name: schedule.user.name,
    },
    metadata: {
      scheduleId: schedule.id,
      platform: schedule.platform,
      title: schedule.title,
      scheduledAt: schedule.scheduledAt.toISOString(),
    },
  }));

  const items = [...userEvents, ...subscriptionEvents, ...scheduleEvents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const total = items.length;
  const paginatedItems = items.slice(offset, offset + limit);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return res.json({
    success: true,
    data: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      items: paginatedItems,
    },
  });
});

export { router as adminOverviewRouter };

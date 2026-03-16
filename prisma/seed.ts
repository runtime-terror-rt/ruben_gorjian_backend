import "dotenv/config";
import bcrypt from "bcryptjs";
import {
  PostStatus,
  PostTargetStatus,
  PrismaClient,
  PriceType,
  PostLimitType,
  SchedulerRole,
  SocialPlatform,
  SubscriptionStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

console.log("Connecting to database:", process.env.DATABASE_URL?.split("@")[1]);

// Only Full Management plans (Calendar Only and Visual Calendar removed).
// Quotas and prices aligned with pricing-catalog and Stripe.
const planSeed = [
  {
    code: "FMP-20",
    name: "Full Management",
    category: "FULL_MANAGEMENT",
    isJewelry: false,
    platformLimit: 1,
    baseVisualQuota: 0,
    basePostQuota: 12,
    postLimitType: PostLimitType.HARD,
    schedulerRole: SchedulerRole.ADMIN,
    priceStandardCents: 39500, // $395
    priceFounderCents: 27650, // $276.50
  },
  {
    code: "FMP-35",
    name: "Full Management Plus",
    category: "FULL_MANAGEMENT",
    isJewelry: false,
    platformLimit: 2,
    baseVisualQuota: 0,
    basePostQuota: 16,
    postLimitType: PostLimitType.HARD,
    schedulerRole: SchedulerRole.ADMIN,
    priceStandardCents: 49500, // $495
    priceFounderCents: 34650, // $346.50
  },
  {
    code: "FM-70",
    name: "Full Management Premium",
    category: "FULL_MANAGEMENT",
    isJewelry: false,
    platformLimit: 3,
    baseVisualQuota: 0,
    basePostQuota: 20,
    postLimitType: PostLimitType.HARD,
    schedulerRole: SchedulerRole.ADMIN,
    priceStandardCents: 94900, // $949
    priceFounderCents: 66430, // $664.30
  },
];

async function main() {
  for (const plan of planSeed) {
    const { code, ...data } = plan;
    const envStandard = process.env[`STRIPE_PRICE_${code}_STANDARD`];
    const envFounder = process.env[`STRIPE_PRICE_${code}_FOUNDER`];

    const payload = {
      ...data,
      stripePriceStandardId: envStandard,
      stripePriceFounderId: envFounder,
    };

    await prisma.plan.upsert({
      where: { code },
      update: payload,
      create: { code, ...payload },
    });
  }

  const seededUsers = await seedUsersAndSubscriptions();
  await seedPosts(seededUsers);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

async function seedUsersAndSubscriptions() {
  const usersToSeed = [
    {
      email: "admin@talexia.test",
      password: "TalexiaAdmin123!",
      role: "ADMIN" as const,
      isFounder: true,
      onboardingCompleted: true,
      emailVerified: true,
      planCode: "FMP-35",
      priceType: PriceType.FOUNDER,
      status: SubscriptionStatus.ACTIVE,
    },
    {
      email: "agency@talexia.test",
      password: "TalexiaUser123!",
      role: "USER" as const,
      isFounder: false,
      onboardingCompleted: true,
      emailVerified: true,
      planCode: "FM-70",
      priceType: PriceType.STANDARD,
      status: SubscriptionStatus.ACTIVE,
    },
    {
      email: "brand@talexia.test",
      password: "TalexiaBrand123!",
      role: "USER" as const,
      isFounder: false,
      onboardingCompleted: true,
      emailVerified: true,
      planCode: "FMP-20",
      priceType: PriceType.STANDARD,
      status: SubscriptionStatus.ACTIVE,
    },
  ];

  const records: Array<{ id: string; email: string }> = [];

  for (const user of usersToSeed) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const saved = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash,
        role: user.role,
        isFounder: user.isFounder,
        onboardingCompleted: user.onboardingCompleted,
        emailVerified: user.emailVerified,
      },
      create: {
        email: user.email,
        passwordHash,
        role: user.role,
        isFounder: user.isFounder,
        onboardingCompleted: user.onboardingCompleted,
        emailVerified: user.emailVerified,
      },
      select: { id: true, email: true },
    });

    records.push(saved);

    await prisma.subscription.deleteMany({ where: { userId: saved.id } });
    await prisma.subscription.create({
      data: {
        userId: saved.id,
        planCode: user.planCode,
        priceType: user.priceType,
        status: user.status,
      },
    });

    // Track founder record for admin user if needed
    if (user.isFounder) {
      await prisma.founder.upsert({
        where: { userId: saved.id },
        update: {},
        create: { userId: saved.id },
      });
    }
  }

  return records;
}

async function seedPosts(users: Array<{ id: string; email: string }>) {
  for (const user of users) {
    await prisma.postTarget.deleteMany({
      where: { post: { userId: user.id } },
    });
    await prisma.post.deleteMany({
      where: { userId: user.id },
    });
    const socialAccounts = await ensureSocialAccounts(user.id);

    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3);
    const inFiveDays = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 5);
    const pastDay = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2);

    const posts: Array<{
      status: PostStatus;
      scheduledFor: Date;
      caption: string;
      targets: Array<{
        platform: SocialPlatform;
        status: PostTargetStatus;
        scheduledFor: Date;
        publishedAt?: Date;
        socialAccountId: string;
      }>;
    }> = [
      {
        status: PostStatus.SCHEDULED,
        scheduledFor: inThreeDays,
        caption: "Teaser drop next week",
        targets: [
          {
            platform: SocialPlatform.INSTAGRAM,
            status: PostTargetStatus.SCHEDULED,
            scheduledFor: inThreeDays,
            socialAccountId: socialAccounts.instagram,
          },
          {
            platform: SocialPlatform.FACEBOOK,
            status: PostTargetStatus.SCHEDULED,
            scheduledFor: inThreeDays,
            socialAccountId: socialAccounts.facebook,
          },
        ],
      },
      {
        status: PostStatus.SCHEDULED,
        scheduledFor: inFiveDays,
        caption: "LinkedIn thought leadership",
        targets: [
          {
            platform: SocialPlatform.LINKEDIN,
            status: PostTargetStatus.SCHEDULED,
            scheduledFor: inFiveDays,
            socialAccountId: socialAccounts.linkedin,
          },
        ],
      },
      {
        status: PostStatus.POSTED,
        scheduledFor: pastDay,
        caption: "Recap from recent campaign",
        targets: [
          {
            platform: SocialPlatform.INSTAGRAM,
            status: PostTargetStatus.POSTED,
            scheduledFor: pastDay,
            publishedAt: now,
            socialAccountId: socialAccounts.instagram,
          },
        ],
      },
    ];

    for (const post of posts) {
      await prisma.post.create({
        data: {
          userId: user.id,
          status: post.status,
          scheduledFor: post.scheduledFor,
          caption: post.caption,
          targets: {
            create: post.targets.map((target) => ({
              platform: target.platform,
              status: target.status,
              scheduledFor: target.scheduledFor,
              publishedAt: target.publishedAt,
              socialAccountId: target.socialAccountId,
            })),
          },
        },
      });
    }
  }
}

async function ensureSocialAccounts(userId: string) {
  const platforms = [SocialPlatform.INSTAGRAM, SocialPlatform.FACEBOOK, SocialPlatform.LINKEDIN];
  const ids: Record<"instagram" | "facebook" | "linkedin", string> = {
    instagram: "",
    facebook: "",
    linkedin: "",
  };

  for (const platform of platforms) {
    const existing = await prisma.socialAccount.findFirst({
      where: { userId, platform },
    });
    const account =
      existing ||
      (await prisma.socialAccount.create({
        data: {
          userId,
          platform,
          externalAccountId: `${platform.toLowerCase()}-${userId}`,
          displayName: `${platform} Account`,
        },
      }));

    if (platform === SocialPlatform.INSTAGRAM) ids.instagram = account.id;
    if (platform === SocialPlatform.FACEBOOK) ids.facebook = account.id;
    if (platform === SocialPlatform.LINKEDIN) ids.linkedin = account.id;
  }

  return ids;
}

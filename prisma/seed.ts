import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { PrismaClient, PlanCategory, PostLimitType, SchedulerRole } from "@prisma/client";
import { GLOBAL_PLATFORM_LIMIT } from "../src/config/limits";

const prisma = new PrismaClient();

console.log("Connecting to database:", process.env.DATABASE_URL?.split("@")[1]);

const planSeed = [
  {
    code: "ESSENTIALS",
    name: "Essentials",
    category: PlanCategory.FULL_MANAGEMENT,
    isJewelry: false,
    platformLimit: GLOBAL_PLATFORM_LIMIT,
    platformQty: 2,
    baseVisualQuota: 0,
    basePostQuota: 12,
    postLimitType: PostLimitType.HARD,
    schedulerRole: SchedulerRole.CLIENT,
    priceStandardCents: 39700,
    priceFounderCents: 39700,
    priceYearlyStandardCents: 428760,
    priceYearlyFounderCents: 428760,
    hasYearlyPrice: true,
  },
  {
    code: "SIGNATURE",
    name: "Signature",
    category: PlanCategory.FULL_MANAGEMENT,
    isJewelry: false,
    platformLimit: GLOBAL_PLATFORM_LIMIT,
    platformQty: 3,
    baseVisualQuota: 0,
    basePostQuota: 24,
    postLimitType: PostLimitType.HARD,
    schedulerRole: SchedulerRole.CLIENT,
    priceStandardCents: 59700,
    priceFounderCents: 59700,
    priceYearlyStandardCents: 644760,
    priceYearlyFounderCents: 644760,
    hasYearlyPrice: true,
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

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env");
  }

  const adminEmail = process.env.ADMIN_EMAIL.toLowerCase();
  
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "SUPER_ADMIN" },
    create: {
      email: adminEmail,
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10),
      role: "SUPER_ADMIN",
      emailVerified: true,
      onboardingCompleted: true,
      isFounder: false,
    },
    select: { id: true }
  });

  // Seed 1MFREE coupon
  await prisma.coupon.upsert({
    where: { code: "1MFREE" },
    update: {
      discountType: "percentage",
      discountValue: 100,
      status: "ACTIVE",
    },
    create: {
      code: "1MFREE",
      discountType: "percentage",
      discountValue: 100,
      status: "ACTIVE",
      createdBy: admin.id,
    },
  });
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

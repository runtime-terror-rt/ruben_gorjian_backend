import express from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { buildBrandBriefPdf } from "./pdf";
import { sendBrandBriefSubmissionEmails } from "./email";
import { logger } from "../../lib/logger";

const router = express.Router();

router.use(requireAuth);

const optionalString = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  },
  z.string().max(10000).nullable().optional(),
);

const submitSchema = z.object({
  planCode: z
    .preprocess(
      (value) => {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed.length ? trimmed : undefined;
      },
      z.string().max(100).optional(),
    ),
  restaurantName: z.string().trim().min(1).max(250),
  location: z.string().trim().min(1).max(250),
  businessType: z.string().trim().min(1).max(250),
  cuisineType: z.string().trim().min(1).max(250),
  dietaryCertifications: z.array(z.string().trim().min(1).max(150)).max(50),
  websiteUrl: optionalString,
  instagramHandle: z.string().trim().min(1).max(250),
  facebookPageUrl: optionalString,
  tiktokHandle: optionalString,
  onlineOrderingUrl: optionalString,
  foodDescription: z.string().trim().min(1).max(5000),
  uniqueSellingPoint: z.string().trim().min(1).max(5000),
  customerReviews: z.string().trim().min(1).max(5000),
  forbiddenPhrases: optionalString,
  preferredPhrases: optionalString,
  captionSample1: z.string().trim().min(1).max(5000),
  captionSample2: z.string().trim().min(1).max(5000),
  captionSample3: z.string().trim().min(1).max(5000),
  toneAndVoice: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  captionTargeting: z.string().trim().min(1).max(2000),
  language: z.string().trim().min(1).max(100),
  signatureDishes: z.array(z.string().trim().min(1).max(250)).min(1).max(100),
  signatureDishDetails: z.string().trim().min(1).max(5000),
  excludedItems: optionalString,
  upcomingPromotions: optionalString,
  hashtagStyle: z.string().trim().min(1).max(1000),
  confirmMinDishes: z.string().trim().min(1).max(1000),
  actionShotsPossible: optionalString,
  preferredShootTime: optionalString,
  physicalConstraints: optionalString,
  specialNotes: optionalString,
  clientName: z.string().trim().min(1).max(250),
  restaurantNameAuth: z.string().trim().min(1).max(250),
  submissionDate: z.coerce.date().optional(),
  talexiaPlan: z.string().trim().min(1).max(250).optional(),
});

router.post("/", async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const userId = req.user!.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const data = parsed.data;
  const normalizedPlanCode = data.planCode;
  const proposal = normalizedPlanCode
    ? await prisma.enterprisePlanProposal.findFirst({
        where: { planCode: normalizedPlanCode },
        select: {
          id: true,
          planCode: true,
          planName: true,
        },
      })
    : null;

  const briefPlanCode = proposal?.planCode ?? normalizedPlanCode ?? "GENERAL";
  const briefPlanName = proposal?.planName ?? data.talexiaPlan?.trim() ?? "Brand Brief";

  const submissionDate = data.submissionDate ?? new Date();
  const briefBaseData = {
    userId,
    restaurantName: data.restaurantName,
    location: data.location,
    businessType: data.businessType,
    cuisineType: data.cuisineType,
    dietaryCertifications: data.dietaryCertifications,
    websiteUrl: data.websiteUrl,
    instagramHandle: data.instagramHandle,
    facebookPageUrl: data.facebookPageUrl,
    tiktokHandle: data.tiktokHandle,
    onlineOrderingUrl: data.onlineOrderingUrl,
    foodDescription: data.foodDescription,
    uniqueSellingPoint: data.uniqueSellingPoint,
    customerReviews: data.customerReviews,
    forbiddenPhrases: data.forbiddenPhrases,
    preferredPhrases: data.preferredPhrases,
    captionSample1: data.captionSample1,
    captionSample2: data.captionSample2,
    captionSample3: data.captionSample3,
    toneAndVoice: data.toneAndVoice,
    captionTargeting: data.captionTargeting,
    language: data.language,
    signatureDishes: data.signatureDishes,
    signatureDishDetails: data.signatureDishDetails,
    excludedItems: data.excludedItems,
    upcomingPromotions: data.upcomingPromotions,
    hashtagStyle: data.hashtagStyle,
    confirmMinDishes: data.confirmMinDishes,
    actionShotsPossible: data.actionShotsPossible,
    preferredShootTime: data.preferredShootTime,
    physicalConstraints: data.physicalConstraints,
    specialNotes: data.specialNotes,
    clientName: data.clientName,
    restaurantNameAuth: data.restaurantNameAuth,
    submissionDate,
    talexiaPlan: data.talexiaPlan?.trim() ?? briefPlanName,
  };

  const brief = proposal
    ? await prisma.brandBrief.upsert({
        where: {
          userId_proposalId: {
            userId,
            proposalId: proposal.id,
          },
        },
        update: briefBaseData,
        create: {
          ...briefBaseData,
          proposalId: proposal.id,
        },
        include: {
          proposal: {
            select: {
              id: true,
              planCode: true,
              planName: true,
            },
          },
        },
      })
    : await (async () => {
        const existingBrief = await prisma.brandBrief.findMany({
          where: { userId },
          select: { id: true, proposalId: true },
          orderBy: { createdAt: "desc" },
        });
        const genericBrief = existingBrief.find((briefItem) => briefItem.proposalId === null);

        return genericBrief
          ? prisma.brandBrief.update({
              where: { id: genericBrief.id },
              data: briefBaseData,
              include: {
                proposal: {
                  select: {
                    id: true,
                    planCode: true,
                    planName: true,
                  },
                },
              },
            })
          : prisma.brandBrief.create({
              data: briefBaseData,
              include: {
                proposal: {
                  select: {
                    id: true,
                    planCode: true,
                    planName: true,
                  },
                },
              },
            });
      })();

  await prisma.user.update({
    where: { id: userId },
    data: {
      onboardingCompleted: true,
      brandBriefOnboardingCompleted: true,
    },
  });

  try {
    const pdfBuffer = await buildBrandBriefPdf({
      id: brief.id,
      planCode: briefPlanCode,
      planName: briefPlanName,
      submittedByName: user.name || user.email,
      submittedByEmail: user.email,
      restaurantName: brief.restaurantName,
      location: brief.location,
      businessType: brief.businessType,
      cuisineType: brief.cuisineType,
      dietaryCertifications: brief.dietaryCertifications,
      websiteUrl: brief.websiteUrl,
      instagramHandle: brief.instagramHandle,
      facebookPageUrl: brief.facebookPageUrl,
      tiktokHandle: brief.tiktokHandle,
      onlineOrderingUrl: brief.onlineOrderingUrl,
      foodDescription: brief.foodDescription,
      uniqueSellingPoint: brief.uniqueSellingPoint,
      customerReviews: brief.customerReviews,
      forbiddenPhrases: brief.forbiddenPhrases,
      preferredPhrases: brief.preferredPhrases,
      captionSample1: brief.captionSample1,
      captionSample2: brief.captionSample2,
      captionSample3: brief.captionSample3,
      toneAndVoice: brief.toneAndVoice,
      captionTargeting: brief.captionTargeting,
      language: brief.language,
      signatureDishes: brief.signatureDishes,
      signatureDishDetails: brief.signatureDishDetails,
      excludedItems: brief.excludedItems,
      upcomingPromotions: brief.upcomingPromotions,
      hashtagStyle: brief.hashtagStyle,
      confirmMinDishes: brief.confirmMinDishes,
      actionShotsPossible: brief.actionShotsPossible,
      preferredShootTime: brief.preferredShootTime,
      physicalConstraints: brief.physicalConstraints,
      specialNotes: brief.specialNotes,
      clientName: brief.clientName,
      restaurantNameAuth: brief.restaurantNameAuth,
      submissionDate: brief.submissionDate,
      talexiaPlan: brief.talexiaPlan,
      createdAt: brief.createdAt,
    });

    await sendBrandBriefSubmissionEmails({
      userEmail: user.email,
      userName: user.name || user.email,
      planCode: briefPlanCode,
      planName: briefPlanName,
      briefId: brief.id,
      briefCreatedAt: brief.createdAt,
      pdfBuffer,
      restaurantName: brief.restaurantName,
      location: brief.location,
      businessType: brief.businessType,
      cuisineType: brief.cuisineType,
      dietaryCertifications: brief.dietaryCertifications,
      websiteUrl: brief.websiteUrl,
      instagramHandle: brief.instagramHandle,
      facebookPageUrl: brief.facebookPageUrl,
      tiktokHandle: brief.tiktokHandle,
      onlineOrderingUrl: brief.onlineOrderingUrl,
      foodDescription: brief.foodDescription,
      uniqueSellingPoint: brief.uniqueSellingPoint,
      customerReviews: brief.customerReviews,
      forbiddenPhrases: brief.forbiddenPhrases,
      preferredPhrases: brief.preferredPhrases,
      captionSample1: brief.captionSample1,
      captionSample2: brief.captionSample2,
      captionSample3: brief.captionSample3,
      toneAndVoice: brief.toneAndVoice,
      captionTargeting: brief.captionTargeting,
      language: brief.language,
      signatureDishes: brief.signatureDishes,
      signatureDishDetails: brief.signatureDishDetails,
      excludedItems: brief.excludedItems,
      upcomingPromotions: brief.upcomingPromotions,
      hashtagStyle: brief.hashtagStyle,
      confirmMinDishes: brief.confirmMinDishes,
      actionShotsPossible: brief.actionShotsPossible,
      preferredShootTime: brief.preferredShootTime,
      physicalConstraints: brief.physicalConstraints,
      specialNotes: brief.specialNotes,
      clientName: brief.clientName,
      restaurantNameAuth: brief.restaurantNameAuth,
      submissionDate: brief.submissionDate,
      talexiaPlan: brief.talexiaPlan,
    });
  } catch (error) {
    logger.error("Brand brief email delivery failed", {
      brandBriefId: brief.id,
      userId,
      error,
    });
  }

  return res.status(201).json({ success: true, brief });
});

router.get("/me", async (req, res) => {
  const userId = req.user!.id;

  const items = await prisma.brandBrief.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      proposal: {
        select: {
          id: true,
          planCode: true,
          planName: true,
          companyName: true,
          email: true,
        },
      },
    },
  });

  return res.json({ success: true, items });
});

router.get("/admin/submissions", requireAdmin, async (req, res) => {
  const querySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    planCode: z.string().trim().optional(),
    email: z.string().trim().optional(),
  });

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const { page, limit, planCode, email } = parsed.data;
  const where = {
    ...(planCode ? { proposal: { planCode: { contains: planCode, mode: "insensitive" as const } } } : {}),
    ...(email ? { user: { email: { contains: email, mode: "insensitive" as const } } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.brandBrief.count({ where }),
    prisma.brandBrief.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        restaurantName: true,
        location: true,
        businessType: true,
        createdAt: true,
        submissionDate: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        proposal: {
          select: {
            id: true,
            planCode: true,
            planName: true,
            companyName: true,
          },
        },
      },
    }),
  ]);

  return res.json({
    success: true,
    data: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    },
  });
});

router.get("/admin/submissions/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");

  if (!id) {
    return res.status(400).json({ error: "Brand brief id is required" });
  }

  const item = await prisma.brandBrief.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      proposal: {
        select: {
          id: true,
          planCode: true,
          planName: true,
          companyName: true,
          amount: true,
          billingCycle: true,
          createdByAdminEmail: true,
        },
      },
    },
  });

  if (!item) {
    return res.status(404).json({ error: "Brand brief not found" });
  }

  return res.json({ success: true, item });
});

export { router as brandBriefRouter };

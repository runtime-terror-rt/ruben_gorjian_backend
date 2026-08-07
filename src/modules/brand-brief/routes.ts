import express from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { buildBrandBriefPdf } from "./pdf";
import { sendBrandBriefSubmissionEmails } from "./email";
import { logger } from "../../lib/logger";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../../config/env";
import { clearBrandBriefReminders } from "../jobs/brand-brief-reminder-queue";

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
  brandName: z.string().trim().min(1).max(250),
  businessType: z.string().trim().min(1).max(250),
  primaryLocation: z.string().trim().min(1).max(250),
  websiteUrl: optionalString,
  industryCategory: z.string().trim().min(1).max(250),
  
  brandStory: z.string().trim().min(1).max(10000),
  brandVoiceDescriptors: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  targetAudience: z.string().trim().min(1).max(10000),
  taglines: optionalString,
  brandsYouAdmire: optionalString,
  whatToAvoid: optionalString,

  aestheticDirection: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  preferredColorPalette: optionalString,
  stagingPreferences: optionalString,
  visualReferences: optionalString,

  productFocus: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  typicalPriceRange: optionalString,
  keyCollections: optionalString,
  materialsCertifications: z.string().trim().min(1).max(10000),
  seasonalCalendar: optionalString,
  birthstoneTheming: z.string().trim().min(1).max(250),

  sampleCaptions: z.string().trim().min(1).max(10000),
  captionTargeting: z.string().trim().min(1).max(2000),
  language: z.string().trim().min(1).max(100),
  hashtagStyle: z.string().trim().min(1).max(1000),
  sensitiveTopics: optionalString,

  platforms: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  timezone: z.string().trim().min(1).max(250),
  preferredPostingDays: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  preferredTimeWindows: z.array(z.string().trim().min(1).max(250)).min(1).max(50),
  additionalPostingNotes: optionalString,
  timeCriticalDates: optionalString,
  platformAuthorizationContact: optionalString,

  googleDriveEmails: z.string().trim().min(1).max(1000),
  skuFilenameConvention: optionalString,
  productIdentificationNotes: optionalString,

  primaryContactName: z.string().trim().min(1).max(250),
  primaryContactEmail: z.string().trim().min(1).max(250),
  secondaryContactName: optionalString,
  secondaryContactEmail: optionalString,
  preferredCommunication: z.string().trim().min(1).max(250),
  whatsappNumber: optionalString,

  authSignedAs: z.string().trim().min(1).max(250),
  authOnBehalfOf: z.string().trim().min(1).max(250),
  authSubmissionDate: z.coerce.date(),
  authTalexiaPlan: z.string().trim().min(1).max(250),
  authIHaveReadAndAgree: z.boolean(),
});

function generateReferenceCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomStr = '';
  for (let i = 0; i < 6; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TLX-BB-${new Date().getFullYear()}-${randomStr}`;
}

async function uploadPdfToS3(userId: string, referenceCode: string, pdfBuffer: Buffer): Promise<string | null> {
  if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    logger.warn("S3 not configured; skipping PDF upload");
    return null;
  }
  try {
    const s3 = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
    const key = `brand-briefs/${userId}/${referenceCode}.pdf`;
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    });
    await s3.send(command);
    return key;
  } catch (error) {
    logger.error("Failed to upload Brand Brief PDF to S3", error);
    return null;
  }
}

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
  
  // Try to find the user's active subscription first
  const activeSubscription = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  
  if (!activeSubscription) {
    return res.status(403).json({ error: "You must have an active plan to submit a Brand Brief." });
  }
  
  const normalizedPlanCode = activeSubscription.planCode;
  
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

  let dbPlanName = "Brand Brief";
  if (normalizedPlanCode) {
    const p = await prisma.plan.findUnique({
      where: { code: normalizedPlanCode },
      select: { name: true }
    });
    if (p) dbPlanName = p.name.toUpperCase();
  }

  const briefPlanCode = proposal?.planCode ?? normalizedPlanCode ?? "GENERAL";
  const briefPlanName = dbPlanName;

  const referenceCode = generateReferenceCode();
  
  const agreedAuthorizationText = `By submitting this Brand Brief, I confirm and authorize the following.
- All brand information provided in this Brief is accurate, current, and complete to the best of my knowledge.
- I authorize Talexia to produce visual content, captions, hashtags, and posting schedules on behalf of my brand using the information provided in this Brief.
- I authorize Talexia to publish content directly to my connected social media platforms on my behalf, without requiring my prior review or approval of individual posts.
- I understand that Talexia's content is generated from this Brief, and that inaccurate or incomplete information may affect content quality.
- I understand that stylistic preferences are not grounds for revision or regeneration — those are governed by this Brief and by future Brief updates.
- I understand that verifiable factual errors in published content must be reported within 48 hours of publication and will be corrected in the next scheduled content cycle.
- I understand that significant brand changes must be submitted as an updated Brand Brief to take effect the following month.
- I confirm that I have read and accepted Talexia's Service Policy and Privacy Policy.

By submitting this form, I am entering into a standing publishing authorization with Talexia that remains active for the duration of my subscription.`;

  const briefBaseData = {
    userId,
    referenceCode,
    agreedAuthorizationText,
    brandName: data.brandName,
    businessType: data.businessType,
    primaryLocation: data.primaryLocation,
    websiteUrl: data.websiteUrl,
    industryCategory: data.industryCategory,
    brandStory: data.brandStory,
    brandVoiceDescriptors: data.brandVoiceDescriptors,
    targetAudience: data.targetAudience,
    taglines: data.taglines,
    brandsYouAdmire: data.brandsYouAdmire,
    whatToAvoid: data.whatToAvoid,
    aestheticDirection: data.aestheticDirection,
    preferredColorPalette: data.preferredColorPalette,
    stagingPreferences: data.stagingPreferences,
    visualReferences: data.visualReferences,
    productFocus: data.productFocus,
    typicalPriceRange: data.typicalPriceRange,
    keyCollections: data.keyCollections,
    materialsCertifications: data.materialsCertifications,
    seasonalCalendar: data.seasonalCalendar,
    birthstoneTheming: data.birthstoneTheming,
    sampleCaptions: data.sampleCaptions,
    captionTargeting: data.captionTargeting,
    language: data.language,
    hashtagStyle: data.hashtagStyle,
    sensitiveTopics: data.sensitiveTopics,
    platforms: data.platforms,
    timezone: data.timezone,
    preferredPostingDays: data.preferredPostingDays,
    preferredTimeWindows: data.preferredTimeWindows,
    additionalPostingNotes: data.additionalPostingNotes,
    timeCriticalDates: data.timeCriticalDates,
    platformAuthorizationContact: data.platformAuthorizationContact,
    googleDriveEmails: data.googleDriveEmails,
    skuFilenameConvention: data.skuFilenameConvention,
    productIdentificationNotes: data.productIdentificationNotes,
    primaryContactName: data.primaryContactName,
    primaryContactEmail: data.primaryContactEmail,
    secondaryContactName: data.secondaryContactName,
    secondaryContactEmail: data.secondaryContactEmail,
    preferredCommunication: data.preferredCommunication,
    whatsappNumber: data.whatsappNumber,
    authSignedAs: data.authSignedAs,
    authOnBehalfOf: data.authOnBehalfOf,
    authSubmissionDate: data.authSubmissionDate,
    authTalexiaPlan: data.authTalexiaPlan,
    authIHaveReadAndAgree: data.authIHaveReadAndAgree,
  };

  // We are now appending records so we just use create.
  const brief = await prisma.brandBrief.create({
    data: {
      ...briefBaseData,
      proposalId: proposal?.id || null,
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
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      onboardingCompleted: true,
      brandBriefOnboardingCompleted: true,
    },
  });

  // Clear any scheduled reminders
  await clearBrandBriefReminders(userId);

  try {
    const pdfBuffer = await buildBrandBriefPdf({
      id: brief.id,
      referenceCode: brief.referenceCode,
      planCode: briefPlanCode,
      planName: briefPlanName,
      submittedByName: user.name || user.email,
      submittedByEmail: user.email,
      createdAt: brief.createdAt,
      agreedAuthorizationText: brief.agreedAuthorizationText,
      brandName: brief.brandName,
      businessType: brief.businessType,
      primaryLocation: brief.primaryLocation,
      websiteUrl: brief.websiteUrl,
      industryCategory: brief.industryCategory,
      brandStory: brief.brandStory,
      brandVoiceDescriptors: brief.brandVoiceDescriptors,
      targetAudience: brief.targetAudience,
      taglines: brief.taglines,
      brandsYouAdmire: brief.brandsYouAdmire,
      whatToAvoid: brief.whatToAvoid,
      aestheticDirection: brief.aestheticDirection,
      preferredColorPalette: brief.preferredColorPalette,
      stagingPreferences: brief.stagingPreferences,
      visualReferences: brief.visualReferences,
      productFocus: brief.productFocus,
      typicalPriceRange: brief.typicalPriceRange,
      keyCollections: brief.keyCollections,
      materialsCertifications: brief.materialsCertifications,
      seasonalCalendar: brief.seasonalCalendar,
      birthstoneTheming: brief.birthstoneTheming,
      sampleCaptions: brief.sampleCaptions,
      captionTargeting: brief.captionTargeting,
      language: brief.language,
      hashtagStyle: brief.hashtagStyle,
      sensitiveTopics: brief.sensitiveTopics,
      platforms: brief.platforms,
      timezone: brief.timezone,
      preferredPostingDays: brief.preferredPostingDays,
      preferredTimeWindows: brief.preferredTimeWindows,
      additionalPostingNotes: brief.additionalPostingNotes,
      timeCriticalDates: brief.timeCriticalDates,
      platformAuthorizationContact: brief.platformAuthorizationContact,
      googleDriveEmails: brief.googleDriveEmails,
      skuFilenameConvention: brief.skuFilenameConvention,
      productIdentificationNotes: brief.productIdentificationNotes,
      primaryContactName: brief.primaryContactName,
      primaryContactEmail: brief.primaryContactEmail,
      secondaryContactName: brief.secondaryContactName,
      secondaryContactEmail: brief.secondaryContactEmail,
      preferredCommunication: brief.preferredCommunication,
      whatsappNumber: brief.whatsappNumber,
      authSignedAs: brief.authSignedAs,
      authOnBehalfOf: brief.authOnBehalfOf,
      authSubmissionDate: brief.authSubmissionDate,
      authTalexiaPlan: brief.authTalexiaPlan,
      authIHaveReadAndAgree: brief.authIHaveReadAndAgree,
    });

    const pdfStorageKey = await uploadPdfToS3(userId, brief.referenceCode, pdfBuffer);
    if (pdfStorageKey) {
      await prisma.brandBrief.update({
        where: { id: brief.id },
        data: { pdfStorageKey },
      });
      brief.pdfStorageKey = pdfStorageKey;
    }

    await sendBrandBriefSubmissionEmails({
      referenceCode: brief.referenceCode,
      userEmail: user.email,
      userName: user.name || user.email,
      planCode: briefPlanCode,
      planName: briefPlanName,
      briefId: brief.id,
      briefCreatedAt: brief.createdAt,
      pdfBuffer,
      brandName: brief.brandName,
      businessType: brief.businessType,
      primaryLocation: brief.primaryLocation,
      websiteUrl: brief.websiteUrl,
      industryCategory: brief.industryCategory,
      brandStory: brief.brandStory,
      brandVoiceDescriptors: brief.brandVoiceDescriptors,
      targetAudience: brief.targetAudience,
      taglines: brief.taglines,
      brandsYouAdmire: brief.brandsYouAdmire,
      whatToAvoid: brief.whatToAvoid,
      aestheticDirection: brief.aestheticDirection,
      preferredColorPalette: brief.preferredColorPalette,
      stagingPreferences: brief.stagingPreferences,
      visualReferences: brief.visualReferences,
      productFocus: brief.productFocus,
      typicalPriceRange: brief.typicalPriceRange,
      keyCollections: brief.keyCollections,
      materialsCertifications: brief.materialsCertifications,
      seasonalCalendar: brief.seasonalCalendar,
      birthstoneTheming: brief.birthstoneTheming,
      sampleCaptions: brief.sampleCaptions,
      captionTargeting: brief.captionTargeting,
      language: brief.language,
      hashtagStyle: brief.hashtagStyle,
      sensitiveTopics: brief.sensitiveTopics,
      platforms: brief.platforms,
      timezone: brief.timezone,
      preferredPostingDays: brief.preferredPostingDays,
      preferredTimeWindows: brief.preferredTimeWindows,
      additionalPostingNotes: brief.additionalPostingNotes,
      timeCriticalDates: brief.timeCriticalDates,
      platformAuthorizationContact: brief.platformAuthorizationContact,
      googleDriveEmails: brief.googleDriveEmails,
      skuFilenameConvention: brief.skuFilenameConvention,
      productIdentificationNotes: brief.productIdentificationNotes,
      primaryContactName: brief.primaryContactName,
      primaryContactEmail: brief.primaryContactEmail,
      secondaryContactName: brief.secondaryContactName,
      secondaryContactEmail: brief.secondaryContactEmail,
      preferredCommunication: brief.preferredCommunication,
      whatsappNumber: brief.whatsappNumber,
      authSignedAs: brief.authSignedAs,
      authOnBehalfOf: brief.authOnBehalfOf,
      authSubmissionDate: brief.authSubmissionDate,
      authTalexiaPlan: brief.authTalexiaPlan,
      authIHaveReadAndAgree: brief.authIHaveReadAndAgree,
    });
  } catch (error) {
    logger.error("Brand brief pdf/email processing failed", {
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
        referenceCode: true,
        brandName: true,
        primaryLocation: true,
        businessType: true,
        createdAt: true,
        authSubmissionDate: true,
        pdfStorageKey: true,
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

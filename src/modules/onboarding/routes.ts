import express from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import type { PlanCategory } from "../../types/plan-category";
import { logger } from "../../lib/logger";
import { safeUrl, sanitizeStorageKey, timezoneValidator } from "../../lib/validators";

const router = express.Router();

router.use(requireAuth);

// Rate limiting for onboarding endpoints (stricter than general API)
const onboardingLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 40, // 40 requests per 30 minutes
  message: { error: "Too many onboarding requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Standardized error response helper
function errorResponse(message: string, details?: unknown): { error: string; details?: unknown } {
  const response: { error: string; details?: unknown } = { error: message };
  if (details) {
    response.details = details;
  }
  return response;
}

// Accept undefined/null/empty-string for optional logo keys.
const optionalLogoStorageKeySchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    return value;
  },
  z.string().min(1).optional()
);

// Logo validation helper
async function validateLogoFile(
  userId: string,
  logoStorageKey: string
): Promise<{ valid: boolean; error?: string }> {
  if (!logoStorageKey || logoStorageKey.trim().length === 0) {
    return { valid: false, error: "Logo file is required" };
  }

  try {
    const logoFile = await prisma.brandFile.findFirst({
      where: { userId, storageKey: logoStorageKey },
    });

    if (!logoFile) {
      return {
        valid: false,
        error: "Logo file not found. Please upload logo first.",
      };
    }

    return { valid: true };
  } catch (error) {
    logger.error("Error validating logo file", {
      userId,
      logoStorageKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      valid: false,
      error: "Failed to validate logo file. Please try again.",
    };
  }
}

// Helper to build shared brand profile data for visual onboarding
function buildVisualOnboardingBrandProfileData(data: {
  industry: string;
  industryOther?: string;
  targetAudience: string;
  salesModel?: string[];
  logoStorageKey?: string;
  websiteUrl?: string;
  primaryPlatform: string;
  ctaEmbedded: string;
  outlineFrame: string;
  brandVibe: string[];
  visualStylePreference: string;
}) {
  return {
    visualOnboardingData: {
      industry: data.industry,
      industryOther: data.industryOther,
      targetAudience: data.targetAudience,
      salesModel: data.salesModel || [],
      ...(data.logoStorageKey ? { logoStorageKey: data.logoStorageKey } : {}),
      websiteUrl: data.websiteUrl,
      primaryPlatform: data.primaryPlatform,
      ctaEmbedded: data.ctaEmbedded,
      outlineFrame: data.outlineFrame,
      brandVibe: data.brandVibe,
      visualStylePreference: data.visualStylePreference,
    },
    industry: data.industryOther || data.industry,
    website: data.websiteUrl,
  };
}

// Helper to build shared brand profile data for full management onboarding
function buildFullManagementOnboardingBrandProfileData(data: {
  businessName: string;
  websiteUrl: string;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  platformsToManage: string[];
  postingAccessGranted: string;
  industry: string;
  industryOther?: string;
  targetAudience: string[];
  salesModel?: string[];
  logoStorageKey?: string;
  brandPersonality: string[];
  toneToAvoid?: string;
  imageUsagePermission: string;
  visualStylePreference: string;
  outlineFrame: string;
  allowCtas: "YES" | "NO";
  postingFrequencyPreference?: string;
  postingTimePreference?: string[];
}) {
  return {
    fullManagementOnboardingData: {
      businessName: data.businessName,
      websiteUrl: data.websiteUrl,
      instagramUrl: data.instagramUrl,
      facebookUrl: data.facebookUrl,
      linkedinUrl: data.linkedinUrl,
      platformsToManage: data.platformsToManage,
      postingAccessGranted: data.postingAccessGranted,
      industry: data.industry,
      industryOther: data.industryOther,
      targetAudience: data.targetAudience,
      salesModel: data.salesModel || [],
      ...(data.logoStorageKey ? { logoStorageKey: data.logoStorageKey } : {}),
      brandPersonality: data.brandPersonality,
      toneToAvoid: data.toneToAvoid,
      imageUsagePermission: data.imageUsagePermission,
      visualStylePreference: data.visualStylePreference,
      outlineFrame: data.outlineFrame,
      allowCtas: data.allowCtas,
      postingFrequencyPreference: data.postingFrequencyPreference,
      postingTimePreference: data.postingTimePreference || [],
    },
    industry: data.industryOther || data.industry,
    website: data.websiteUrl,
    audience: data.targetAudience.join(", "),
    socials: {
      instagram: data.instagramUrl,
      facebook: data.facebookUrl,
      linkedin: data.linkedinUrl,
    },
    ctaPreferences: data.allowCtas === "YES" ? "Allowed" : "No CTAs",
  };
}

// Helper to get user's active plan category
// Checks subscription first, then pendingPlanCode if no subscription exists
async function getUserPlanCategory(userId: string): Promise<PlanCategory | null> {
  // First check for active subscription
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ["ACTIVE", "TRIALING"] },
    },
    include: {
      plan: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  
  if (subscription?.plan?.category) {
    return subscription.plan.category as PlanCategory;
  }

  // If no subscription, check for pendingPlanCode
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  // Type assertion needed until TypeScript server picks up regenerated Prisma types
  const pendingPlanCode = (user as { pendingPlanCode?: string | null } | null)?.pendingPlanCode;

  if (pendingPlanCode) {
    try {
      const pendingPlan = await prisma.plan.findUnique({
        where: { code: pendingPlanCode },
      });
      if (pendingPlan) {
        return pendingPlan.category as PlanCategory;
      } else {
        // Invalid pendingPlanCode - log and clear it
        logger.warn("Invalid pendingPlanCode in getUserPlanCategory", {
          userId,
          pendingPlanCode,
        });
        // Fire-and-forget cleanup
        prisma.user.update({
          where: { id: userId },
          data: { pendingPlanCode: null } as { pendingPlanCode: null },
        }).catch((err) => {
          logger.error("Failed to clear invalid pendingPlanCode", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (error) {
      logger.error("Error looking up pendingPlanCode in getUserPlanCategory", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

// ============================================================================
// CALENDAR ONBOARDING (ACCESS-ONLY)
// ============================================================================

const calendarOnboardingSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(), // Already have email, but allow override
  platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])).min(1),
  timezone: timezoneValidator().optional(),
  timezoneAutoDetect: z.boolean().optional(),
  insightGoal: z.enum(["STAY_CONSISTENT", "PLAN_AHEAD", "REDUCE_LAST_MINUTE"]).optional(),
});

router.post("/calendar", onboardingLimiter, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Verify user has a Calendar plan (regular or jewelry)
    const planCategory = await getUserPlanCategory(userId);
    const isCalendarPlan =
      planCategory === "CALENDAR_ONLY" ||
      planCategory === "VISUAL_CALENDAR" ||
      planCategory === "JEWELRY_CALENDAR_ONLY";
    if (!isCalendarPlan) {
      return res
        .status(403)
        .json(
          errorResponse(
            "Calendar onboarding is only available for Calendar plans"
          )
        );
    }

    const parsed = calendarOnboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          errorResponse("Invalid request data", parsed.error.flatten())
        );
    }

    const data = parsed.data;

    // Wrap all operations in a transaction
    await prisma.$transaction(async (tx) => {
      // Update user profile if name provided
      if (data.name) {
        await tx.userProfile.upsert({
          where: { userId },
          update: { fullName: data.name },
          create: {
            userId,
            fullName: data.name,
            timezone: data.timezoneAutoDetect ? undefined : data.timezone,
          },
        });
      }

      // Save onboarding data to brand profile
      await tx.brandProfile.upsert({
        where: { userId },
        update: {
          calendarOnboardingData: {
            platforms: data.platforms,
            timezone: data.timezoneAutoDetect ? "AUTO" : data.timezone,
            insightGoal: data.insightGoal,
          },
        },
        create: {
          userId,
          calendarOnboardingData: {
            platforms: data.platforms,
            timezone: data.timezoneAutoDetect ? "AUTO" : data.timezone,
            insightGoal: data.insightGoal,
          },
        },
      });

      // Mark calendar onboarding as completed
      await tx.user.update({
        where: { id: userId },
        data: {
          calendarOnboardingCompleted: true,
          onboardingCompleted: true,
        },
      });
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error in calendar onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to save calendar onboarding. Please try again."
        )
      );
  }
});

router.get("/calendar", async (req, res) => {
  const userId = req.user!.id;

  try {
    const [profile, userProfile, user] = await Promise.all([
      prisma.brandProfile.findUnique({ where: { userId } }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    return res.json({
      data: profile?.calendarOnboardingData || null,
      name: userProfile?.fullName || null,
      completed: user?.calendarOnboardingCompleted || false,
    });
  } catch (error) {
    logger.error("Error fetching calendar onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to fetch calendar onboarding data. Please try again."
        )
      );
  }
});

// ============================================================================
// VISUAL ONLY ONBOARDING (OUTPUT-ONLY)
// ============================================================================

const visualOnboardingSchema = z.object({
  // Section 1: Business Context
  industry: z.enum(["RESTAURANT", "CAFE_COFFEE", "JEWELRY", "RUGS_HOME_DECOR", "APPAREL", "OTHER"]),
  industryOther: z.string().optional(),
  targetAudience: z.enum(["B2C", "B2B"]),
  salesModel: z.array(z.enum(["RETAIL", "WHOLESALE", "BOTH"])).optional(),
  
  // Section 2: Brand Anchors
  logoStorageKey: optionalLogoStorageKeySchema,
  websiteUrl: safeUrl().optional(),
  
  // Section 3: Usage Context
  primaryPlatform: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "WEBSITE", "ADS"]),
  
  // Section 4: Visual Add-Ons
  ctaEmbedded: z.enum(["YES", "NO"]),
  outlineFrame: z.enum(["YES", "NO"]),
  
  // Section 5: Creative Direction
  brandVibe: z.array(z.enum(["CLEAN_MINIMAL", "WARM_COZY", "BOLD_HIGH_CONTRAST", "PREMIUM_LUXURY", "NATURAL_LIFESTYLE"])).max(3).min(1),
  visualStylePreference: z.enum(["REALISTIC", "SLIGHTLY_ENHANCED", "MARKETING_STYLE"]),
  
  // Section 6: Asset Upload (handled separately via asset uploads)
});

const visualOnboardingDraftSchema = z.object({
  currentSection: z.number().int().min(1).max(5).optional(),
  logoStorageKey: optionalLogoStorageKeySchema,
  industry: z.enum(["RESTAURANT", "CAFE_COFFEE", "JEWELRY", "RUGS_HOME_DECOR", "APPAREL", "OTHER"]).optional(),
  industryOther: z.string().optional(),
  targetAudience: z.enum(["B2C", "B2B"]).optional(),
  salesModel: z.array(z.enum(["RETAIL", "WHOLESALE", "BOTH"])).optional(),
  websiteUrl: safeUrl().optional(),
  primaryPlatform: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "WEBSITE", "ADS"]).optional(),
  ctaEmbedded: z.enum(["YES", "NO"]).optional(),
  outlineFrame: z.enum(["YES", "NO"]).optional(),
  brandVibe: z.array(z.enum(["CLEAN_MINIMAL", "WARM_COZY", "BOLD_HIGH_CONTRAST", "PREMIUM_LUXURY", "NATURAL_LIFESTYLE"])).max(3).optional(),
  visualStylePreference: z.enum(["REALISTIC", "SLIGHTLY_ENHANCED", "MARKETING_STYLE"]).optional(),
});

router.post("/visual/draft", onboardingLimiter, async (req, res) => {
  const userId = req.user!.id;

  try {
    const planCategory = await getUserPlanCategory(userId);
    const isVisualPlan =
      planCategory === "VISUAL_ADD_ON" ||
      planCategory === "JEWELRY_VISUAL";
    if (!isVisualPlan) {
      return res.status(403).json(
        errorResponse(
          "Visual onboarding is only available for Visual Add-On plans. Please select a Visual Add-On plan to continue."
        )
      );
    }

    const parsed = visualOnboardingDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(errorResponse("Invalid request data", parsed.error.flatten()));
    }

    const data = parsed.data;
    if (data.logoStorageKey) {
      try {
        sanitizeStorageKey(data.logoStorageKey);
      } catch (error) {
        return res.status(400).json(
          errorResponse(
            error instanceof Error ? error.message : "Invalid storage key format"
          )
        );
      }
    }

    const existingProfile = await prisma.brandProfile.findUnique({
      where: { userId },
      select: { visualOnboardingData: true },
    });

    const existingData =
      (existingProfile?.visualOnboardingData as Record<string, unknown>) || {};

    const merged = {
      ...existingData,
      ...data,
      draftSavedAt: new Date().toISOString(),
    };

    await prisma.brandProfile.upsert({
      where: { userId },
      update: { visualOnboardingData: merged },
      create: { userId, visualOnboardingData: merged },
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error saving visual onboarding draft", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(errorResponse("Failed to save draft. Please try again."));
  }
});

router.post("/visual", onboardingLimiter, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Verify user has a Visual plan (regular or jewelry)
    const planCategory = await getUserPlanCategory(userId);
    const isVisualPlan =
      planCategory === "VISUAL_ADD_ON" ||
      planCategory === "JEWELRY_VISUAL";
    if (!isVisualPlan) {
      return res.status(403).json(
        errorResponse(
          "Visual onboarding is only available for Visual Add-On plans. Please select a Visual Add-On plan to continue."
        )
      );
    }

    const parsed = visualOnboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          errorResponse("Invalid request data", parsed.error.flatten())
        );
    }

    const data = parsed.data;

    if (data.logoStorageKey) {
      try {
        sanitizeStorageKey(data.logoStorageKey);
      } catch (error) {
        return res.status(400).json(
          errorResponse(
            error instanceof Error ? error.message : "Invalid storage key format"
          )
        );
      }

      const logoValidation = await validateLogoFile(userId, data.logoStorageKey);
      if (!logoValidation.valid) {
        return res.status(400).json(errorResponse(logoValidation.error!));
      }
    }

    // Wrap all operations in a transaction
    await prisma.$transaction(async (tx) => {
      // Build shared brand profile data
      const brandProfileData = buildVisualOnboardingBrandProfileData({
        industry: data.industry,
        industryOther: data.industryOther,
        targetAudience: data.targetAudience,
        salesModel: data.salesModel,
        logoStorageKey: data.logoStorageKey,
        websiteUrl: data.websiteUrl,
        primaryPlatform: data.primaryPlatform,
        ctaEmbedded: data.ctaEmbedded,
        outlineFrame: data.outlineFrame,
        brandVibe: data.brandVibe,
        visualStylePreference: data.visualStylePreference,
      });

      // Save onboarding data
      await tx.brandProfile.upsert({
        where: { userId },
        update: brandProfileData,
        create: {
          userId,
          ...brandProfileData,
        },
      });

      // Mark visual onboarding as completed
      await tx.user.update({
        where: { id: userId },
        data: {
          visualOnboardingCompleted: true,
          onboardingCompleted: true,
        },
      });
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error in visual onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to save visual onboarding. Please try again."
        )
      );
  }
});

router.get("/visual", async (req, res) => {
  const userId = req.user!.id;

  try {
    const [profile, user] = await Promise.all([
      prisma.brandProfile.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    return res.json({
      data: profile?.visualOnboardingData || null,
      completed: user?.visualOnboardingCompleted || false,
    });
  } catch (error) {
    logger.error("Error fetching visual onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to fetch visual onboarding data. Please try again."
        )
      );
  }
});

// ============================================================================
// FULL MANAGEMENT ONBOARDING (SYSTEM + EXECUTION)
// ============================================================================

const fullManagementOnboardingSchema = z.object({
  // Section 1: Business & Access (MANDATORY)
  businessName: z.string().min(1),
  websiteUrl: safeUrl(),
  instagramUrl: safeUrl().optional(),
  facebookUrl: safeUrl().optional(),
  linkedinUrl: safeUrl().optional(),
  platformsToManage: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])).min(1),
  postingAccessGranted: z.enum(["YES", "WILL_GRANT_AFTER"]),
  
  // Section 2: Business Context
  industry: z.enum(["RESTAURANT", "CAFE_COFFEE", "JEWELRY", "RUGS_HOME_DECOR", "APPAREL", "OTHER"]),
  industryOther: z.string().optional(),
  targetAudience: z.array(z.enum(["B2C", "B2B"])).min(1),
  salesModel: z.array(z.enum(["RETAIL", "WHOLESALE", "BOTH"])).optional(),
  
  // Section 3: Brand Anchors (MANDATORY)
  logoStorageKey: optionalLogoStorageKeySchema,
  brandPersonality: z.array(z.enum(["CLEAN_MINIMAL", "WARM_COZY", "BOLD_HIGH_CONTRAST", "PREMIUM_LUXURY", "NATURAL_LIFESTYLE", "PROFESSIONAL", "PLAYFUL", "SOPHISTICATED"])).max(3).min(1),
  toneToAvoid: z.string().optional(),
  
  // Section 4: Visual Rules
  imageUsagePermission: z.enum(["YES_ALL", "YES_BRAND_ONLY", "NO_STOCK", "CUSTOM"]),
  visualStylePreference: z.enum(["REALISTIC", "SLIGHTLY_ENHANCED", "MARKETING_STYLE"]),
  outlineFrame: z.enum(["YES", "NO"]),
  
  // Section 5: CTA Rules
  allowCtas: z.enum(["YES", "NO"]),
  
  // Section 6: Scheduling Preferences (NON-AUTHORITATIVE)
  postingFrequencyPreference: z.enum(["DAILY", "WEEKLY_3", "WEEKLY_5", "WEEKLY_7", "FORTNIGHTLY"]).optional(),
  postingTimePreference: z.array(z.enum(["MORNING", "AFTERNOON", "EVENING", "NIGHT"])).optional(),
});

const fullManagementOnboardingDraftSchema = z.object({
  currentSection: z.number().int().min(1).max(6).optional(),
  businessName: z.string().min(1).optional(),
  websiteUrl: safeUrl().optional(),
  instagramUrl: safeUrl().optional(),
  facebookUrl: safeUrl().optional(),
  linkedinUrl: safeUrl().optional(),
  platformsToManage: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])).optional(),
  postingAccessGranted: z.enum(["YES", "WILL_GRANT_AFTER"]).optional(),
  industry: z.enum(["RESTAURANT", "CAFE_COFFEE", "JEWELRY", "RUGS_HOME_DECOR", "APPAREL", "OTHER"]).optional(),
  industryOther: z.string().optional(),
  targetAudience: z.array(z.enum(["B2C", "B2B"])).optional(),
  salesModel: z.array(z.enum(["RETAIL", "WHOLESALE", "BOTH"])).optional(),
  logoStorageKey: optionalLogoStorageKeySchema,
  brandPersonality: z.array(z.enum(["CLEAN_MINIMAL", "WARM_COZY", "BOLD_HIGH_CONTRAST", "PREMIUM_LUXURY", "NATURAL_LIFESTYLE", "PROFESSIONAL", "PLAYFUL", "SOPHISTICATED"])).max(3).optional(),
  toneToAvoid: z.string().optional(),
  imageUsagePermission: z.enum(["YES_ALL", "YES_BRAND_ONLY", "NO_STOCK", "CUSTOM"]).optional(),
  visualStylePreference: z.enum(["REALISTIC", "SLIGHTLY_ENHANCED", "MARKETING_STYLE"]).optional(),
  outlineFrame: z.enum(["YES", "NO"]).optional(),
  allowCtas: z.enum(["YES", "NO"]).optional(),
  postingFrequencyPreference: z.enum(["DAILY", "WEEKLY_3", "WEEKLY_5", "WEEKLY_7", "FORTNIGHTLY"]).optional(),
  postingTimePreference: z.array(z.enum(["MORNING", "AFTERNOON", "EVENING", "NIGHT"])).optional(),
});

router.post("/full-management/draft", onboardingLimiter, async (req, res) => {
  const userId = req.user!.id;

  try {
    const planCategory = await getUserPlanCategory(userId);
    const isFullPlan =
      planCategory === "FULL_MANAGEMENT" ||
      planCategory === "JEWELRY_FULL_MANAGEMENT";
    if (!isFullPlan) {
      return res.status(403).json(
        errorResponse(
          "Full Management onboarding is only available for Full Management plans. Please select a Full Management plan to continue."
        )
      );
    }

    const parsed = fullManagementOnboardingDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(errorResponse("Invalid request data", parsed.error.flatten()));
    }

    const data = parsed.data;
    if (data.logoStorageKey) {
      try {
        sanitizeStorageKey(data.logoStorageKey);
      } catch (error) {
        return res.status(400).json(
          errorResponse(
            error instanceof Error ? error.message : "Invalid storage key format"
          )
        );
      }
    }

    const existingProfile = await prisma.brandProfile.findUnique({
      where: { userId },
      select: { fullManagementOnboardingData: true },
    });

    const existingData =
      (existingProfile?.fullManagementOnboardingData as Record<string, unknown>) || {};

    const merged = {
      ...existingData,
      ...data,
      draftSavedAt: new Date().toISOString(),
    };

    await prisma.brandProfile.upsert({
      where: { userId },
      update: { fullManagementOnboardingData: merged },
      create: { userId, fullManagementOnboardingData: merged },
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error saving full management onboarding draft", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(errorResponse("Failed to save draft. Please try again."));
  }
});

router.post("/full-management", onboardingLimiter, async (req, res) => {
  const userId = req.user!.id;

  try {
    // Verify user has a Full Management plan (regular or jewelry)
    const planCategory = await getUserPlanCategory(userId);
    const isFullPlan =
      planCategory === "FULL_MANAGEMENT" ||
      planCategory === "JEWELRY_FULL_MANAGEMENT";
    if (!isFullPlan) {
      return res.status(403).json(
        errorResponse(
          "Full Management onboarding is only available for Full Management plans. Please select a Full Management plan to continue."
        )
      );
    }

    const parsed = fullManagementOnboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          errorResponse("Invalid request data", parsed.error.flatten())
        );
    }

    const data = parsed.data;

    if (data.logoStorageKey) {
      try {
        sanitizeStorageKey(data.logoStorageKey);
      } catch (error) {
        return res.status(400).json(
          errorResponse(
            error instanceof Error ? error.message : "Invalid storage key format"
          )
        );
      }

      const logoValidation = await validateLogoFile(userId, data.logoStorageKey);
      if (!logoValidation.valid) {
        return res.status(400).json(errorResponse(logoValidation.error!));
      }
    }

    // Wrap all operations in a transaction
    await prisma.$transaction(async (tx) => {
      // Update user profile
      await tx.userProfile.upsert({
        where: { userId },
        update: {
          businessName: data.businessName,
          website: data.websiteUrl,
        },
        create: {
          userId,
          fullName: data.businessName,
          businessName: data.businessName,
          website: data.websiteUrl,
        },
      });

      // Build shared brand profile data
      const brandProfileData = buildFullManagementOnboardingBrandProfileData({
        businessName: data.businessName,
        websiteUrl: data.websiteUrl,
        instagramUrl: data.instagramUrl,
        facebookUrl: data.facebookUrl,
        linkedinUrl: data.linkedinUrl,
        platformsToManage: data.platformsToManage,
        postingAccessGranted: data.postingAccessGranted,
        industry: data.industry,
        industryOther: data.industryOther,
        targetAudience: data.targetAudience,
        salesModel: data.salesModel,
        logoStorageKey: data.logoStorageKey,
        brandPersonality: data.brandPersonality,
        toneToAvoid: data.toneToAvoid,
        imageUsagePermission: data.imageUsagePermission,
        visualStylePreference: data.visualStylePreference,
        outlineFrame: data.outlineFrame,
        allowCtas: data.allowCtas,
        postingFrequencyPreference: data.postingFrequencyPreference,
        postingTimePreference: data.postingTimePreference,
      });

      // Save onboarding data
      await tx.brandProfile.upsert({
        where: { userId },
        update: brandProfileData,
        create: {
          userId,
          ...brandProfileData,
        },
      });

      // Mark full management onboarding as completed
      await tx.user.update({
        where: { id: userId },
        data: {
          fullManagementOnboardingCompleted: true,
          onboardingCompleted: true,
        },
      });
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error("Error in full management onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to save full management onboarding. Please try again."
        )
      );
  }
});

router.get("/full-management", async (req, res) => {
  const userId = req.user!.id;

  try {
    const [profile, userProfile, user] = await Promise.all([
      prisma.brandProfile.findUnique({ where: { userId } }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    return res.json({
      data: profile?.fullManagementOnboardingData || null,
      businessName: userProfile?.businessName || null,
      completed: user?.fullManagementOnboardingCompleted || false,
    });
  } catch (error) {
    logger.error("Error fetching full management onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to fetch full management onboarding data. Please try again."
        )
      );
  }
});

// Legacy endpoint for backward compatibility
router.post("/complete", onboardingLimiter, async (req, res) => {
  const userId = req.user!.id;

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true },
    });

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isFounder: user.isFounder,
        emailVerified: user.emailVerified,
        onboardingCompleted: user.onboardingCompleted,
      },
    });
  } catch (error) {
    logger.error("Error completing onboarding", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json(
        errorResponse(
          "Failed to complete onboarding. Please try again."
        )
      );
  }
});

export { router as onboardingRouter };

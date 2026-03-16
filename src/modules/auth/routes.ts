import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { Role, UserStatus } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { hashPassword, comparePassword } from "../../utils/password";
import { signAccessToken } from "../../utils/tokens";
import { requireAuth } from "../../middleware/requireAuth";
import { env } from "../../config/env";
import { sendVerificationEmail } from "./email";
import { logger } from "../../lib/logger";
import type { PlanCategory } from "../../types/plan-category";
import { ensureUserProviderRoutingConfig } from "../social/provider-routing";
import { getActiveSubscription } from "../billing/subscription-service";

const router = express.Router();

const noopLimiter: express.RequestHandler = (_req, _res, next) => next();
const authLimiter =
  env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: "Too many login attempts, please try again later.",
        skipSuccessfulRequests: true,
      })
    : noopLimiter;

const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      `${env.FRONTEND_URL ?? ""}/api/auth/google/callback`
    )
  : null;
const PASSWORD_RESET_EXPIRY_MS = 1000 * 60 * 60; // 1 hour
const EMAIL_VERIFICATION_EXPIRY_MS = 1000 * 60 * 60 * 24; // 24 hours

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  pendingPlanCode: z.string().optional(), // Optional plan code selected before signup
});

router.post("/signup", authLimiter, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email, password, pendingPlanCode } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  // Require plan selection - no default plan
  if (!pendingPlanCode) {
    logger.warn("No pendingPlanCode provided during signup", { email });
    return res.status(400).json({ 
      error: "Please select a plan to continue.",
      details: "No plan selected",
    });
  }

  // Validate that the pending plan exists
  const pendingPlan = await prisma.plan.findUnique({ where: { code: pendingPlanCode } });
  if (!pendingPlan) {
    logger.warn("Invalid plan code provided during signup", {
      email,
      pendingPlanCode,
    });
    return res.status(400).json({ 
      error: "The selected plan is no longer available. Please select a different plan.",
      details: "Invalid plan code",
    });
  }

  logger.info("Creating user with pendingPlanCode", { pendingPlanCode, email, planCategory: pendingPlan.category });

  const passwordHash = await hashPassword(password);
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "USER",
      emailVerified: false,
      pendingPlanCode: pendingPlanCode,
      pendingPlanCodeSetAt: pendingPlanCode ? new Date() : null,
      emailVerifications: {
        create: {
          token: verificationToken,
          expiresAt,
        },
      },
      // No default subscription - user must complete checkout first
    },
  });
  await ensureUserProviderRoutingConfig(user.id);

  await sendVerificationEmail(email, verificationToken, pendingPlanCode);

  // Do not issue session until email verified.
  return res.status(201).json({
    message: "Account created. Check your email to verify.",
    requiresVerification: true,
  });
});

router.post("/login", authLimiter, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.status === "BLOCKED") {
    return res.status(403).json({ error: "Account is blocked" });
  }
  if (user.status === "DELETED") {
    return res.status(403).json({ error: "Account is deleted" });
  }

  if (!user.emailVerified) {
    return res.status(403).json({ error: "Email not verified" });
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  issueSession(res, user);
  return res.json(safeUser(user));
});

router.post("/admin/login", authLimiter, async (req, res) => {
  await ensureSeedAdmin();

  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }

  if (user.status === "BLOCKED") {
    return res.status(403).json({ error: "Account is blocked" });
  }
  if (user.status === "DELETED") {
    return res.status(403).json({ error: "Account is deleted" });
  }

  if (!user.emailVerified) {
    return res.status(403).json({ error: "Email not verified" });
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  issueSession(res, user);
  return res.json(safeUser(user));
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.json({ success: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: {
        select: {
          fullName: true,
          avatarStorageKey: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  
  // Use the subscription service helper to get the active subscription
  // This ensures consistency with billing summary and handles edge cases
  const subscription = await getActiveSubscription(userId);
  
  // Check for INCOMPLETE subscriptions if no active one found
  let finalSubscription = subscription;
  if (!subscription) {
    const incompleteSub = await prisma.subscription.findFirst({
      where: { userId },
      include: { plan: true },
      orderBy: { updatedAt: "desc" },
    });
    finalSubscription = incompleteSub;
  }
  
  // Determine plan category: from subscription, or from pendingPlanCode if no subscription
  let planCategory: PlanCategory | null = (finalSubscription?.plan?.category as PlanCategory) || null;
  let planResolutionPath: "from_subscription" | "from_pending_plan_code" | "unknown" = "unknown";
  
  // Only query for pendingPlan if we don't have a subscription and user has pendingPlanCode
  if (!planCategory && user.pendingPlanCode) {
    // No active subscription, but user has pendingPlanCode - resolve plan from it
    try {
      const pendingPlan = await prisma.plan.findUnique({
        where: { code: user.pendingPlanCode },
      });
      if (pendingPlan) {
        planCategory = pendingPlan.category as PlanCategory;
        planResolutionPath = "from_pending_plan_code";
        logger.info("Plan resolved from pendingPlanCode", {
          userId,
          pendingPlanCode: user.pendingPlanCode,
          planCategory,
          planCode: pendingPlan.code,
          planName: pendingPlan.name,
        });
      } else {
        // Plan not found - log warning and clear invalid pendingPlanCode
        logger.warn("Invalid pendingPlanCode found - plan does not exist", {
          userId,
          pendingPlanCode: user.pendingPlanCode,
        });
        // Clear invalid pendingPlanCode to prevent stuck state (fire-and-forget)
        prisma.user.update({
          where: { id: userId },
          data: { pendingPlanCode: null },
        }).catch((err) => {
          logger.error("Failed to clear invalid pendingPlanCode", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (error) {
      logger.error("Error looking up pendingPlanCode", {
        userId,
        pendingPlanCode: user.pendingPlanCode,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without planCategory - user will be redirected to pricing
    }
  } else if (planCategory) {
    planResolutionPath = "from_subscription";
    logger.info("Plan resolved from subscription", {
      userId,
      planCategory,
      subscriptionStatus: finalSubscription?.status,
      planCode: finalSubscription?.planCode,
    });
  }

  // Log final plan resolution for debugging
  logger.info("Plan resolution complete", {
    userId,
    planCategory,
    planResolutionPath,
    hasActiveSubscription: !!finalSubscription && (finalSubscription.status === "ACTIVE" || finalSubscription.status === "TRIALING"),
    subscriptionStatus: finalSubscription?.status,
    hasPendingPlanCode: !!user.pendingPlanCode,
  });
  
  // Build subscription object: use actual subscription if exists, otherwise use pendingPlanCode
  const subscriptionObj = finalSubscription
    ? {
        planCode: finalSubscription.planCode,
        planCategory: (finalSubscription.plan?.category as PlanCategory) || null,
        status: finalSubscription.status,
        priceType: finalSubscription.priceType,
      }
    : planCategory
      ? {
          planCode: user.pendingPlanCode || null,
          planCategory: planCategory as PlanCategory,
          status: "INCOMPLETE" as const,
          priceType: "STANDARD" as const,
        }
      : null;

  return res.json({
    ...safeUser(user), // safeUser already includes pendingPlanCode
    subscription: subscriptionObj,
  });
});

// Stubbed for now; integrate email provider later.
router.post("/request-password-reset", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.json({ success: true }); // avoid leaking user existence
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });
    await tx.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    });
  });

  // TODO: send email with token link. For now, return token in non-production.
  if (env.NODE_ENV !== "production") {
    return res.json({ success: true, token, expiresAt });
  }

  return res.json({ success: true });
});

router.post("/reset-password", async (req, res) => {
  const schema = z.object({
    token: z.string(),
    password: z.string().min(8),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { token, password } = parsed.data;
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  if (resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });
  });

  return res.json({ success: true });
});

router.post("/google", async (req, res) => {
  const schema = z.object({
    idToken: z.string(),
    pendingPlanCode: z.string().optional(), // Accept pendingPlanCode from frontend
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (!googleClient || !env.GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: "Google auth not configured" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: parsed.data.idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email || !payload.email_verified) {
      return res.status(400).json({ error: "Invalid Google token" });
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    const pendingPlanCode = parsed.data.pendingPlanCode;

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId }, { email }],
      },
    });

    if (user) {
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId },
        });
      }
    } else {
      // Validate pendingPlanCode if provided
      if (pendingPlanCode) {
        const pendingPlan = await prisma.plan.findUnique({
          where: { code: pendingPlanCode },
        });
        if (!pendingPlan) {
          logger.warn("Invalid pendingPlanCode in Google signup", {
            email,
            pendingPlanCode,
          });
          // Continue without pendingPlanCode rather than failing signup
        }
      }

      user = await prisma.user.create({
        data: {
          email,
          googleId,
          role: "USER",
          passwordHash: null,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          pendingPlanCode: pendingPlanCode || null,
          pendingPlanCodeSetAt: pendingPlanCode ? new Date() : null,
        },
      });
      await ensureUserProviderRoutingConfig(user.id);
    }

    if (user.status === "BLOCKED") {
      return res.status(403).json({ error: "Account is blocked" });
    }
    if (user.status === "DELETED") {
      return res.status(403).json({ error: "Account is deleted" });
    }

    // No default subscription - user must select a plan and complete checkout
    // If user has pendingPlanCode, they will be redirected to checkout after verification
    issueSession(res, user);
    return res.json(safeUser(user));
  } catch (err) {
    logger.error("Google login verification failed", err);
    return res.status(400).json({ error: "Google token verification failed" });
  }
});

router.post("/verify-email", async (req, res) => {
  const schema = z.object({ token: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const token = parsed.data.token;
  const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: true, emailVerifiedAt: new Date() },
  });

  await prisma.emailVerificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  issueSession(res, user);
  return res.json({ success: true, user: safeUser(user) });
});

router.post("/resend-verification", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }
  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerified) {
    return res.json({ success: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, token, expiresAt },
  });
  
  const emailResult = await sendVerificationEmail(email, token, user.pendingPlanCode || undefined);
  if (!emailResult.sent) {
    logger.error("Failed to send verification email", {
      userId: user.id,
      email,
      reason: emailResult.reason,
    });
    return res.status(500).json({ 
      error: "Failed to send verification email. Please try again later.",
      details: emailResult.reason,
    });
  }
  
  return res.json({ success: true });
});

function safeUser(user: {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  isFounder: boolean;
  status: "ACTIVE" | "BLOCKED" | "DELETED";
  emailVerified?: boolean;
  emailVerifiedAt?: Date | null;
  onboardingCompleted?: boolean;
  onboardingStep?: number;
  calendarOnboardingCompleted?: boolean;
  visualOnboardingCompleted?: boolean;
  fullManagementOnboardingCompleted?: boolean;
  pendingPlanCode?: string | null;
  profile?: {
    fullName?: string | null;
    avatarStorageKey?: string | null;
    updatedAt?: Date | null;
  } | null;
}) {
  const avatarStorageKey = user.profile?.avatarStorageKey ?? null;
  const avatarVersion = user.profile?.updatedAt
    ? user.profile.updatedAt.getTime()
    : null;
  const avatarUrl =
    avatarStorageKey && env.STORAGE_BASE_URL
      ? `${env.STORAGE_BASE_URL.replace(/\/+$/, "")}/${avatarStorageKey.replace(/^\/+/, "")}`
      : null;

  return {
    id: user.id,
    name: user.name ?? user.profile?.fullName ?? null,
    email: user.email,
    role: user.role,
    isFounder: user.isFounder,
    status: user.status,
    emailVerified: user.emailVerified ?? true,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    onboardingCompleted: user.onboardingCompleted ?? false,
    onboardingStep: user.onboardingStep ?? 1,
    calendarOnboardingCompleted: user.calendarOnboardingCompleted ?? false,
    visualOnboardingCompleted: user.visualOnboardingCompleted ?? false,
    fullManagementOnboardingCompleted: user.fullManagementOnboardingCompleted ?? false,
    pendingPlanCode: user.pendingPlanCode ?? null,
    avatarStorageKey,
    avatarUrl,
    avatarVersion,
  };
}

function setAuthCookie(res: express.Response, token: string) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}

function issueSession(
  res: express.Response,
  user: { id: string; email: string; role: Role; isFounder: boolean; status: UserStatus }
) {
  const token = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    isFounder: user.isFounder,
    status: user.status,
  });
  setAuthCookie(res, token);
}

let seedAdminPromise: Promise<void> | null = null;
async function ensureSeedAdmin() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  if (seedAdminPromise) return seedAdminPromise;

  const email = env.ADMIN_EMAIL.toLowerCase();
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);

  seedAdminPromise = prisma.user.upsert({
    where: { email },
    update: {
      role: "ADMIN",
      passwordHash,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      onboardingCompleted: true,
    },
    create: {
      email,
      role: "ADMIN",
      passwordHash,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      onboardingCompleted: true,
      isFounder: false,
    },
  }).then(() => undefined);

  return seedAdminPromise;
}

// Google OAuth callback (code exchange)
router.post("/google/callback", async (req, res) => {
  const schema = z.object({
    code: z.string(),
    pendingPlanCode: z.string().optional(),
  });
  
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid code" });
  }

  if (!googleClient) {
    return res.status(500).json({ error: "Google OAuth not configured" });
  }

  try {
    // Exchange code for tokens
    const { tokens } = await googleClient.getToken({
      code: parsed.data.code,
      redirect_uri: `${env.FRONTEND_URL ?? env.APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`
    });

    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.status(400).json({ error: "No email in Google response" });
    }

    const pendingPlanCode = parsed.data.pendingPlanCode;

    // Validate pendingPlanCode if provided
    if (pendingPlanCode) {
      const pendingPlan = await prisma.plan.findUnique({
        where: { code: pendingPlanCode },
      });
      if (!pendingPlan) {
        logger.warn("Invalid pendingPlanCode in Google callback", {
          email: payload.email,
          pendingPlanCode,
        });
        // Continue without pendingPlanCode rather than failing auth
      }
    }

    // Same logic as existing Google route
    let user = await prisma.user.findUnique({ where: { email: payload.email } });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: payload.email,
          googleId: payload.sub,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          pendingPlanCode: pendingPlanCode || null,
          pendingPlanCodeSetAt: pendingPlanCode ? new Date() : null,
        },
      });
      await ensureUserProviderRoutingConfig(user.id);
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: payload.sub,
          emailVerified: true,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          // Only update pendingPlanCode if user doesn't have one and we have one
          ...(pendingPlanCode && !user.pendingPlanCode
            ? { pendingPlanCode, pendingPlanCodeSetAt: new Date() }
            : {}),
        },
      });
    }

    // No default subscription - user must select a plan and complete checkout
    // If user has pendingPlanCode, they will be redirected to checkout after verification

    if (user.status === "BLOCKED") {
      return res.status(403).json({ error: "Account is blocked" });
    }
    if (user.status === "DELETED") {
      return res.status(403).json({ error: "Account is deleted" });
    }

    const token = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      isFounder: user.isFounder,
      status: user.status,
    });

    setAuthCookie(res, token);

    return res.json({
      success: true,
      token,
      onboardingCompleted: user.onboardingCompleted,
    });
  } catch (error) {
    logger.error("Google OAuth callback error", error);
    return res.status(500).json({ error: "Google authentication failed" });
  }
});

export { router as authRouter };

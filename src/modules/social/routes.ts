import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { SocialAccountService } from "./service";
import { SocialOAuthService } from "./oauth";
import { SocialPlatform } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import crypto from "crypto";
import { env } from "../../config/env";
import {
  getEffectiveProviderRoutingConfig,
  isUploadPostEnabledForPlatform,
  ProviderRoutingError,
} from "./provider-routing";
import { UploadPostService } from "../providers/upload-post/service";

const router = express.Router();
const socialService = new SocialAccountService();
const oauthService = new SocialOAuthService();
const uploadPostService = new UploadPostService();

function getSocialBaseUrl() {
  return (env.SOCIAL_REDIRECT_BASE ?? env.APP_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

function getFrontendBaseUrl() {
  return (env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function syncUploadPostConnectionsForUser(
  userId: string,
  routing: Awaited<ReturnType<typeof getEffectiveProviderRoutingConfig>>
) {
  if (routing.mode !== "FORCE_UPLOAD_POST") return;

  const parsed = await uploadPostService.getConnectedPlatforms(userId);
  if (!parsed.confident) return;

  const platforms: SocialPlatform[] = ["INSTAGRAM", "FACEBOOK", "LINKEDIN"];
  for (const platform of platforms) {
    const placeholderExternalId = `upload-post:${platform.toLowerCase()}:${userId}`;
    const enabled = isUploadPostEnabledForPlatform(platform, routing);
    const connected = enabled && parsed.platforms.has(platform);

    if (connected) {
      await prisma.socialAccount.upsert({
        where: {
          userId_platform_externalAccountId: {
            userId,
            platform,
            externalAccountId: placeholderExternalId,
          },
        },
        update: {
          displayName: `Upload-Post ${platform}`,
          updatedAt: new Date(),
        },
        create: {
          userId,
          platform,
          externalAccountId: placeholderExternalId,
          displayName: `Upload-Post ${platform}`,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
        },
      });
      continue;
    }

    await prisma.socialAccount.deleteMany({
      where: {
        userId,
        platform,
        externalAccountId: { startsWith: `upload-post:${platform.toLowerCase()}:` },
      },
    });
  }
}

// Get user's connected social accounts
router.get("/", requireAuth, async (req, res) => {
  try {
    const routing = await getEffectiveProviderRoutingConfig(req.user!.id);
    try {
      await syncUploadPostConnectionsForUser(req.user!.id, routing);
    } catch (syncError) {
      const msg = syncError instanceof Error ? syncError.message : String(syncError);
      logger.warn("Upload-Post connection sync failed while loading social accounts", {
        userId: req.user!.id,
        error: msg,
      });
      res.setHeader("X-Talexia-Upload-Post-Sync", "failed");
      res.setHeader("X-Talexia-Upload-Post-Sync-Error", msg.slice(0, 200));
    }
    const accounts = await socialService.getUserSocialAccounts(req.user!.id);
    return res.json({ accounts });
  } catch (error) {
    logger.error("Error fetching social accounts", error);
    return res.status(500).json({ error: "Failed to fetch social accounts" });
  }
});

// Initiate OAuth connection
router.post("/connect", requireAuth, async (req, res) => {
  const schema = z.object({
    platform: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"]),
  });
  
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid platform", details: parsed.error.flatten() });
  }

  try {
    const { platform } = parsed.data;

    // Check if user can connect this platform (plan limits)
    const canConnect = await socialService.checkPlatformLimit(req.user!.id, platform);
    if (!canConnect) {
      return res.status(403).json({ 
        error: "Platform connection limit reached for your plan" 
      });
    }

    const routing = await getEffectiveProviderRoutingConfig(req.user!.id);
    if (routing.mode === "FORCE_UPLOAD_POST") {
      if (!isUploadPostEnabledForPlatform(platform, routing)) {
        throw new ProviderRoutingError(
          `${platform} is disabled for Upload-Post by admin routing settings.`,
          "ROUTING_MODE_INCOMPATIBLE",
          { platform, mode: routing.mode }
        );
      }
      const state = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await prisma.socialOAuthState.create({
        data: {
          userId: req.user!.id,
          platform,
          state,
          expiresAt,
        },
      });
      const callbackUrl = new URL(`${getSocialBaseUrl()}/social/callback/upload-post`);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("platform", platform.toLowerCase());
      const redirectUrl = callbackUrl.toString();
      const data = await uploadPostService.getConnectUrl(req.user!.id, platform, redirectUrl);
      const url = data?.url || data?.access_url || data?.connect_url || data?.data?.url;
      if (!url) {
        return res.status(500).json({ error: "Upload-Post did not return a connect URL" });
      }
      return res.json({ url });
    }

    const state = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.socialOAuthState.create({
      data: {
        userId: req.user!.id,
        platform,
        state,
        expiresAt,
      },
    });

    // Generate OAuth URL with random state token
    logger.info("Using native OAuth (routing mode is FORCE_NATIVE)", {
      platform,
      userId: req.user!.id,
      routingMode: routing.mode,
      useLinkedin: routing.useLinkedin,
    });
    const authUrl = oauthService.getAuthUrl(platform, state);

    return res.json({ url: authUrl });
  } catch (error) {
    if (error instanceof ProviderRoutingError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Error generating OAuth URL", { error: msg, platform: req.body?.platform, userId: req.user?.id });
    return res.status(500).json({ error: msg || "Failed to generate connection URL" });
  }
});

router.get("/callback/upload-post", async (req, res) => {
  const { state, error, platform } = req.query;
  if (!state) {
    return res.redirect(`${getFrontendBaseUrl()}/dashboard/social?error=missing_params`);
  }

  try {
    const stateValue = String(state);
    const stateRecord = await prisma.socialOAuthState.findUnique({
      where: { state: stateValue },
    });

    if (!stateRecord || stateRecord.expiresAt < new Date()) {
      if (stateRecord) {
        await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } });
      }
      return res.redirect(`${getFrontendBaseUrl()}/dashboard/social?error=state_expired`);
    }

    const resolvedPlatform = stateRecord.platform;
    const routing = await getEffectiveProviderRoutingConfig(stateRecord.userId);
    if (routing.mode !== "FORCE_UPLOAD_POST") {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=routing_mode_incompatible&errorMessage=${encodeURIComponent(
          "Posting channel is locked to Default. Ask an admin to enable Upload-Post."
        )}`
      );
    }
    if (!isUploadPostEnabledForPlatform(resolvedPlatform, routing)) {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=routing_mode_incompatible&errorMessage=${encodeURIComponent(
          `${resolvedPlatform} is disabled for Upload-Post by admin routing settings.`
        )}`
      );
    }

    if (error) {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=${encodeURIComponent(String(error))}`
      );
    }

    let verified = { connected: false, confident: false };
    try {
      verified = await uploadPostService.verifyPlatformConnected(stateRecord.userId, resolvedPlatform);
    } catch (verifyError) {
      logger.warn("Upload-Post platform verification failed after callback", {
        userId: stateRecord.userId,
        platform: resolvedPlatform,
        error: verifyError instanceof Error ? verifyError.message : String(verifyError),
      });
    }

    if (verified.confident && !verified.connected) {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=connection_not_confirmed&errorMessage=${encodeURIComponent(
          `Upload-Post did not report ${resolvedPlatform} as connected yet. Please finish the connection in Upload-Post and try again.`
        )}`
      );
    }

    if (!verified.confident) {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=connection_pending_confirmation&errorMessage=${encodeURIComponent(
          `Talexia could not confirm ${resolvedPlatform} from Upload-Post yet. Please complete the connect flow in Upload-Post and retry.`
        )}`
      );
    }

    const placeholderExternalId = `upload-post:${resolvedPlatform.toLowerCase()}:${stateRecord.userId}`;
    await prisma.socialAccount.upsert({
      where: {
        userId_platform_externalAccountId: {
          userId: stateRecord.userId,
          platform: resolvedPlatform,
          externalAccountId: placeholderExternalId,
        },
      },
      update: {
        displayName: `Upload-Post ${resolvedPlatform}`,
        updatedAt: new Date(),
      },
      create: {
        userId: stateRecord.userId,
        platform: resolvedPlatform,
        externalAccountId: placeholderExternalId,
        displayName: `Upload-Post ${resolvedPlatform}`,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
      },
    });

    await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch((err) => {
      logger.warn("Failed to delete Upload-Post OAuth state record", {
        stateId: stateRecord.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return res.redirect(
      `${getFrontendBaseUrl()}/dashboard/social?success=connected&platform=${String(platform || resolvedPlatform.toLowerCase())}`
    );
  } catch (callbackError) {
    logger.error("Upload-Post callback error", {
      error: callbackError instanceof Error ? callbackError.message : String(callbackError),
      state,
      platform,
    });
    return res.redirect(
      `${getFrontendBaseUrl()}/dashboard/social?error=connection_failed&errorMessage=${encodeURIComponent(
        "Unable to connect Upload-Post account"
      )}`
    );
  }
});

// OAuth callback handlers
router.get("/callback/:platform", async (req, res) => {
  const platformParam = req.params.platform.toUpperCase() as SocialPlatform;
  const { code, state, error } = req.query;

  if (error) {
    logger.warn("Connect platform returned error", { error });
    return res.redirect(`${getFrontendBaseUrl()}/dashboard/social?error=${error}`);
  }

  if (!code || !state) {
    logger.warn("Missing code or state on social callback", { error });
    return res.redirect(`${getFrontendBaseUrl()}/dashboard/social?error=missing_params`);
  }

  try {
    const stateValue = String(state);
    const stateRecord = await prisma.socialOAuthState.findUnique({
      where: { state: stateValue },
    });

    if (!stateRecord || stateRecord.expiresAt < new Date()) {
      if (stateRecord) {
        await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } });
      }
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=state_expired`
      );
    }

    if (stateRecord.platform !== platformParam) {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } });
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=state_mismatch`
      );
    }

    const routing = await getEffectiveProviderRoutingConfig(stateRecord.userId);
    if (routing.mode !== "FORCE_NATIVE") {
      await prisma.socialOAuthState.delete({ where: { id: stateRecord.id } }).catch(() => {});
      return res.redirect(
        `${getFrontendBaseUrl()}/dashboard/social?error=routing_mode_incompatible&errorMessage=${encodeURIComponent(
          "Posting channel is locked to Upload-Post. Use Upload-Post connection flow."
        )}`
      );
    }

    try {
      await socialService.connectAccount(
        stateRecord.userId,
        platformParam,
        code as string
      );
    } finally {
      await prisma.socialOAuthState
        .delete({ where: { id: stateRecord.id } })
        .catch((err) => {
          logger.warn("Failed to delete OAuth state record", {
            stateId: stateRecord.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    return res.redirect(
      `${getFrontendBaseUrl()}/dashboard/social?success=connected&platform=${platformParam.toLowerCase()}`
    );
  } catch (error) {
    logger.error("OAuth callback error", {
      error,
      platform: platformParam,
      userId: state,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    
    let errorMsg = "connection_failed";
    let userFriendlyMsg = "Unable to connect account";
    
    if (error instanceof Error) {
      errorMsg = encodeURIComponent(error.message);
      
      // Provide user-friendly messages for common errors
      if (error.message.includes("Invalid state parameter")) {
        userFriendlyMsg = "Security validation failed. Please try connecting again.";
      } else if (error.message.includes("Platform connection limit")) {
        userFriendlyMsg = "You've reached your plan's platform connection limit. Please upgrade to connect more accounts.";
      } else if (error.message.includes("OAuth token exchange failed")) {
        userFriendlyMsg = "Authentication failed. Please try connecting again.";
      } else if (error.message.includes("Profile fetch failed")) {
        userFriendlyMsg = "Failed to retrieve account information. Please ensure you granted the necessary permissions.";
      } else if (error.message.includes("No Instagram Business account")) {
        userFriendlyMsg = "No Instagram Business account found. Please ensure your Facebook Page has an Instagram Business account connected.";
      } else {
        userFriendlyMsg = error.message;
      }
    }
    
    return res.redirect(
      `${getFrontendBaseUrl()}/dashboard/social?error=connection_failed&errorMessage=${encodeURIComponent(userFriendlyMsg)}`
    );
  }
});

// Disconnect social account
router.post("/disconnect", requireAuth, async (req, res) => {
  const schema = z.object({
    socialAccountId: z.string(),
  });
  
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  try {
    await socialService.disconnectAccount(req.user!.id, parsed.data.socialAccountId);
    return res.json({ success: true });
  } catch (error) {
    logger.error("Error disconnecting account", error);
    return res.status(500).json({ error: "Failed to disconnect account" });
  }
});

// Refresh token endpoint (for manual refresh)
router.post("/refresh/:socialAccountId", requireAuth, async (req, res) => {
  try {
    const account = await socialService.refreshTokenIfNeeded(req.params.socialAccountId);
    if (!account) {
      return res.status(404).json({ error: "Social account not found" });
    }
    
    return res.json({ success: true, expiresAt: account.expiresAt });
  } catch (error) {
    logger.error("Error refreshing token", error);
    return res.status(500).json({ error: "Failed to refresh token" });
  }
});

export { router as socialRouter };

import { SocialPlatform } from "@prisma/client";
import { SocialOAuthService } from "./oauth";
import { logger } from "../../lib/logger";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";

const oauthService = new SocialOAuthService();

export class SocialAccountService {
  async getUserSocialAccounts(userId: string) {
    return prisma.socialAccount.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        displayName: true,
        externalAccountId: true,
        createdAt: true,
        expiresAt: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async checkPlatformLimit(userId: string, platform: SocialPlatform): Promise<boolean> {
    // Get user's subscription and plan limits
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          where: { status: { in: ["ACTIVE", "TRIALING"] } },
          include: { plan: true },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!user?.subscriptions?.[0]?.plan) {
      return false; // No active subscription
    }

    const subscription = user.subscriptions[0];
    const plan = subscription.plan;
    const platformLimit =
      plan.platformLimit !== null && plan.platformLimit !== undefined
        ? plan.platformLimit + (subscription.addonPlatformQty ?? 0)
        : null;

    if (!platformLimit) {
      return true; // No limit
    }

    // Count existing connected accounts
    const connectedCount = await prisma.socialAccount.count({
      where: { userId }
    });

    return connectedCount < platformLimit;
  }

  async connectAccount(
    userId: string, 
    platform: SocialPlatform, 
    code: string
  ) {
    // Check platform limits
    const canConnect = await this.checkPlatformLimit(userId, platform);
    if (!canConnect) {
      throw new Error("Platform connection limit reached for your plan");
    }

    // Exchange code for tokens
    const tokens = await oauthService.exchangeCodeForTokens(platform, code);
    
    // Get profile info
    const profile = await oauthService.getProfile(platform, tokens.accessToken);
    // Prefer page access tokens when available
    const effectiveAccessToken = profile.pageAccessToken || tokens.accessToken;

    // Check if account already connected
    const existing = await prisma.socialAccount.findUnique({
      where: {
        userId_platform_externalAccountId: {
          userId,
          platform,
          externalAccountId: profile.id
        }
      }
    });

    if (existing) {
      // Update existing account
      return prisma.socialAccount.update({
        where: { id: existing.id },
        data: {
          accessToken: effectiveAccessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          displayName: profile.name,
          updatedAt: new Date()
        }
      });
    }

    // Create new account
    return prisma.socialAccount.create({
      data: {
        userId,
        platform,
        externalAccountId: profile.id,
        displayName: profile.name,
        accessToken: effectiveAccessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      }
    });
  }

  async disconnectAccount(userId: string, socialAccountId: string) {
    const account = await prisma.socialAccount.findFirst({
      where: { id: socialAccountId, userId }
    });

    if (!account) {
      throw new Error("Social account not found");
    }

    // Delete the account
    await prisma.socialAccount.delete({
      where: { id: socialAccountId }
    });

    return { success: true };
  }

  async refreshTokenIfNeeded(socialAccountId: string) {
    const account = await prisma.socialAccount.findUnique({
      where: { id: socialAccountId }
    });

    if (!account || !account.refreshToken) {
      return account;
    }

    // Check if token expires within 1 hour
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (!account.expiresAt || account.expiresAt > oneHourFromNow) {
      return account; // Token still valid
    }

    try {
      const newTokens = await oauthService.refreshAccessToken(
        account.platform, 
        account.refreshToken
      );

      return prisma.socialAccount.update({
        where: { id: socialAccountId },
        data: {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken || account.refreshToken,
          expiresAt: newTokens.expiresAt,
          updatedAt: new Date()
        }
      });
    } catch (error) {
      logger.error("Token refresh failed", error);
      return account; // Return original account, let caller handle
    }
  }

  async getValidAccessToken(socialAccountId: string): Promise<string | null> {
    const account = await this.refreshTokenIfNeeded(socialAccountId);
    return account?.accessToken || null;
  }

  async getPageAccessTokenForFacebook(
    socialAccountId: string,
    pageId: string
  ): Promise<string | null> {
    const account = await this.refreshTokenIfNeeded(socialAccountId);
    if (!account || account.platform !== "FACEBOOK") {
      return null;
    }

    const userToken = account.accessToken;
    if (!userToken) {
      return null;
    }

    const appSecret = process.env.META_APP_SECRET || "";
    const appSecretProof = appSecret
      ? crypto.createHmac("sha256", appSecret).update(userToken).digest("hex")
      : null;

    // Try to get Page access token from user's pages
    const pagesUrl = new URL("https://graph.facebook.com/v18.0/me/accounts");
    pagesUrl.searchParams.set("access_token", userToken);
    pagesUrl.searchParams.set("fields", "id,name,access_token");
    if (appSecretProof) {
      pagesUrl.searchParams.set("appsecret_proof", appSecretProof);
    }

    try {
      const response = await fetch(pagesUrl.toString());
      if (!response.ok) {
        logger.warn("Failed to fetch Facebook pages", {
          status: response.status,
          socialAccountId,
          pageId,
        });
        return userToken; // Fallback to user token
      }

      const data = await response.json() as any;
      const page = data?.data?.find((p: any) => p.id === pageId);
      
      if (page?.access_token) {
        logger.info("Using Page access token for Facebook publish", {
          socialAccountId,
          pageId,
          pageName: page.name,
        });
        return page.access_token;
      }

      logger.warn("Page access token not found, using user token", {
        socialAccountId,
        pageId,
        availablePages: data?.data?.map((p: any) => p.id) || [],
      });
      return userToken; // Fallback to user token
    } catch (error) {
      logger.error("Error fetching Page access token", {
        error: error instanceof Error ? error.message : "Unknown error",
        socialAccountId,
        pageId,
      });
      return userToken; // Fallback to user token
    }
  }
}

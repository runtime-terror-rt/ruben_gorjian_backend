import { SocialPlatform } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import crypto from "crypto";

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

interface SocialProfile {
  id: string;
  name: string;
  username?: string;
  pageAccessToken?: string;
}

export class SocialOAuthService {
  private configs: Record<SocialPlatform, OAuthConfig>;
  private baseUrl: string;
  private metaAppSecret: string;
  private instagramAppSecret: string;

  constructor() {
    // Use explicit SOCIAL_REDIRECT_BASE if provided; otherwise APP_URL (backend origin) or localhost
    this.baseUrl = (env.SOCIAL_REDIRECT_BASE ?? env.APP_URL ?? "http://localhost:4000").replace(/\/$/, "");
    this.metaAppSecret = process.env.META_APP_SECRET || "";
    // Instagram Business uses the Meta app credentials; do not use Basic Display app IDs here
    this.instagramAppSecret = this.metaAppSecret;
    this.configs = {
      INSTAGRAM: {
        clientId: process.env.META_APP_ID || "",
        clientSecret: process.env.META_APP_SECRET || "",
        redirectUri: `${this.baseUrl}/social/callback/instagram`,
        scopes: ["instagram_basic", "pages_show_list", "instagram_content_publish"]
      },
      FACEBOOK: {
        clientId: process.env.META_APP_ID || "",
        clientSecret: process.env.META_APP_SECRET || "",
        redirectUri: `${this.baseUrl}/social/callback/facebook`,
        scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"]
      },
      LINKEDIN: {
        clientId: process.env.LINKEDIN_CLIENT_ID || "",
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
        redirectUri: `${this.baseUrl}/social/callback/linkedin`,
        // r_liteprofile was retired Dec 2022. LinkedIn now uses OpenID Connect.
        // openid + profile + email replace r_liteprofile + r_emailaddress.
        // w_member_social remains required for posting on behalf of members.
        scopes: ["openid", "profile", "email", "w_member_social"]
      }
    };
    
  }

  getAuthUrl(platform: SocialPlatform, state: string): string {
    const config = this.configs[platform];
    
    // Log the redirect URI for debugging (especially in production)
    logger.info("Generating OAuth URL", {
      platform,
      redirectUri: config.redirectUri,
      baseUrl: this.baseUrl,
      hasClientId: !!config.clientId,
    });
    
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(" "),
      response_type: "code",
      state
    });

    const baseUrls = {
      // Instagram Business uses Meta OAuth dialog
      INSTAGRAM: "https://www.facebook.com/v18.0/dialog/oauth",
      FACEBOOK: "https://www.facebook.com/v18.0/dialog/oauth",
      LINKEDIN: "https://www.linkedin.com/oauth/v2/authorization"
    };

    return `${baseUrls[platform]}?${params.toString()}`;
  }

  async exchangeCodeForTokens(platform: SocialPlatform, code: string): Promise<OAuthTokens> {
    const config = this.configs[platform];
    
    const tokenUrls = {
      // Use Meta token endpoint for both Instagram (business) and Facebook
      INSTAGRAM: "https://graph.facebook.com/v18.0/oauth/access_token",
      FACEBOOK: "https://graph.facebook.com/v18.0/oauth/access_token",
      LINKEDIN: "https://www.linkedin.com/oauth/v2/accessToken"
    };

    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: "authorization_code"
    });

    const response = await fetch(tokenUrls[platform], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage = `OAuth token exchange failed: ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorBody);
        if (errorData.error_description) {
          errorMessage = `OAuth error: ${errorData.error_description}`;
        } else if (errorData.error) {
          errorMessage = `OAuth error: ${errorData.error}`;
        }
      } catch {
        // If parsing fails, use the text body if available
        if (errorBody) {
          errorMessage = `OAuth error: ${errorBody}`;
        }
      }
      
      logger.error("OAuth token exchange failed", {
        platform,
        status: response.status,
        statusText: response.statusText,
        errorBody,
      });
      
      throw new Error(errorMessage);
    }

    const data = await response.json() as any;
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined
    };
  }

  private getAppSecretProof(platform: SocialPlatform, accessToken: string) {
    const secret =
      platform === "INSTAGRAM"
        ? this.instagramAppSecret
        : platform === "FACEBOOK"
          ? this.metaAppSecret
          : "";

    if (!secret) {
      throw new Error("App secret is not configured for this platform");
    }

    return crypto.createHmac("sha256", secret).update(accessToken).digest("hex");
  }

  async getProfile(platform: SocialPlatform, accessToken: string): Promise<SocialProfile> {
    const profileUrls = {
      INSTAGRAM: "https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account{username,id}",
      FACEBOOK: "https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token",
      LINKEDIN: "https://api.linkedin.com/v2/userinfo"
    };
    const appSecretProof =
      platform === "FACEBOOK" || platform === "INSTAGRAM"
        ? this.getAppSecretProof(platform, accessToken)
        : null;

    const url = new URL(profileUrls[platform]);
    if (appSecretProof) {
      url.searchParams.set("appsecret_proof", appSecretProof);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Profile fetch failed: ${response.statusText}${body ? ` - ${body}` : ""}`);
    }

    const data = await response.json() as any;

    switch (platform) {
      case "INSTAGRAM":
        // Expect a Facebook Page with an attached instagram_business_account
        const igPage = data?.data?.find((page: any) => page.instagram_business_account);
        const igBiz = igPage?.instagram_business_account;
        if (!igBiz?.id) {
          throw new Error("No Instagram Business account found on connected pages");
        }
        return {
          id: igBiz.id,
          name: igBiz.username || igPage?.name || "Instagram Account",
          username: igBiz.username,
          pageAccessToken: igPage?.access_token
        };
      case "FACEBOOK":
        // Return first page when available; otherwise fall back to basic profile
        if (data?.data?.length) {
          const page = data.data[0];
          return {
            id: page?.id,
            name: page?.name || "Facebook Page",
            pageAccessToken: page?.access_token,
          };
        }

        const fallbackUrl = new URL("https://graph.facebook.com/v18.0/me?fields=id,name");
        if (appSecretProof) {
          fallbackUrl.searchParams.set("appsecret_proof", appSecretProof);
        }
        const fallbackRes = await fetch(fallbackUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!fallbackRes.ok) {
          const body = await fallbackRes.text().catch(() => "");
          throw new Error(`Facebook profile fetch failed: ${fallbackRes.statusText}${body ? ` - ${body}` : ""}`);
        }

        const fallbackData = await fallbackRes.json() as any;
        return { id: fallbackData.id, name: fallbackData.name || "Facebook User" };
      case "LINKEDIN":
        return {
          id: data.sub,
          name: data.name || `${data.given_name || ""} ${data.family_name || ""}`.trim() || "LinkedIn User",
        };
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  async refreshAccessToken(platform: SocialPlatform, refreshToken: string): Promise<OAuthTokens> {
    if (platform === "INSTAGRAM") {
      // Instagram uses long-lived tokens, refresh differently
      const response = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refreshToken}`
      );
      const data = await response.json() as any;
      return {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000)
      };
    }

    // Facebook and LinkedIn standard refresh
    const config = this.configs[platform];
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });

    const tokenUrls = {
      FACEBOOK: "https://graph.facebook.com/v18.0/oauth/access_token",
      LINKEDIN: "https://www.linkedin.com/oauth/v2/accessToken"
    };

    const response = await fetch(tokenUrls[platform], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    const data = await response.json() as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined
    };
  }
}

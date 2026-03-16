import { ExternalIdentifierType, ExternalJobStatus, PostTargetStatus, Prisma, PublishingProvider, SocialPlatform } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { logger } from "../../../lib/logger";
import { UploadPostClient } from "./client";
import { env } from "../../../config/env";

const client = new UploadPostClient();
let missingExternalPublishJobTableWarned = false;

function mapUploadPostStatus(status: string): ExternalJobStatus {
  const normalized = status.toLowerCase();
  // Upload-Post status API returns "completed" for done async uploads; sync responses may use "posted"
  if (normalized === "posted" || normalized === "completed") return "COMPLETED";
  if (normalized === "failed" || normalized === "partially_posted") return "FAILED";
  if (normalized === "scheduled" || normalized === "processing" || normalized === "in_progress") return "IN_PROGRESS";
  return "PENDING";
}

function nextPollDate(attemptCount: number) {
  const delayMs = Math.min(60_000, Math.max(8_000, attemptCount * 5_000));
  return new Date(Date.now() + delayMs);
}

function isMissingExternalPublishJobTableError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021") return false;
  const message = String(error.message || "");
  return message.includes("ExternalPublishJob");
}

export class UploadPostService {
  private buildUsername(userId: string) {
    return `talexia_${userId.replace(/[^a-zA-Z0-9_]/g, "")}`.slice(0, 40);
  }

  async ensureProfile(userId: string) {
    const existing = await prisma.uploadPostProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    const username = this.buildUsername(userId);
    await client.ensureProfile(username);
    return prisma.uploadPostProfile.upsert({
      where: { userId },
      update: { lastSyncAt: new Date() },
      create: { userId, username, lastSyncAt: new Date() },
    });
  }

  async getConnectUrl(userId: string, platform: SocialPlatform, redirectUrl: string) {
    const profile = await this.ensureProfile(userId);
    const options: Parameters<typeof client.getConnectUrl>[3] = {};
    if (env.UPLOAD_POST_CONNECT_LOGO_URL) options.logo_image = env.UPLOAD_POST_CONNECT_LOGO_URL;
    if (env.UPLOAD_POST_CONNECT_TITLE) options.connect_title = env.UPLOAD_POST_CONNECT_TITLE;
    if (env.UPLOAD_POST_CONNECT_DESCRIPTION) options.connect_description = env.UPLOAD_POST_CONNECT_DESCRIPTION;
    if (env.UPLOAD_POST_REDIRECT_BUTTON_TEXT) options.redirect_button_text = env.UPLOAD_POST_REDIRECT_BUTTON_TEXT;
    return client.getConnectUrl(profile.username, platform, redirectUrl, Object.keys(options).length > 0 ? options : undefined);
  }

  private normalizePlatformValue(value: string): SocialPlatform | null {
    const normalized = value.trim().toUpperCase();
    if (normalized === "INSTAGRAM") return "INSTAGRAM";
    if (normalized === "FACEBOOK") return "FACEBOOK";
    if (normalized === "LINKEDIN") return "LINKEDIN";
    return null;
  }

  /**
   * Parses Upload-Post API response for connected platforms.
   * Supports the documented shape: GET /api/uploadposts/users/{username} returns
   * { success, profile: { social_accounts: { instagram: {...}|null, facebook: {...}|null, ... } } }.
   * See https://docs.upload-post.com/api/user-profiles/
   */
  private extractConnectedPlatforms(payload: any): { platforms: Set<SocialPlatform>; confident: boolean } {
    const connected = new Set<SocialPlatform>();
    let confident = false;

    // Documented shape: profile.social_accounts is an object; key = platform (lowercase), value = details object when connected, null or "" when not
    const socialAccounts =
      payload?.profile?.social_accounts ?? payload?.social_accounts ?? payload?.data?.profile?.social_accounts;
    if (socialAccounts && typeof socialAccounts === "object" && !Array.isArray(socialAccounts)) {
      confident = true;
      for (const [key, value] of Object.entries(socialAccounts)) {
        const platform = this.normalizePlatformValue(String(key));
        if (!platform) continue;
        // Connected when value is a non-empty object (has display_name, username, etc.); null or "" = not connected
        const isConnected =
          value !== null &&
          value !== "" &&
          typeof value === "object" &&
          Object.keys(value).length > 0;
        if (isConnected) {
          connected.add(platform);
        }
      }
      if (connected.size > 0 || Object.keys(socialAccounts).length > 0) {
        return { platforms: connected, confident };
      }
    }

    // Fallback: array-based shapes (platforms, connections, channels, etc.)
    const candidates: any[] = [];
    const pushIfArray = (value: any) => {
      if (Array.isArray(value)) candidates.push(...value);
    };
    pushIfArray(payload?.platforms);
    pushIfArray(payload?.data?.platforms);
    pushIfArray(payload?.user?.platforms);
    pushIfArray(payload?.data?.user?.platforms);
    pushIfArray(payload?.connections);
    pushIfArray(payload?.data?.connections);
    pushIfArray(payload?.channels);
    pushIfArray(payload?.data?.channels);

    for (const item of candidates) {
      if (typeof item === "string") {
        const platform = this.normalizePlatformValue(item);
        if (platform) {
          connected.add(platform);
          confident = true;
        }
        continue;
      }

      if (!item || typeof item !== "object") continue;
      const platformRaw =
        item.platform ?? item.name ?? item.channel ?? item.type ?? item.provider ?? item.network;
      if (typeof platformRaw !== "string") continue;
      const platform = this.normalizePlatformValue(platformRaw);
      if (!platform) continue;

      const statusRaw = String(item.status ?? item.state ?? "").toLowerCase();
      const isConnected =
        item.connected === true ||
        item.is_connected === true ||
        statusRaw === "connected" ||
        statusRaw === "active" ||
        statusRaw === "enabled" ||
        statusRaw === "ok";

      confident = true;
      if (isConnected) {
        connected.add(platform);
      }
    }

    return { platforms: connected, confident };
  }

  async verifyPlatformConnected(userId: string, platform: SocialPlatform) {
    const parsed = await this.getConnectedPlatforms(userId);
    if (!parsed.confident) {
      return { connected: false, confident: false };
    }
    return { connected: parsed.platforms.has(platform), confident: true };
  }

  async getConnectedPlatforms(userId: string): Promise<{ platforms: Set<SocialPlatform>; confident: boolean }> {
    const profile = await this.ensureProfile(userId);
    const remoteProfile = await client.getUserProfile(profile.username);
    await prisma.uploadPostProfile.update({
      where: { userId },
      data: {
        remoteStatusJson: remoteProfile as Prisma.InputJsonValue,
        lastSyncAt: new Date(),
      },
    });
    const parsed = this.extractConnectedPlatforms(remoteProfile);
    if (!parsed.confident && remoteProfile && typeof remoteProfile === "object" && !Array.isArray(remoteProfile)) {
      logger.info("Upload-Post profile response shape may not match parser; no platforms parsed", {
        userId,
        topLevelKeys: Object.keys(remoteProfile),
      });
    }
    return parsed;
  }

  async publishForTarget(params: {
    postTargetId: string;
    userId: string;
    platform: SocialPlatform;
    caption: string;
    mediaUrls: Array<{ url: string; type: "image" | "video" }>;
  }) {
    const profile = await this.ensureProfile(params.userId);
    const result = await client.publish({
      username: profile.username,
      platform: params.platform,
      text: params.caption,
      mediaUrls: params.mediaUrls,
    });
    const mappedStatus = mapUploadPostStatus(result.status);

    await prisma.externalPublishJob.upsert({
      where: {
        provider_identifierType_remoteJobId: {
          provider: PublishingProvider.UPLOAD_POST,
          identifierType: result.identifierType as ExternalIdentifierType,
          remoteJobId: result.identifier,
        },
      },
      update: {
        postTargetId: params.postTargetId,
        identifierType: result.identifierType as ExternalIdentifierType,
        remoteStatus: mappedStatus,
        lastMessage: result.message,
        rawLastResponse: result.raw as any,
        lastSyncedAt: new Date(),
        attemptCount: 0,
        nextPollAt: mappedStatus === "COMPLETED" || mappedStatus === "FAILED" ? null : nextPollDate(1),
      },
      create: {
        postTargetId: params.postTargetId,
        provider: PublishingProvider.UPLOAD_POST,
        remoteJobId: result.identifier,
        identifierType: result.identifierType as ExternalIdentifierType,
        remoteStatus: mappedStatus,
        lastMessage: result.message,
        rawLastResponse: result.raw as any,
        lastSyncedAt: new Date(),
        attemptCount: 0,
        nextPollAt: mappedStatus === "COMPLETED" || mappedStatus === "FAILED" ? null : nextPollDate(1),
      },
    });

    return result;
  }

  async reconcilePendingJobs(limit = 50) {
    let jobs: Awaited<ReturnType<typeof prisma.externalPublishJob.findMany>>;
    try {
      jobs = await prisma.externalPublishJob.findMany({
        where: {
          provider: "UPLOAD_POST",
          remoteStatus: { in: ["PENDING", "IN_PROGRESS"] },
          OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
        },
        include: {
          postTarget: {
            include: { post: true },
          },
        },
        orderBy: { updatedAt: "asc" },
        take: limit,
      });
    } catch (error) {
      if (isMissingExternalPublishJobTableError(error)) {
        if (!missingExternalPublishJobTableWarned) {
          logger.warn("ExternalPublishJob table is missing; skipping Upload-Post reconciliation until migrations are applied");
          missingExternalPublishJobTableWarned = true;
        }
        return;
      }
      throw error;
    }

    for (const job of jobs) {
      try {
        const result = await client.getJobStatus(job.identifierType as any, job.remoteJobId);
        const mapped = mapUploadPostStatus(result.status);
        const nextAttempt = job.attemptCount + 1;
        await prisma.externalPublishJob.update({
          where: { id: job.id },
          data: {
            remoteStatus: mapped,
            lastMessage: result.message,
            rawLastResponse: result.raw as any,
            lastSyncedAt: new Date(),
            attemptCount: nextAttempt,
            nextPollAt: mapped === "COMPLETED" || mapped === "FAILED" ? null : nextPollDate(nextAttempt),
          },
        });

        if (mapped === "COMPLETED" || mapped === "FAILED") {
          await this.applyTerminalStatus(job.postTargetId, mapped === "COMPLETED");
        }
      } catch (error) {
        logger.warn("Upload-Post reconcile failed", {
          jobId: job.id,
          remoteJobId: job.remoteJobId,
          error: error instanceof Error ? error.message : String(error),
        });
        const nextAttempt = job.attemptCount + 1;
        await prisma.externalPublishJob.update({
          where: { id: job.id },
          data: {
            attemptCount: nextAttempt,
            nextPollAt: nextPollDate(nextAttempt),
            lastMessage: error instanceof Error ? error.message : "Polling failed",
            lastSyncedAt: new Date(),
          },
        });
      }
    }
  }

  async processWebhook(payload: any) {
    const jobId = payload?.job_id ? String(payload.job_id) : null;
    const requestId = payload?.request_id ? String(payload.request_id) : null;
    const genericId = payload?.id ? String(payload.id) : null;
    const rawId = jobId || requestId || genericId;
    if (!rawId) return;
    const remoteJobId = String(rawId);
    const mapped = mapUploadPostStatus(String(payload?.status || payload?.post_status || "unknown"));

    let job: Awaited<ReturnType<typeof prisma.externalPublishJob.findUnique>> | null = null;
    if (jobId) {
      job = await prisma.externalPublishJob.findUnique({
        where: {
          provider_identifierType_remoteJobId: {
            provider: "UPLOAD_POST",
            identifierType: "JOB_ID",
            remoteJobId: jobId,
          },
        },
      });
    } else if (requestId) {
      job = await prisma.externalPublishJob.findUnique({
        where: {
          provider_identifierType_remoteJobId: {
            provider: "UPLOAD_POST",
            identifierType: "REQUEST_ID",
            remoteJobId: requestId,
          },
        },
      });
    } else {
      const matches = await prisma.externalPublishJob.findMany({
        where: { provider: "UPLOAD_POST", remoteJobId },
        take: 2,
      });
      if (matches.length > 1) {
        logger.warn("Upload-Post webhook ID is ambiguous across identifier types; skipping update", { remoteJobId });
        return;
      }
      job = matches[0] ?? null;
    }
    if (!job) return;

    await prisma.externalPublishJob.update({
      where: { id: job.id },
      data: {
        remoteStatus: mapped,
        rawLastResponse: payload,
        lastMessage: payload?.message || null,
        lastSyncedAt: new Date(),
        nextPollAt: mapped === "COMPLETED" || mapped === "FAILED" ? null : nextPollDate(job.attemptCount + 1),
      },
    });

    if (mapped === "COMPLETED" || mapped === "FAILED") {
      await this.applyTerminalStatus(job.postTargetId, mapped === "COMPLETED");
    }
  }

  async getHealthStatus() {
    const usingApiKey = Boolean(env.UPLOAD_POST_API_KEY);
    const usingClientCredentials = Boolean(env.UPLOAD_POST_CLIENT_ID && env.UPLOAD_POST_CLIENT_SECRET);
    const authMode = usingApiKey ? "API_KEY" : usingClientCredentials ? "CLIENT_CREDENTIALS" : "UNCONFIGURED";

    if (authMode === "UNCONFIGURED") {
      return {
        ok: false,
        authMode,
        error: "Upload-Post credentials are not configured",
      };
    }

    const remote = await client.getMe();
    return {
      ok: true,
      authMode,
      remote,
    };
  }

  private async applyTerminalStatus(postTargetId: string, success: boolean) {
    const target = await prisma.postTarget.findUnique({
      where: { id: postTargetId },
      include: { post: { include: { targets: true } } },
    });
    if (!target) return;

    await prisma.postTarget.update({
      where: { id: postTargetId },
      data: {
        status: success ? PostTargetStatus.POSTED : PostTargetStatus.FAILED,
        publishedAt: success ? new Date() : undefined,
        errorMessage: success ? null : "Upload-Post reported failed status",
      },
    });

    const refreshed = await prisma.postTarget.findMany({ where: { postId: target.postId } });
    const anyPosted = refreshed.some((t) => t.status === "POSTED");
    const allTerminal = refreshed.every((t) => t.status === "POSTED" || t.status === "FAILED");
    if (allTerminal) {
      await prisma.post.update({
        where: { id: target.postId },
        data: { status: anyPosted ? "POSTED" : "FAILED" },
      });
    }
  }
}

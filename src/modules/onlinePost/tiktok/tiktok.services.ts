// Minimal Nest-like exceptions so the original pasted logic can remain unchanged in Express.

import { ScheduledPostStatus, SocialPlatform, User } from "@prisma/client";
import { ApiError } from "../../../lib/errors";
import { prisma } from "../../../lib/prisma";
import { env } from "../../../config/env";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Express routes should use `handleError()` to convert these into proper HTTP responses.
class BadRequestException extends ApiError {
  constructor(messageOrDetails: unknown) {
    const message =
      typeof messageOrDetails === "string"
        ? messageOrDetails
        : ((messageOrDetails as any)?.message ?? "Bad Request");
    super(
      400,
      message,
      typeof messageOrDetails === "string" ? undefined : messageOrDetails,
    );
    this.name = "BadRequestException";
  }
  getResponse() {
    return this.details ?? { message: this.message };
  }
}

class ForbiddenException extends ApiError {
  constructor(messageOrDetails: unknown) {
    const message =
      typeof messageOrDetails === "string"
        ? messageOrDetails
        : ((messageOrDetails as any)?.message ?? "Forbidden");
    super(
      403,
      message,
      typeof messageOrDetails === "string" ? undefined : messageOrDetails,
    );
    this.name = "ForbiddenException";
  }
}

class NotFoundException extends ApiError {
  constructor(messageOrDetails: unknown) {
    const message =
      typeof messageOrDetails === "string"
        ? messageOrDetails
        : ((messageOrDetails as any)?.message ?? "Not Found");
    super(
      404,
      message,
      typeof messageOrDetails === "string" ? undefined : messageOrDetails,
    );
    this.name = "NotFoundException";
  }
}

export class TiktokService {
  private readonly prisma = prisma;
  private readonly s3Client =
    env.S3_BUCKET &&
    env.AWS_REGION &&
    env.AWS_ACCESS_KEY_ID &&
    env.AWS_SECRET_ACCESS_KEY
      ? new S3Client({
          region: env.AWS_REGION,
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        })
      : null;

  private sanitizeFilename(fileName: string): string {
    const trimmed = fileName.trim();
    if (!trimmed) return "upload";

    return (
      trimmed
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || "upload"
    );
  }

  private buildStorageUrl(storageKey: string): string {
    const baseUrl = env.STORAGE_BASE_URL?.trim();
    if (!baseUrl) {
      throw new BadRequestException(
        "STORAGE_BASE_URL is required to publish uploaded files",
      );
    }
    return `${baseUrl.replace(/\/+$/, "")}/${storageKey.replace(/^\/+/, "")}`;
  }

  private async uploadMultipartFiles(
    userId: string,
    files: Express.Multer.File[],
  ): Promise<string[]> {
    if (!files.length) return [];

    if (!this.s3Client || !env.S3_BUCKET) {
      throw new BadRequestException("S3 upload is not configured");
    }

    const uploadedUrls: string[] = [];

    for (const file of files) {
      const storageKey = `attachments/media/${Date.now()}_${userId}_${this.sanitizeFilename(file.originalname)}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype || "application/octet-stream",
        }),
      );

      uploadedUrls.push(this.buildStorageUrl(storageKey));
    }

    return uploadedUrls;
  }

  private normalizeBoolean(value: unknown, fallback = true): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
  }

  private readonly configService = {
    get: <T = string>(name: string): T | undefined =>
      (process.env[name] as unknown as T | undefined) ?? undefined,
  };

  private required(name: string): string {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) {
      throw new BadRequestException(`Missing required env var: ${name}`);
    }
    return value;
  }

  private authHeader(): string {
    const key = this.required("UPLOAD_POST_API_KEY");
    if (/^apikey\s+/i.test(key) || /^bearer\s+/i.test(key)) {
      return key;
    }
    return `ApiKey ${key}`;
  }

  private resolveBaseUrl(): string {
    const raw = (
      this.configService.get<string>("UPLOAD_POST_BASE_URL") ?? ""
    ).trim();
    if (!raw) return "https://api.upload-post.com/api";

    const normalized = raw.replace(/\/$/, "");

    if (
      normalized === "https://upload-post.com" ||
      normalized === "https://www.upload-post.com" ||
      normalized === "https://api.upload-post.com" ||
      normalized === "https://www.api.upload-post.com"
    ) {
      return "https://api.upload-post.com/api";
    }

    if (normalized.endsWith("/api")) return normalized;

    return normalized;
  }

  private extractExternalIds(result: unknown): {
    requestId?: string;
    jobId?: string;
  } {
    const obj =
      typeof result === "object" && result
        ? (result as Record<string, unknown>)
        : {};
    const requestId =
      typeof obj.request_id === "string"
        ? obj.request_id
        : typeof obj.requestId === "string"
          ? obj.requestId
          : undefined;
    const jobId =
      typeof obj.job_id === "string"
        ? obj.job_id
        : typeof obj.jobId === "string"
          ? obj.jobId
          : undefined;
    return { requestId, jobId };
  }

  private async api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.authHeader());

    const url = `${this.resolveBaseUrl()}${path}`;
    const response = await fetch(url, { ...init, headers });

    const text = await response.text();
    let data: unknown = text;

    try {
      data = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      // keep text
    }

    if (!response.ok) {
      throw new BadRequestException({
        message: "Upload Post API request failed",
        requestUrl: url,
        statusCode: response.status,
        statusText: response.statusText,
        error: data,
      });
    }

    return data;
  }

  private extractPostUrl(result: unknown): string | undefined {
    const obj =
      typeof result === "object" && result
        ? (result as Record<string, unknown>)
        : {};

    const candidates = [
      obj.post_url,
      obj.postUrl,
      obj.post_link,
      obj.postLink,
      obj.permalink,
      obj.url,
      obj.link,
      obj.live_post_url,
    ];

    return candidates.find((v) => typeof v === "string") as string | undefined;
  }

  private async ensurePlatformLinked(userId: string, platform: SocialPlatform) {
    const link = await this.prisma.socialPlatformLink.findUnique({
      where: { userId_platform: { userId, platform } },
    });

    if (!link) {
      throw new ForbiddenException(
        "User must login/connect this platform first via API",
      );
    }
  }

  private planLimits: Record<
    string,
    { maxLinkedPlatforms: number; monthlyScheduledPosts: number }
  > = {
    FREE: { maxLinkedPlatforms: 1, monthlyScheduledPosts: 10 },
    DEFAULT: { maxLinkedPlatforms: 2, monthlyScheduledPosts: 30 },
    PRO: { maxLinkedPlatforms: 3, monthlyScheduledPosts: 200 },
    ENTERPRISE: { maxLinkedPlatforms: 3, monthlyScheduledPosts: 10000 },
  };

  private async enforceScheduleLimit(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const total = await this.prisma.scheduledPost.count({
      where: {
        userId,
        createdAt: { gte: monthStart, lt: nextMonth },
      },
    });

    const socialPlan = String((user as any).socialPlan ?? "FREE");
    const limit = (this.planLimits[socialPlan] ?? this.planLimits.FREE)
      .monthlyScheduledPosts;
    if (total >= limit) {
      throw new ForbiddenException(
        `Monthly schedule limit reached for ${socialPlan} plan: ${limit}`,
      );
    }
  }

  private isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|avi|mkv|webm|m4v)(\?|$)/i.test(url);
  }

  private normalizeMediaUrls(
    mediaUrl?: string,
    mediaUrls?: string[],
  ): string[] {
    const urls = [
      ...(Array.isArray(mediaUrls) ? mediaUrls : []),
      ...(mediaUrl ? [mediaUrl] : []),
    ]
      .map((u) => (u ?? "").trim())
      .filter(Boolean);

    return Array.from(new Set(urls));
  }

  private async publishToTikTok(payload: {
    username: string;
    title?: string;
    mediaUrl?: string;
    asyncUpload?: boolean;
  }) {
    const title = payload.title?.trim() || "TikTok post";
    const asyncUpload = payload.asyncUpload ?? true;

    if (!payload.mediaUrl?.trim()) {
      throw new BadRequestException("TikTok posts require a video URL.");
    }

    if (!this.isVideoUrl(payload.mediaUrl)) {
      throw new BadRequestException("mediaUrl must be a video URL for TikTok.");
    }

    // ✅ Prepare FormData for TikTok upload
    const form = new FormData();
    form.append("user", payload.username.trim());
    form.append("platform[]", "tiktok");
    form.append("title", title);
    form.append("tiktok_title", title);
    form.append("status", "active");
    form.append("video", payload.mediaUrl);
    form.append("async_upload", String(asyncUpload));

    const result = await this.api("/upload", { method: "POST", body: form });

    return {
      result,
      title,
      mediaList: [payload.mediaUrl],
    };
  }

  public async publishTikTokMultipartByUserNow(
    user: User,
    payload: {
      username: string;
      file: Express.Multer.File;
      title?: string;
      asyncUpload?: boolean;
    },
  ) {
    // ✅ Ensure TikTok is linked
    await this.ensurePlatformLinked(user.id, SocialPlatform.TIKTOK);

    if (!payload.username?.trim()) {
      throw new BadRequestException("username is required");
    }

    if (!payload.file) {
      throw new BadRequestException("File is required");
    }

    if (!payload.file.mimetype.startsWith("video/")) {
      throw new BadRequestException("File must be a video");
    }

    // ✅ Upload to S3 and get URL
    const uploadedUrls = await this.uploadMultipartFiles(user.id, [
      payload.file,
    ]);

    if (!uploadedUrls.length)
      throw new BadRequestException("Upload to S3 failed");

    const videoUrl = uploadedUrls[0]; // only one file for TikTok

    // ✅ Prepare form to Upload Post API
    const form = new FormData();
    form.append("user", payload.username.trim());
    form.append("platform[]", "tiktok");
    form.append("video", videoUrl); // send S3 URL here

    if (payload.title?.trim()) {
      form.append("title", payload.title.trim());
      form.append("tiktok_title", payload.title.trim());
    }

    form.append(
      "async_upload",
      String(this.normalizeBoolean(payload.asyncUpload, true)),
    );

    let result: any;
    try {
      result = await this.api("/upload", {
        method: "POST",
        body: form,
      });
    } catch (error) {
      console.error("TikTok upload error:", error);
      throw new BadRequestException({ message: "TikTok upload failed", error });
    }

    if (!result)
      throw new BadRequestException("Empty response from Upload Post API");

    const ids = this.extractExternalIds(result);
    const postUrl = this.extractPostUrl(result);

    if (!ids.requestId && !ids.jobId) {
      throw new BadRequestException({
        message: "Upload API did not return identifiers",
        result,
      });
    }

    // ✅ Save post in DB
    const savedPost = await this.prisma.scheduledPost.create({
      data: {
        userId: user.id,
        platform: SocialPlatform.TIKTOK,
        title: payload.title ?? "TikTok post",
        mediaUrl: videoUrl,
        scheduledAt: new Date(),
        status: ScheduledPostStatus.POSTED,
        externalReqId: ids.requestId,
        externalJobId: ids.jobId,
        externalPostUrl: postUrl,
      },
    });

    return savedPost;
  }

  async publishNowTikTok(
    user: User,
    payload: {
      username: string;
      title?: string;
      mediaUrl: string; 
      asyncUpload?: boolean;
    },
  ) {
    // ✅ Ensure TikTok is linked
    await this.ensurePlatformLinked(user.id, SocialPlatform.TIKTOK);

    if (!payload.username?.trim()) {
      throw new BadRequestException("username is required");
    }

    if (!payload.mediaUrl?.trim()) {
      throw new BadRequestException("mediaUrl is required");
    }

    // ✅ Publish via provider
    const published = await this.publishToTikTok({
      username: payload.username,
      title: payload.title?.trim(),
      mediaUrl: payload.mediaUrl,
      asyncUpload: this.normalizeBoolean(payload.asyncUpload, true),
    });

    const ids = this.extractExternalIds(published.result);
    const postUrl = this.extractPostUrl(published.result);

    // ✅ Save post in DB
    const savedPost = await this.prisma.scheduledPost.create({
      data: {
        userId: user.id,
        platform: SocialPlatform.TIKTOK,
        title: payload.title ?? "TikTok post",
        mediaUrl: payload.mediaUrl,
        scheduledAt: new Date(),
        status: ScheduledPostStatus.POSTED,
        externalReqId: ids.requestId,
        externalJobId: ids.jobId,
        externalPostUrl: postUrl,
      },
    });

    return { success: true, result: published.result, savedPost };
  }

  // TODO: need to implement cron job to process due scheduled posts for TikTok
  // TODO: need to use multipart upload for this
  async scheduleTikTokPost(
    user: User,
    payload: {
      title: string;
      mediaUrl?: string;
      mediaUrls?: string[];
      scheduledAt: string;
    },
  ) {
    const tiktokPlatform = SocialPlatform.TIKTOK;

    // (Optional) check if linked
    await this.ensurePlatformLinked(user.id, tiktokPlatform);

    const scheduledAt = new Date(payload.scheduledAt);

    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException("scheduledAt must be a valid ISO date");
    }

    if (scheduledAt <= new Date()) {
      throw new BadRequestException("scheduledAt must be in the future");
    }

    await this.enforceScheduleLimit(user.id);

    // ✅ Normalize media
    const mediaList = this.normalizeMediaUrls(
      payload.mediaUrl,
      payload.mediaUrls,
    );

    // 🔥 TikTok strict validation
    if (mediaList.length !== 1) {
      throw new BadRequestException("TikTok requires exactly one video");
    }

    if (!this.isVideoUrl(mediaList[0])) {
      throw new BadRequestException("TikTok only supports video uploads");
    }

    // ✅ Save to DB
    const post = await this.prisma.scheduledPost.create({
      data: {
        userId: user.id,
        platform: tiktokPlatform,
        title: payload.title || "TikTok post",
        mediaUrl: mediaList[0],
        scheduledAt,
        status: ScheduledPostStatus.PENDING,
      },
    });

    return {
      success: true,
      message: "TikTok post scheduled successfully",
      post,
    };
  }
}

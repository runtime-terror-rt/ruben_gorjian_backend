import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { buildStorageUrl } from "../../lib/validators";

export type SchedulerMediaKind = "IMAGE" | "VIDEO";

type SchedulerUploadRequest = {
  userId: string;
  fileName: string;
  contentType: string;
  fileSize?: number;
};

type ServerUploadRequest = {
  storageKey: string;
  contentType: string;
  body: Buffer;
};

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/x-matroska",
]);

function inferMediaType(fileName: string, contentType: string): SchedulerMediaKind {
  if (VIDEO_MIME_TYPES.has(contentType.toLowerCase()) || /\.(mp4|mov|webm|avi|mkv)$/i.test(fileName)) {
    return "VIDEO";
  }
  return "IMAGE";
}

export function validateSchedulerContentType(contentType: string) {
  const normalized = contentType.trim().toLowerCase();
  return IMAGE_MIME_TYPES.has(normalized) || VIDEO_MIME_TYPES.has(normalized);
}

export function sanitizeSchedulerFilename(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "upload";

  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const rawBase = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  const base = rawBase.normalize("NFKD");

  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return cleaned || "upload";
}

export class SchedulerStorageService {
  private readonly s3Client: S3Client | null;

  constructor() {
    if (env.S3_BUCKET && env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      this.s3Client = new S3Client({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      });
    } else {
      this.s3Client = null;
    }
  }

  buildStorageKey(userId: string, fileName: string) {
    return `user/${userId}/scheduler/${Date.now()}-${sanitizeSchedulerFilename(fileName)}`;
  }

  buildPreviewUrl(storageKey: string) {
    return env.STORAGE_BASE_URL ? buildStorageUrl(env.STORAGE_BASE_URL, storageKey) : null;
  }

  inferMediaType(fileName: string, contentType: string): SchedulerMediaKind {
    return inferMediaType(fileName, contentType);
  }

  async createSignedUpload(request: SchedulerUploadRequest) {
    const storageKey = this.buildStorageKey(request.userId, request.fileName);
    const mediaType = inferMediaType(request.fileName, request.contentType);

    if (!this.s3Client || !env.S3_BUCKET) {
      return {
        storageKey,
        mediaType,
        uploadUrl: null,
        previewUrl: this.buildPreviewUrl(storageKey),
      };
    }

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: request.contentType,
      ...(request.fileSize ? { ContentLength: request.fileSize } : {}),
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });

    return {
      storageKey,
      mediaType,
      uploadUrl,
      previewUrl: this.buildPreviewUrl(storageKey),
    };
  }

  async uploadBuffer(request: ServerUploadRequest) {
    if (!this.s3Client || !env.S3_BUCKET) {
      return;
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: request.storageKey,
        ContentType: request.contentType,
        Body: request.body,
      })
    );
  }

  async deleteObject(storageKey: string) {
    if (!this.s3Client || !env.S3_BUCKET) {
      return;
    }

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
      })
    );
  }
}

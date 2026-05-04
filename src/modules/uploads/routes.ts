import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { buildStorageUrl } from "../../lib/validators";

const router = express.Router();
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

router.post("/presign", requireAuth, (req, res) => {
  const schema = z.object({
    fileName: z.string(),
    contentType: z.string().optional(),
    fileSize: z.number().int().positive().optional(),
    purpose: z.enum(["asset", "avatar"]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (parsed.data.purpose === "avatar") {
    const normalizedContentType = parsed.data.contentType?.toLowerCase();
    if (!normalizedContentType || !ALLOWED_AVATAR_MIME_TYPES.has(normalizedContentType)) {
      return res.status(400).json({ error: "Avatar content type must be jpg, jpeg, png, or webp" });
    }
    if (!parsed.data.fileSize || parsed.data.fileSize > MAX_AVATAR_SIZE_BYTES) {
      return res.status(400).json({ error: "Avatar file size must be 5MB or smaller" });
    }
  }

  if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    logger.warn("S3 not fully configured; returning stubbed storage key");
    const key = `user/${req.user!.id}/${Date.now()}-${sanitizeFilename(parsed.data.fileName)}`;
    return res.json({
      uploadUrl: null,
      storageKey: key,
      message: "S3 not configured; configure AWS credentials to enable direct uploads.",
    });
  }

  const s3 = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const key = `user/${req.user!.id}/${Date.now()}-${sanitizeFilename(parsed.data.fileName)}`;
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: parsed.data.contentType,
  });

  getSignedUrl(s3, command, { expiresIn: 300 })
    .then((uploadUrl) => {
      return res.json({
        uploadUrl,
        storageKey: key,
      });
    })
    .catch((error) => {
      logger.error("Failed to create S3 presign", error);
      return res.status(500).json({ error: "Failed to create upload URL" });
    });
});

router.post("/asset", requireAuth, async (req, res) => {
  const schema = z.object({
    storageKey: z.string(),
    contentType: z.string().optional(),
    type: z.enum(["IMAGE", "VIDEO"]).optional(),
    kind: z.enum(["ORIGINAL", "ENHANCED"]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { storageKey, contentType, kind } = parsed.data;
  const isVideoByExtension = /\.(mp4|mov|mkv|avi|webm)$/i.test(storageKey);
  const assetType =
    parsed.data.type ||
    (contentType?.startsWith("video/") ? "VIDEO" : "IMAGE") ||
    (isVideoByExtension ? "VIDEO" : "IMAGE");

  try {
    const asset = await prisma.asset.create({
      data: {
        userId: req.user!.id,
        storageKey,
        contentType: contentType || null,
        type: assetType,
        kind: kind || "ORIGINAL",
      },
    });
    return res.json({ asset });
  } catch (error) {
    logger.error("Failed to create asset record", {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      storageKey,
      contentType,
      assetType,
      userId: req.user!.id,
    });
    return res.status(500).json({ 
      error: "Failed to save asset metadata",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get("/assets", requireAuth, async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        storageKey: true,
        type: true,
        contentType: true,
        createdAt: true,
      },
    });
    const baseUrl = env.STORAGE_BASE_URL || null;
    return res.json({ assets, baseUrl });
  } catch (error) {
    logger.error("Failed to fetch assets", error);
    return res.status(500).json({ error: "Failed to fetch assets" });
  }
});

const fileFilterSchema = z.object({
  type: z.enum(["all", "image", "video", "audio"]).optional().default("all"),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

type MediaType = "image" | "video" | "audio" | "other";
type UploadSource = "asset" | "brand" | "submission" | "enhanced" | "avatar";

function inferMediaType(input: {
  mimeType?: string | null;
  assetType?: string | null;
  fileName?: string | null;
  storageKey?: string | null;
}): MediaType {
  const normalizedMime = input.mimeType?.toLowerCase() ?? "";

  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("video/")) return "video";
  if (normalizedMime.startsWith("audio/")) return "audio";

  if (input.assetType === "IMAGE") return "image";
  if (input.assetType === "VIDEO") return "video";

  const candidate = `${input.fileName ?? ""} ${input.storageKey ?? ""}`.toLowerCase();

  if (/\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif)\b/.test(candidate)) return "image";
  if (/\.(mp4|mov|mkv|avi|webm|m4v)\b/.test(candidate)) return "video";
  if (/\.(mp3|wav|aac|m4a|ogg|oga|flac|opus|wma)\b/.test(candidate)) return "audio";

  return "other";
}

function toPublicUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey || !env.STORAGE_BASE_URL) {
    return null;
  }
  return buildStorageUrl(env.STORAGE_BASE_URL, storageKey);
}

router.get("/files", requireAuth, async (req, res) => {
  const parsed = fileFilterSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const { type, page, limit } = parsed.data;
  const userId = req.user!.id;

  try {
    const [assets, brandFiles, submissionFiles, enhancedFiles, profile] = await Promise.all([
      prisma.asset.findMany({
        where: { userId },
        select: {
          id: true,
          storageKey: true,
          contentType: true,
          type: true,
          kind: true,
          source: true,
          createdAt: true,
        },
      }),
      prisma.brandFile.findMany({
        where: { userId },
        select: {
          id: true,
          fileName: true,
          fileType: true,
          storageKey: true,
          createdAt: true,
        },
      }),
      prisma.submissionFile.findMany({
        where: {
          submission: {
            userId,
          },
        },
        select: {
          id: true,
          submissionId: true,
          fileName: true,
          fileType: true,
          storageKey: true,
          createdAt: true,
        },
      }),
      prisma.enhancedDeliveryFile.findMany({
        where: {
          enhancedDelivery: {
            submission: {
              userId,
            },
          },
        },
        select: {
          id: true,
          enhancedDeliveryId: true,
          fileName: true,
          mimeType: true,
          storageKey: true,
          createdAt: true,
        },
      }),
      prisma.userProfile.findUnique({
        where: { userId },
        select: {
          avatarStorageKey: true,
          avatarContentType: true,
          updatedAt: true,
        },
      }),
    ]);

    const collected: Array<{
      id: string;
      source: UploadSource;
      mediaType: MediaType;
      fileName: string | null;
      contentType: string | null;
      storageKey: string;
      url: string | null;
      createdAt: string;
      meta?: Record<string, unknown>;
    }> = [];

    for (const asset of assets) {
      collected.push({
        id: asset.id,
        source: "asset",
        mediaType: inferMediaType({
          mimeType: asset.contentType,
          assetType: asset.type,
          storageKey: asset.storageKey,
        }),
        fileName: sanitizeFilename(asset.storageKey.split("/").pop() || "upload"),
        contentType: asset.contentType,
        storageKey: asset.storageKey,
        url: toPublicUrl(asset.storageKey),
        createdAt: asset.createdAt.toISOString(),
        meta: {
          assetType: asset.type,
          kind: asset.kind,
          source: asset.source,
        },
      });
    }

    for (const file of brandFiles) {
      collected.push({
        id: file.id,
        source: "brand",
        mediaType: inferMediaType({
          mimeType: file.fileType,
          fileName: file.fileName,
          storageKey: file.storageKey,
        }),
        fileName: file.fileName,
        contentType: file.fileType,
        storageKey: file.storageKey,
        url: toPublicUrl(file.storageKey),
        createdAt: file.createdAt.toISOString(),
      });
    }

    for (const file of submissionFiles) {
      collected.push({
        id: file.id,
        source: "submission",
        mediaType: inferMediaType({
          mimeType: file.fileType,
          fileName: file.fileName,
          storageKey: file.storageKey,
        }),
        fileName: file.fileName,
        contentType: file.fileType,
        storageKey: file.storageKey,
        url: toPublicUrl(file.storageKey),
        createdAt: file.createdAt.toISOString(),
        meta: {
          submissionId: file.submissionId,
        },
      });
    }

    for (const file of enhancedFiles) {
      collected.push({
        id: file.id,
        source: "enhanced",
        mediaType: inferMediaType({
          mimeType: file.mimeType,
          fileName: file.fileName,
          storageKey: file.storageKey,
        }),
        fileName: file.fileName,
        contentType: file.mimeType,
        storageKey: file.storageKey,
        url: toPublicUrl(file.storageKey),
        createdAt: file.createdAt.toISOString(),
        meta: {
          enhancedDeliveryId: file.enhancedDeliveryId,
        },
      });
    }

    if (profile?.avatarStorageKey) {
      collected.push({
        id: `avatar:${userId}`,
        source: "avatar",
        mediaType: inferMediaType({
          mimeType: profile.avatarContentType,
          storageKey: profile.avatarStorageKey,
        }),
        fileName: sanitizeFilename(profile.avatarStorageKey.split("/").pop() || "avatar"),
        contentType: profile.avatarContentType,
        storageKey: profile.avatarStorageKey,
        url: toPublicUrl(profile.avatarStorageKey),
        createdAt: profile.updatedAt.toISOString(),
      });
    }

    const filtered = collected.filter((item) => {
      if (type === "all") return true;
      return item.mediaType === type;
    });

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return res.json({
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        type,
      },
      items,
    });
  } catch (error) {
    logger.error("Failed to fetch unified user files", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
    return res.status(500).json({ error: "Failed to fetch files" });
  }
});

export { router as uploadsRouter };

function sanitizeFilename(fileName: string): string {
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

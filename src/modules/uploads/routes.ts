import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

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

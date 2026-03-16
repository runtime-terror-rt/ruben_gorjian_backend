import express from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { sanitizeStorageKey } from "../../lib/validators";

const router = express.Router();

router.use(requireAuth);

const payloadSchema = z.object({
  industry: z.string().optional(),
  productTypes: z.string().optional(),
  businessType: z.string().optional(),
  tone: z.string().optional(),
  audience: z.string().optional(),
  competitors: z.string().optional(),
  ctaPreferences: z.string().optional(),
  hashtagPreferences: z.string().optional(),
  website: z.string().optional(),
  step: z.coerce.number().int().min(1).max(3),
});

router.post("/", async (req, res) => {
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const userId = req.user!.id;
  const { step, ...data } = parsed.data;
  const targetStep = step;

  const profile = await prisma.brandProfile.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      onboardingCompleted: targetStep >= 3,
      onboardingStep: targetStep,
    },
  });

  return res.json({ success: true, profile });
});

router.get("/", async (req, res) => {
  const userId = req.user!.id;
  const [profile, user] = await Promise.all([
    prisma.brandProfile.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  return res.json({
    profile,
    onboardingStep: user?.onboardingStep ?? 1,
    onboardingCompleted: user?.onboardingCompleted ?? false,
  });
});

// Upload brand file (logo, guidelines, etc.)
router.post("/files", async (req, res) => {
  const schema = z.object({
    storageKey: z.string(),
    fileName: z.string(),
    fileType: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const userId = req.user!.id;
  const { storageKey, fileName, fileType } = parsed.data;

  try {
    const brandFile = await prisma.brandFile.create({
      data: {
        userId,
        storageKey,
        fileName,
        fileType: fileType || null,
      },
    });
    return res.json({ brandFile });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save brand file" });
  }
});

// Download brand file (logo, guidelines, etc.)
router.post("/files/download", async (req, res) => {
  const schema = z.object({
    storageKey: z.string().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const userId = req.user!.id;
  const { storageKey } = parsed.data;

  try {
    const sanitizedKey = sanitizeStorageKey(storageKey);
    if (!sanitizedKey) {
      return res.status(400).json({ error: "Invalid storage key" });
    }

    const brandFile = await prisma.brandFile.findFirst({
      where: { userId, storageKey: sanitizedKey },
    });

    if (!brandFile) {
      return res.status(404).json({ error: "File not found" });
    }

    if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      return res.json({
        downloadUrl: null,
        fileName: brandFile.fileName,
        message: "S3 not configured",
      });
    }

    const safeFilename = brandFile.fileName
      .replace(/[^a-zA-Z0-9._\-\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 255);

    const s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: sanitizedKey,
      ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return res.json({
      downloadUrl,
      fileName: brandFile.fileName,
      expiresIn: 3600,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to generate download URL" });
  }
});

export { router };

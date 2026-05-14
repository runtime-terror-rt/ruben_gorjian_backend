import express from "express";
import { z } from "zod";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";
import { buildStorageUrl, sanitizeStorageKey, timezoneValidator } from "../../lib/validators";
import { env } from "../../config/env";
import { logActivity } from "../dashboard/activity-logger";
import { logger } from "../../lib/logger";

const router = express.Router();

router.use(requireAuth);

const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

// Multer for avatar upload (memory storage)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
  fileFilter: (_req: express.Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile?: boolean) => void) => {
    const normalized = file.mimetype.toLowerCase();
    if (!ALLOWED_AVATAR_MIME_TYPES.has(normalized)) {
      return cb(new Error("Avatar must be jpg, jpeg, png, or webp"));
    }
    cb(null, true);
  },
});

function isAllowedImageExtension(storageKey: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(storageKey);
}

function isAllowedAvatarContentType(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }

  return ALLOWED_AVATAR_MIME_TYPES.has(contentType.toLowerCase());
}

function serializeSettingsResponse(user: {
  email: string;
  profile: {
    fullName: string;
    businessName: string | null;
    website: string | null;
    industry: string | null;
    timezone: string | null;
    bio: string | null;
    avatarStorageKey: string | null;
    avatarContentType: string | null;
    updatedAt: Date;
  } | null;
}) {
  const avatarStorageKey = user.profile?.avatarStorageKey ?? null;
  const avatarUrl =
    avatarStorageKey && env.STORAGE_BASE_URL
      ? buildStorageUrl(env.STORAGE_BASE_URL, avatarStorageKey)
      : null;
  const avatarVersion = user.profile?.updatedAt
    ? user.profile.updatedAt.getTime()
    : null;

  return {
    profile: {
      fullName: user.profile?.fullName ?? "",
      email: user.email ?? "",
      bio: user.profile?.bio ?? "",
      avatar: {
        storageKey: avatarStorageKey,
        contentType: user.profile?.avatarContentType ?? null,
        url: avatarUrl,
        version: avatarStorageKey ? avatarVersion : null,
      },
    },
    business: {
      name: user.profile?.businessName ?? "",
      website: user.profile?.website ?? null,
      industry: user.profile?.industry ?? null,
      timezone: user.profile?.timezone ?? null,
    },
  };
}

router.get("/", async (req, res) => {
  const userId = req.user!.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      profile: {
        select: {
          fullName: true,
          businessName: true,
          website: true,
          industry: true,
          timezone: true,
          bio: true,
          avatarStorageKey: true,
          avatarContentType: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json(serializeSettingsResponse(user));
});

const updateSettingsSchema = z.object({
  profile: z
    .object({
      fullName: z.string().min(1, "Full name is required").optional(),
      bio: z.string().max(300, "Bio must be 300 characters or fewer").optional().nullable(),
      removeAvatar: z.string().transform((v) => v === "true").optional(),
    })
    .optional(),
  business: z
    .object({
      name: z.string().optional(),
      website: z.string().url().optional().nullable(),
      industry: z.string().optional().nullable(),
      timezone: timezoneValidator().optional().nullable(),
    })
    .optional(),
});

async function uploadAvatarToS3(
  userId: string,
  file: Express.Multer.File,
): Promise<{ storageKey: string; contentType: string }> {
  if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("S3 is not configured");
  }

  const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const sanitized = file.originalname
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "avatar";

  const storageKey = `user/${userId}/${Date.now()}-${sanitized}`;
  const normalizedContentType = file.mimetype.toLowerCase();

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: file.buffer,
        ContentType: normalizedContentType,
      }),
    );

    return {
      storageKey,
      contentType: normalizedContentType,
    };
  } catch (error) {
    logger.error("S3 upload failed", {
      error: error instanceof Error ? error.message : String(error),
      userId,
      storageKey,
    });
    throw new Error("Failed to upload avatar to S3");
  }
}

async function updateSettingsHandler(req: express.Request, res: express.Response) {
  try {
    const userId = req.user!.id;

    // Parse form data
    const bodyData: any = {};
    const formFields = req.body || {};

    if (formFields.profile) {
      bodyData.profile =
        typeof formFields.profile === "string" ? JSON.parse(formFields.profile) : formFields.profile;
    }
    if (formFields.business) {
      bodyData.business =
        typeof formFields.business === "string" ? JSON.parse(formFields.business) : formFields.business;
    }

    const parsed = updateSettingsSchema.safeParse(bodyData);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    let avatarStorageKey: string | null | undefined = undefined;
    let avatarContentType: string | null | undefined = undefined;

    // Handle avatar upload
    if ((req as any).file) {
      const uploadResult = await uploadAvatarToS3(userId, (req as any).file);
      avatarStorageKey = uploadResult.storageKey;
      avatarContentType = uploadResult.contentType;
    } else if (payload.profile?.removeAvatar) {
      avatarStorageKey = null;
      avatarContentType = null;
    } else {
      // No avatar change, leave undefined
      avatarStorageKey = undefined;
      avatarContentType = undefined;
    }

    // Update profile in database
    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: payload.profile?.fullName ?? "",
        businessName: payload.business?.name ?? "",
        website: payload.business?.website ?? null,
        industry: payload.business?.industry ?? null,
        timezone: payload.business?.timezone ?? null,
        bio: payload.profile?.bio ?? null,
        avatarStorageKey: avatarStorageKey ?? null,
        avatarContentType: avatarContentType ?? null,
      },
      update: {
        ...(payload.profile?.fullName && { fullName: payload.profile.fullName }),
        ...(payload.business?.name && { businessName: payload.business.name }),
        ...(payload.business?.website !== undefined && { website: payload.business.website }),
        ...(payload.business?.industry !== undefined && { industry: payload.business.industry }),
        ...(payload.business?.timezone !== undefined && { timezone: payload.business.timezone }),
        ...(payload.profile?.bio !== undefined && { bio: payload.profile.bio }),
        ...(avatarStorageKey !== undefined && { avatarStorageKey }),
        ...(avatarContentType !== undefined && { avatarContentType }),
      },
    });

    // Fetch updated user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        profile: {
          select: {
            fullName: true,
            businessName: true,
            website: true,
            industry: true,
            timezone: true,
            bio: true,
            avatarStorageKey: true,
            avatarContentType: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    logActivity({
      userId,
      type: "PROFILE_UPDATED",
      title: "Profile Updated",
      description: `Updated profile information: ${user.profile?.fullName || "Anonymous"}`,
    }).catch(() => {});

    res.json(serializeSettingsResponse(user));
  } catch (error) {
    logger.error("Settings update failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update settings",
    });
  }
}

router.put("/", avatarUpload.single("avatar"), updateSettingsHandler);
router.patch("/", avatarUpload.single("avatar"), updateSettingsHandler);

router.delete("/photo", async (req, res) => {
  const userId = req.user!.id;

  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      fullName: "",
      avatarStorageKey: null,
      avatarContentType: null,
    },
    update: {
      avatarStorageKey: null,
      avatarContentType: null,
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      profile: {
        select: {
          fullName: true,
          businessName: true,
          website: true,
          industry: true,
          timezone: true,
          bio: true,
          avatarStorageKey: true,
          avatarContentType: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json(serializeSettingsResponse(user));
});

export { router as settingsRouter };

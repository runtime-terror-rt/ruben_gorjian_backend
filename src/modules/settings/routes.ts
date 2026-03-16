import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";
import { buildStorageUrl, sanitizeStorageKey, timezoneValidator } from "../../lib/validators";
import { env } from "../../config/env";

const router = express.Router();

router.use(requireAuth);

const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function isAllowedImageExtension(storageKey: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(storageKey);
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
      avatar: z
        .object({
          storageKey: z.string().optional().nullable(),
          contentType: z.string().optional().nullable(),
          remove: z.boolean().optional(),
        })
        .optional(),
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

async function updateSettingsHandler(req: express.Request, res: express.Response) {
  const schema = z.object({
    profile: updateSettingsSchema.shape.profile,
    business: updateSettingsSchema.shape.business,
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const userId = req.user!.id;
  const payload = parsed.data;
  const avatarPayload = payload.profile?.avatar;

  let avatarStorageKey: string | null | undefined = undefined;
  let avatarContentType: string | null | undefined = undefined;

  if (avatarPayload?.remove) {
    avatarStorageKey = null;
    avatarContentType = null;
  } else if (avatarPayload?.storageKey) {
    try {
      const sanitized = sanitizeStorageKey(avatarPayload.storageKey);
      if (!sanitized) {
        return res.status(400).json({ error: "Invalid avatar storage key" });
      }
      if (!sanitized.startsWith(`user/${userId}/`)) {
        return res.status(400).json({ error: "Avatar key must belong to current user" });
      }
      if (!isAllowedImageExtension(sanitized)) {
        return res.status(400).json({ error: "Avatar file extension must be jpg, jpeg, png, or webp" });
      }
      avatarStorageKey = sanitized;
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid avatar storage key",
      });
    }

    if (avatarPayload.contentType) {
      const normalized = avatarPayload.contentType.toLowerCase();
      if (!ALLOWED_AVATAR_MIME_TYPES.has(normalized)) {
        return res.status(400).json({ error: "Avatar content type is not allowed" });
      }
      avatarContentType = normalized;
    } else {
      avatarContentType = null;
    }
  }

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
      fullName: payload.profile?.fullName ?? undefined,
      businessName: payload.business?.name ?? undefined,
      website: payload.business?.website ?? undefined,
      industry: payload.business?.industry ?? undefined,
      timezone: payload.business?.timezone ?? undefined,
      bio: payload.profile?.bio ?? undefined,
      avatarStorageKey,
      avatarContentType,
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
}

router.put("/", updateSettingsHandler);
router.patch("/", updateSettingsHandler);

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

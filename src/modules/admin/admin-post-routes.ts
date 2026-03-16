import express from "express";
import { z } from "zod";
import { SocialPlatform, PostStatus, AssetType, AssetSource } from "@prisma/client";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdminPostPermission, validatePostAsUserPermission } from "../../middleware/requireAdminPostPermission";
import { AdminPostService } from "./admin-post-service";
import { AdminMediaService } from "./admin-media-service";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const router = express.Router();
const adminPostService = new AdminPostService();
const adminMediaService = new AdminMediaService();

// Rate limiter: 30 requests per minute per admin
const createPostLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: "Too many post creation requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip ?? ""),
});

const GOOGLE_SHEETS_HOSTS = new Set(["docs.google.com", "drive.google.com"]);

type ImportedSheetRow = {
  rowNumber: number;
  imageSku: string;
  productSkuLink: string | null;
  postId: string;
  caption1: string;
  caption2: string;
  caption3: string;
  hashtags: string;
  notes: string | null;
};

const headerAliases: Record<
  "imageSku" | "productSkuLink" | "postId" | "caption1" | "caption2" | "caption3" | "hashtags" | "notes",
  string[]
> = {
  imageSku: ["imagesku", "image sku", "image file name", "image filename"],
  productSkuLink: ["product sku link", "productskulink", "sku link"],
  postId: ["postid", "post id"],
  caption1: ["caption1", "caption 1", "caption 1 (storytelling)"],
  caption2: ["caption2", "caption 2", "caption 2 (design-focused)", "caption 2 (design focused)"],
  caption3: ["caption3", "caption 3"],
  hashtags: ["hashtags", "hashtag"],
  notes: ["notes", "note"],
};

function normalizeHeader(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(current.trim());
      current = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function extractSheetId(inputUrl: URL): string | null {
  const match = inputUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  const directId = inputUrl.searchParams.get("id");
  return directId || null;
}

function toCsvExportUrl(sheetLink: string): string {
  let parsed: URL;
  try {
    parsed = new URL(sheetLink.trim());
  } catch {
    throw new Error("Invalid URL format. Please paste a valid Google Sheet link.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!GOOGLE_SHEETS_HOSTS.has(hostname)) {
    throw new Error("Only Google Sheet share links are supported.");
  }

  if (
    parsed.pathname.endsWith(".csv") ||
    parsed.searchParams.get("output") === "csv" ||
    parsed.searchParams.get("format") === "csv"
  ) {
    return parsed.toString();
  }

  const sheetId = extractSheetId(parsed);
  if (!sheetId) {
    throw new Error("Could not detect Google Sheet ID from the provided link.");
  }

  const gid = parsed.searchParams.get("gid") || "0";
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function findColumnIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

// Apply auth and permission middleware to all routes
router.use(requireAuth, requireAdminPostPermission);

/**
 * POST /api/admin/users/:userId/posts
 * Create and publish/schedule a post on behalf of a user
 */
router.post("/users/:userId/posts", createPostLimiter, async (req, res) => {
  const createPostSchema = z.object({
    content: z.object({
      caption: z.string().min(1, "Caption is required").max(2200, "Caption too long"),
      hashtags: z.array(z.string()).optional(),
      cta: z.string().optional(),
      shortDescription: z.string().max(300).optional(),
    }),
    mediaIds: z.array(z.string()).optional(),
    platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])).min(1, "At least one platform required"),
    socialAccountIds: z.array(z.string()).optional(),
    publishMode: z.enum(["NOW", "SCHEDULE"]),
    scheduledFor: z.string().datetime().optional(),
    timezone: z.string().optional(),
    reason: z.string().min(1, "Reason is required").max(500, "Reason too long"),
  });

  try {
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
    }

    const { userId } = req.params;
    const adminId = req.user!.id;
    const data = parsed.data;

    // Validate scheduledFor if publishMode is SCHEDULE
    if (data.publishMode === "SCHEDULE" && !data.scheduledFor) {
      return res.status(400).json({
        error: "scheduledFor is required when publishMode is SCHEDULE",
      });
    }

    if (data.publishMode === "NOW" && data.scheduledFor) {
      return res.status(400).json({
        error: "scheduledFor should not be provided when publishMode is NOW",
      });
    }

    if (data.publishMode === "SCHEDULE" && data.scheduledFor) {
      const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(data.scheduledFor);
      if (!hasTimezone) {
        return res.status(400).json({
          error: "scheduledFor must include a timezone offset",
        });
      }
    }

    const result = await adminPostService.createPostAsUser({
      userId,
      adminId,
      content: data.content,
      mediaIds: data.mediaIds,
      platforms: data.platforms as SocialPlatform[],
      socialAccountIds: data.socialAccountIds,
      publishMode: data.publishMode,
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : undefined,
      timezone: data.timezone,
      reason: data.reason,
    });

    logger.info("Admin created post on behalf of user", {
      postId: result.post.id,
      adminId,
      userId,
      publishMode: data.publishMode,
    });

    res.status(201).json({
      success: true,
      post: result.post,
      targets: result.targets,
      requiresApproval: result.requiresApproval,
      message: data.publishMode === "NOW"
        ? result.requiresApproval
          ? "Post created and pending user approval"
          : "Post created and queued for publishing"
        : result.requiresApproval
          ? "Post created and pending user approval"
          : "Post scheduled successfully",
    });
  } catch (error: any) {
    logger.error("Error creating admin post", {
      error: error.message,
      adminId: req.user!.id,
      userId: req.params.userId,
    });

    res.status(400).json({
      error: error.message || "Failed to create post",
    });
  }
});

/**
 * GET /api/admin/users/:userId/posts
 * Get admin-initiated posts for a user
 */
router.get("/users/:userId/posts", async (req, res) => {
  const querySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
    status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHING", "POSTED", "FAILED"]).optional(),
  });

  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    const { userId } = req.params;
    const { page, pageSize, status } = parsed.data;

    const result = await adminPostService.getAdminPostsForUser(userId, {
      page,
      pageSize,
      status: status as PostStatus | undefined,
    });

    res.json(result);
  } catch (error: any) {
    logger.error("Error fetching admin posts", {
      error: error.message,
      userId: req.params.userId,
    });

    res.status(500).json({
      error: "Failed to fetch admin posts",
    });
  }
});

/**
 * POST /api/admin/users/:userId/posts/:postId/cancel
 * Cancel a scheduled admin post
 */
router.post("/users/:userId/posts/:postId/cancel", async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const adminId = req.user!.id;

    const result = await adminPostService.cancelAdminPost(postId, adminId);

    logger.info("Admin canceled post", {
      postId,
      adminId,
      userId,
    });

    res.json({
      success: true,
      post: result,
      message: "Post canceled successfully",
    });
  } catch (error: any) {
    logger.error("Error canceling admin post", {
      error: error.message,
      postId: req.params.postId,
      adminId: req.user!.id,
    });

    res.status(400).json({
      error: error.message || "Failed to cancel post",
    });
  }
});

/**
 * POST /api/admin/users/:userId/posts/:postId/approve
 * Approve a pending admin post
 */
router.post("/:userId/posts/:postId/approve", async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const adminId = req.user!.id;

    const result = await adminPostService.approveAdminPost(postId, adminId);

    logger.info("Admin approved post", {
      postId,
      adminId,
      userId,
    });

    res.json({
      success: true,
      post: result,
      message: "Post approved successfully",
    });
  } catch (error: any) {
    logger.error("Error approving admin post", {
      error: error.message,
      postId: req.params.postId,
      adminId: req.user!.id,
    });

    res.status(400).json({
      error: error.message || "Failed to approve post",
    });
  }
});

/**
 * GET /api/admin/users/:userId/connected-platforms
 * Get user's connected social platforms for admin posting
 */
router.get("/users/:userId/connected-platforms", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user!.id;

    const permission = await validatePostAsUserPermission(adminId, userId);
    if (!permission.allowed) {
      return res.status(403).json({
        error: permission.error || "Not allowed to access user platforms",
      });
    }

    const platforms = await adminPostService.getUserConnectedPlatforms(userId);

    res.json({
      items: platforms,
      count: platforms.length,
    });
  } catch (error: any) {
    logger.error("Error fetching user's connected platforms", {
      error: error.message,
      userId: req.params.userId,
    });

    res.status(500).json({
      error: "Failed to fetch connected platforms",
    });
  }
});

/**
 * GET /api/admin/users/:userId/media/debug
 * DEBUG: Get raw asset data from database
 */
router.get("/users/:userId/media/debug", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user!.id;

    logger.info("Debug: Fetching raw assets", { userId, adminId });

    // Get ALL assets for this user, no filters
    const allAssets = await prisma.asset.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        kind: true,
        storageKey: true,
        contentType: true,
        source: true,
        uploadedByAdminId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    logger.info("Debug: Raw assets found", {
      userId,
      count: allAssets.length,
      assets: allAssets.map(a => ({
        id: a.id,
        source: a.source,
        status: a.status,
        type: a.type,
      })),
    });

    res.json({
      userId,
      totalAssets: allAssets.length,
      assets: allAssets,
      message: "This is a debug endpoint showing raw database data",
    });
  } catch (error: any) {
    logger.error("Debug endpoint error", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/users/:userId/media
 * Get user's media assets for admin posting
 */
router.get("/users/:userId/media", async (req, res) => {
  const querySchema = z.object({
    type: z.enum(["IMAGE", "VIDEO"]).optional(),
    source: z.enum(["USER_UPLOAD", "ADMIN_UPLOAD"]).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
  });

  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      logger.error("Invalid query parameters", {
        errors: parsed.error.flatten(),
        query: req.query,
      });
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    const { userId } = req.params;
    const adminId = req.user!.id;
    const { type, source, page, pageSize } = parsed.data;

    logger.info("Admin fetching user media", {
      adminId,
      userId,
      source,
      type,
      page,
      pageSize,
    });

    const permission = await validatePostAsUserPermission(adminId, userId);
    if (!permission.allowed) {
      logger.warn("Permission denied for admin media access", {
        adminId,
        userId,
        reason: permission.error,
      });
      return res.status(403).json({
        error: permission.error || "Not allowed to access user media",
      });
    }

    const result = await adminMediaService.getUserMedia(userId, {
      type: type as AssetType | undefined,
      source: source as AssetSource | undefined,
      page,
      pageSize,
    });

    logger.info("Admin media fetch result", {
      userId,
      total: result.total,
      itemsReturned: result.items.length,
    });

    res.json(result);
  } catch (error: any) {
    logger.error("Error fetching user's media", {
      error: error.message,
      stack: error.stack,
      userId: req.params.userId,
    });

    res.status(500).json({
      error: "Failed to fetch user media",
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/users/:userId/media/upload-url
 * Create signed upload URL for admin to upload media on behalf of user
 */
router.post("/users/:userId/media/upload-url", async (req, res) => {
  const schema = z.object({
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().int().min(1).max(100 * 1024 * 1024), // Max 100MB
  });

  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
    }

    const { userId } = req.params;
    const adminId = req.user!.id;
    const { filename, mimeType, size } = parsed.data;

    const permission = await validatePostAsUserPermission(adminId, userId);
    if (!permission.allowed) {
      return res.status(403).json({
        error: permission.error || "Not allowed to upload media for this user",
      });
    }

    const result = await adminMediaService.createAdminMediaUpload({
      userId,
      adminId,
      filename,
      mimeType,
      size,
    });

    res.json(result);
  } catch (error: any) {
    logger.error("Error creating admin media upload", {
      error: error.message,
      userId: req.params.userId,
      adminId: req.user!.id,
    });

    res.status(500).json({
      error: error.message || "Failed to create upload URL",
    });
  }
});

/**
 * POST /api/admin/users/:userId/media/:mediaId/finalize
 * Finalize admin media upload (mark as READY)
 */
router.post("/users/:userId/media/:mediaId/finalize", async (req, res) => {
  const schema = z.object({
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    duration: z.number().optional(),
  });

  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request payload",
        details: parsed.error.flatten(),
      });
    }

    const { mediaId } = req.params;
    const adminId = req.user!.id;

    const result = await adminMediaService.finalizeAdminMediaUpload(
      mediaId,
      adminId,
      parsed.data
    );

    res.json({ success: true, asset: result });
  } catch (error: any) {
    logger.error("Error finalizing admin media upload", {
      error: error.message,
      mediaId: req.params.mediaId,
      adminId: req.user!.id,
    });

    res.status(400).json({
      error: error.message || "Failed to finalize upload",
    });
  }
});

/**
 * DELETE /api/admin/users/:userId/media/:mediaId
 * Delete admin-uploaded media (hard delete)
 */
router.delete("/users/:userId/media/:mediaId", async (req, res) => {
  try {
    const { mediaId } = req.params;
    const adminId = req.user!.id;

    const result = await adminMediaService.deleteAdminMedia(mediaId, adminId);

    logger.info("Admin media deleted", {
      mediaId,
      adminId,
      userId: req.params.userId,
    });

    res.json(result);
  } catch (error: any) {
    logger.error("Error deleting admin media", {
      error: error.message,
      mediaId: req.params.mediaId,
      adminId: req.user!.id,
    });

    res.status(400).json({
      error: error.message || "Failed to delete media",
    });
  }
});

/**
 * POST /api/admin/users/:userId/posts/import-google-sheet
 * One-time import from a Google Sheet CSV into structured caption workspace fields
 */
router.post("/users/:userId/posts/import-google-sheet", async (req, res) => {
  const schema = z.object({
    sheetUrl: z.string().min(1, "Google Sheet link is required"),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request payload",
      details: parsed.error.flatten(),
    });
  }

  const { userId } = req.params;
  const adminId = req.user!.id;

  try {
    const permission = await validatePostAsUserPermission(adminId, userId);
    if (!permission.allowed) {
      return res.status(403).json({
        error: permission.error || "Not allowed to import for this user",
      });
    }

    const csvUrl = toCsvExportUrl(parsed.data.sheetUrl);
    const response = await fetch(csvUrl, { method: "GET" });
    if (!response.ok) {
      return res.status(400).json({
        error: "Failed to fetch Google Sheet CSV. Make sure the sheet is shared with link access.",
      });
    }

    const csvText = await response.text();
    if (!csvText.trim()) {
      return res.status(400).json({ error: "Google Sheet CSV is empty." });
    }

    const parsedRows = parseCsv(csvText);
    if (parsedRows.length < 2) {
      return res.status(400).json({ error: "Sheet must include a header row and at least one data row." });
    }

    const headers = parsedRows[0] || [];
    const imageSkuIdx = findColumnIndex(headers, headerAliases.imageSku);
    const productSkuLinkIdx = findColumnIndex(headers, headerAliases.productSkuLink);
    const postIdIdx = findColumnIndex(headers, headerAliases.postId);
    const caption1Idx = findColumnIndex(headers, headerAliases.caption1);
    const caption2Idx = findColumnIndex(headers, headerAliases.caption2);
    const caption3Idx = findColumnIndex(headers, headerAliases.caption3);
    const hashtagsIdx = findColumnIndex(headers, headerAliases.hashtags);
    const notesIdx = findColumnIndex(headers, headerAliases.notes);

    const missingColumns: string[] = [];
    if (caption1Idx < 0) missingColumns.push("Caption1");
    if (hashtagsIdx < 0) missingColumns.push("Hashtags");

    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: `Missing required column(s): ${missingColumns.join(", ")}`,
      });
    }

    const rows: ImportedSheetRow[] = [];
    for (let i = 1; i < parsedRows.length; i += 1) {
      const row = parsedRows[i] || [];
      const imageSku = imageSkuIdx >= 0 ? (row[imageSkuIdx]?.trim() || "") : "";
      const productSkuLink = productSkuLinkIdx >= 0 ? (row[productSkuLinkIdx]?.trim() || "") : "";
      const postId = postIdIdx >= 0 ? (row[postIdIdx]?.trim() || "") : "";
      const caption1 = row[caption1Idx]?.trim() || "";
      const caption2 = caption2Idx >= 0 ? (row[caption2Idx]?.trim() || "") : "";
      const caption3 = caption3Idx >= 0 ? (row[caption3Idx]?.trim() || "") : "";
      const hashtags = row[hashtagsIdx]?.trim() || "";
      const notes = notesIdx >= 0 ? (row[notesIdx]?.trim() || "") : "";

      const rowHasData = [imageSku, productSkuLink, postId, caption1, caption2, caption3, hashtags, notes].some(
        (value) => value.length > 0
      );
      if (!rowHasData) continue;

      rows.push({
        rowNumber: i + 1,
        imageSku,
        productSkuLink: productSkuLink || null,
        postId,
        caption1,
        caption2,
        caption3,
        hashtags,
        notes: notes || null,
      });
    }

    return res.json({
      success: true,
      totalRows: rows.length,
      rows,
    });
  } catch (error: any) {
    logger.error("Google Sheet import failed", {
      error: error?.message || "Unknown error",
      adminId,
      userId,
    });
    return res.status(400).json({
      error: error?.message || "Failed to import Google Sheet",
    });
  }
});

export { router as adminPostRouter };

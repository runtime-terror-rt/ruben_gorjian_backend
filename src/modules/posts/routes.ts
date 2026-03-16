import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { PostService } from "./service";
import { SocialPlatform, PostStatus } from "@prisma/client";
import { logger } from "../../lib/logger";
import { ProviderRoutingError } from "../social/provider-routing";

const router = express.Router();
const postService = new PostService();

// List posts with cursor pagination
router.get("/", requireAuth, async (req, res) => {
  const schema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    status: z.string().optional().transform((str) =>
      str ? (str.split(",") as PostStatus[]) : undefined
    ),
    q: z.string().optional(),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid filters", details: parsed.error.flatten() });
  }

  try {
    const result = await postService.listPosts(req.user!.id, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      status: parsed.data.status,
      search: parsed.data.q,
    });
    return res.json(result);
  } catch (error) {
    logger.error("Error fetching posts list", error);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Get calendar posts for date range
router.get("/calendar", requireAuth, async (req, res) => {
  const schema = z.object({
    startDate: z.string().transform(str => new Date(str)),
    endDate: z.string().transform(str => new Date(str))
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid date range", details: parsed.error.flatten() });
  }

  try {
    const posts = await postService.getCalendarPosts(
      req.user!.id,
      parsed.data.startDate,
      parsed.data.endDate
    );
    return res.json({ posts });
  } catch (error) {
    logger.error("Error fetching calendar posts", error);
    return res.status(500).json({ error: "Failed to fetch calendar posts" });
  }
});

// Get a single post by id
router.get("/:postId", requireAuth, async (req, res) => {
  try {
    const post = await postService.getPost(req.user!.id, req.params.postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    return res.json({ post });
  } catch (error) {
    logger.error("Error fetching post", error);
    return res.status(500).json({ error: "Failed to fetch post" });
  }
});

// Create new post
router.post("/", requireAuth, async (req, res) => {
  const schema = z.object({
    assetId: z.string().optional(),
    assetIds: z.array(z.string()).optional(),
    contentItemId: z.string().optional(),
    caption: z.string().min(1),
    hashtags: z.array(z.string().min(1)).max(30).optional(),
    scheduledFor: z.string().transform(str => new Date(str)).optional(),
    platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])),
    socialAccountIds: z.array(z.string()).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid post data", details: parsed.error.flatten() });
  }

  try {
    const result = await postService.createPost(req.user!.id, parsed.data);
    return res.status(201).json(result);
  } catch (error) {
    logger.error("Error creating post", error);
    if (error instanceof ProviderRoutingError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to create post";
    // Return 400 for validation errors so clients can show them as user-facing messages
    const validationMessages = [
      "Instagram only supports a single media file",
      "Instagram requires media",
      "No social accounts found for the specified platforms",
      "Media storage is not configured",
    ];
    const isValidationError = validationMessages.some((m) => message.includes(m));
    return res.status(isValidationError ? 400 : 500).json({ error: message });
  }
});

// Update existing post
router.put("/:postId", requireAuth, async (req, res) => {
  const schema = z.object({
    assetId: z.string().optional(),
    assetIds: z.array(z.string()).optional(),
    contentItemId: z.string().optional(),
    caption: z.string().min(1).optional(),
    hashtags: z.array(z.string().min(1)).max(30).optional(),
    scheduledFor: z.string().transform(str => new Date(str)).optional(),
    platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])).optional(),
    socialAccountIds: z.array(z.string()).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid update data", details: parsed.error.flatten() });
  }

  try {
    const post = await postService.updatePost(req.user!.id, req.params.postId, parsed.data);
    return res.json({ post });
  } catch (error) {
    logger.error("Error updating post", error);
    if (error instanceof ProviderRoutingError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }
    const message = error instanceof Error ? error.message : "Failed to update post";
    const validationMessages = [
      "Instagram only supports a single media file",
      "Instagram requires media",
      "No social accounts found for the specified platforms",
      "Media storage is not configured",
    ];
    const isValidationError = validationMessages.some((m) => message.includes(m));
    return res.status(isValidationError ? 400 : 500).json({ error: message });
  }
});

// Delete post
router.delete("/:postId", requireAuth, async (req, res) => {
  try {
    await postService.deletePost(req.user!.id, req.params.postId);
    return res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting post", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to delete post" 
    });
  }
});

// Schedule post (change from draft to scheduled)
router.post("/:postId/schedule", requireAuth, async (req, res) => {
  try {
    await postService.schedulePost(req.user!.id, req.params.postId);
    return res.json({ success: true });
  } catch (error) {
    logger.error("Error scheduling post", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to schedule post" 
    });
  }
});

// Publish post immediately (for testing)
router.post("/:postId/publish", requireAuth, async (req, res) => {
  try {
    const result = await postService.publishPost(req.params.postId);
    return res.json(result);
  } catch (error) {
    logger.error("Error publishing post", error);
    if (error instanceof ProviderRoutingError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to publish post" 
    });
  }
});

// Get due scheduled posts (for scheduler worker)
router.get("/due", requireAuth, requireAdmin, async (req, res) => {
  try {
    const postIds = await postService.getDueScheduledPosts();
    return res.json({ postIds });
  } catch (error) {
    logger.error("Error fetching due posts", error);
    return res.status(500).json({ error: "Failed to fetch due posts" });
  }
});

// Get post with detailed target errors (for user-facing error display)
router.get("/:postId/errors", requireAuth, async (req, res) => {
  try {
    const post = await postService.getPostWithErrors(req.user!.id, req.params.postId);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    return res.json({ post });
  } catch (error) {
    logger.error("Error fetching post errors", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to fetch post errors" 
    });
  }
});

export { router as postsRouter };

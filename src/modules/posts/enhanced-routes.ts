import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { EnhancedPostService } from "./enhanced-service";
import { SocialPlatform, PostStatus } from "@prisma/client";
import { logger } from "../../lib/logger";

const router = express.Router();
const postService = new EnhancedPostService();

// Enhanced calendar endpoint with filters
router.get("/calendar/enhanced", requireAuth, async (req, res) => {
  const schema = z.object({
    startDate: z.string().transform(str => new Date(str)),
    endDate: z.string().transform(str => new Date(str)),
    platforms: z.string().optional().transform(str => 
      str ? str.split(",") as SocialPlatform[] : undefined
    ),
    status: z.string().optional().transform(str => 
      str ? str.split(",") as PostStatus[] : undefined
    ),
    tags: z.string().optional().transform(str => 
      str ? str.split(",") : undefined
    )
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid filters", details: parsed.error.flatten() });
  }

  try {
    const posts = await postService.getCalendarPosts(req.user!.id, parsed.data);
    return res.json({ posts });
  } catch (error) {
    logger.error("Error fetching enhanced calendar", error);
    return res.status(500).json({ error: "Failed to fetch calendar posts" });
  }
});

// Duplicate post
router.post("/:postId/duplicate", requireAuth, async (req, res) => {
  const schema = z.object({
    scheduledFor: z.string().optional().transform(str => str ? new Date(str) : undefined)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    const result = await postService.duplicatePost(
      req.user!.id, 
      req.params.postId, 
      parsed.data.scheduledFor
    );
    return res.status(201).json(result);
  } catch (error) {
    logger.error("Error duplicating post", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to duplicate post" 
    });
  }
});

// Move post to new time slot
router.put("/:postId/move", requireAuth, async (req, res) => {
  const schema = z.object({
    scheduledFor: z.string().transform(str => new Date(str))
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid date", details: parsed.error.flatten() });
  }

  try {
    const post = await postService.movePost(
      req.user!.id, 
      req.params.postId, 
      parsed.data.scheduledFor
    );
    return res.json({ post });
  } catch (error) {
    logger.error("Error moving post", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to move post" 
    });
  }
});

// Find optimal time slot
router.post("/find-slot", requireAuth, async (req, res) => {
  const schema = z.object({
    platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])),
    duration: z.number().optional().default(60)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    const optimalTime = await postService.findOptimalTimeSlot(
      req.user!.id, 
      parsed.data.platforms,
      parsed.data.duration
    );
    return res.json({ scheduledFor: optimalTime });
  } catch (error) {
    logger.error("Error finding optimal slot", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to find optimal time slot" 
    });
  }
});

// Get post statistics
router.get("/statistics", requireAuth, async (req, res) => {
  const schema = z.object({
    startDate: z.string().optional().transform(str => str ? new Date(str) : undefined),
    endDate: z.string().optional().transform(str => str ? new Date(str) : undefined)
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid filters", details: parsed.error.flatten() });
  }

  try {
    const stats = await postService.getPostStatistics(req.user!.id, parsed.data);
    return res.json(stats);
  } catch (error) {
    logger.error("Error fetching statistics", error);
    return res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Bulk update post status
router.put("/bulk/status", requireAuth, async (req, res) => {
  const schema = z.object({
    postIds: z.array(z.string()).min(1),
    status: z.enum(["DRAFT", "SCHEDULED", "POSTED", "FAILED"])
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    await postService.bulkUpdateStatus(
      req.user!.id, 
      parsed.data.postIds, 
      parsed.data.status as PostStatus
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error("Error bulk updating status", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to update post status" 
    });
  }
});

// Create recurring post
router.post("/recurring", requireAuth, async (req, res) => {
  const schema = z.object({
    caption: z.string().min(1),
    scheduledFor: z.string().transform(str => new Date(str)),
    platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN"])),
    socialAccountIds: z.array(z.string()).min(1),
    intervalInDays: z.number().min(1),
    endDate: z.string().optional().transform(str => str ? new Date(str) : undefined),
    assetId: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
  }

  try {
    const posts = await postService.createRecurringPost(req.user!.id, parsed.data);
    return res.status(201).json({ posts: posts.length, created: posts });
  } catch (error) {
    logger.error("Error creating recurring posts", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to create recurring posts" 
    });
  }
});

export { router as enhancedPostsRouter };

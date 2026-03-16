import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { AICaptionService } from "./caption-service";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

const router = express.Router();
const captionService = new AICaptionService();

// Generate captions for an asset
router.post("/captions", requireAuth, async (req, res) => {
  const schema = z.object({
    assetId: z.string(),
    style: z.enum(["storytelling", "design-focused", "minimalist"]).optional(),
    platforms: z.array(z.string()).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  try {
    const captionData = await captionService.generateCaptions({
      ...parsed.data,
      userId: req.user!.id
    });

    // Save to database
    const contentItem = await captionService.saveContentItem(
      req.user!.id,
      parsed.data.assetId,
      captionData
    );

    return res.json({
      contentItemId: contentItem.id,
      ...captionData
    });
  } catch (error) {
    logger.error("Caption generation error", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to generate captions" 
    });
  }
});

// Get existing content item
router.get("/content/:contentItemId", requireAuth, async (req, res) => {
  try {
    const contentItem = await prisma.contentItem.findFirst({
      where: {
        id: String(req.params.contentItemId),
        userId: req.user!.id
      }
    });

    if (!contentItem) {
      return res.status(404).json({ error: "Content item not found" });
    }

    return res.json({
      id: contentItem.id,
      captions: Array.isArray(contentItem.captionVariants)
        ? contentItem.captionVariants
        : JSON.parse((contentItem.captionVariants as any) || "[]"),
      hashtags: Array.isArray(contentItem.hashtags)
        ? contentItem.hashtags
        : JSON.parse((contentItem.hashtags as any) || "[]"),
      ctas: Array.isArray(contentItem.ctas)
        ? contentItem.ctas
        : JSON.parse((contentItem.ctas as any) || "[]"),
      description: contentItem.shortDescription
    });
  } catch (error) {
    logger.error("Error fetching content item", error);
    return res.status(500).json({ error: "Failed to fetch content item" });
  }
});

// Legacy endpoint for backward compatibility
router.post("/caption", requireAuth, async (req, res) => {
  const schema = z.object({
    assetId: z.string(),
    brandProfileId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  try {
    const captionData = await captionService.generateCaptions({
      assetId: parsed.data.assetId,
      userId: req.user!.id
    });

    return res.json({
      status: "completed",
      ...captionData
    });
  } catch (error) {
    logger.error("Caption generation error", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to generate captions" 
    });
  }
});

export { router as aiRouter };

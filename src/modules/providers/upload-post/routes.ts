import express from "express";
import { env } from "../../../config/env";
import { UploadPostService } from "./service";
import { logger } from "../../../lib/logger";
import { requireAuth } from "../../../middleware/requireAuth";
import { requireAdmin } from "../../../middleware/requireAdmin";

const router = express.Router();
const uploadPostService = new UploadPostService();

router.get("/health", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const health = await uploadPostService.getHealthStatus();
    return res.status(health.ok ? 200 : 503).json(health);
  } catch (error) {
    logger.error("Upload-Post health check failed", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Upload-Post health check failed",
    });
  }
});

router.post("/webhook/:token", async (req, res) => {
  const token = req.params.token;
  if (!env.UPLOAD_POST_WEBHOOK_TOKEN || token !== env.UPLOAD_POST_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: "Unauthorized webhook token" });
  }

  try {
    await uploadPostService.processWebhook(req.body);
    return res.json({ ok: true });
  } catch (error) {
    logger.error("Upload-Post webhook processing failed", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

export { router as uploadPostProviderRouter };

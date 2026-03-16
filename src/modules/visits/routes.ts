import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";

const router = express.Router();

router.use(requireAuth);

router.get("/config", (_req, res) => {
  res.json({
    bookingUrl: env.CALENDLY_BOOKING_URL ?? null,
    apiConfigured: Boolean(env.CALENDLY_API_ENDPOINT),
  });
});

router.post("/schedule", async (req, res) => {
  const schema = z.object({
    scheduledAt: z.string().datetime(),
    timezone: z.string().min(1).max(100),
    notes: z.string().max(1000).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (!env.CALENDLY_API_ENDPOINT) {
    return res.status(503).json({ error: "Calendly endpoint not configured" });
  }

  const userId = req.user!.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      profile: { select: { fullName: true, businessName: true } },
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const payload = {
    scheduledAt: parsed.data.scheduledAt,
    timezone: parsed.data.timezone,
    notes: parsed.data.notes ?? "",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.profile?.fullName ?? "",
      businessName: user.profile?.businessName ?? "",
    },
    source: "talexia",
  };

  try {
    const response = await fetch(env.CALENDLY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.CALENDLY_API_TOKEN ? { Authorization: `Bearer ${env.CALENDLY_API_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    if (!response.ok) {
      logger.error("Calendly scheduling request failed", {
        userId,
        status: response.status,
        response: data,
      });
      return res.status(502).json({
        error: "Failed to schedule visit",
        details: typeof data === "string" ? data : data ?? null,
      });
    }

    return res.json({
      success: true,
      bookingUrl: env.CALENDLY_BOOKING_URL ?? null,
      calendly: data,
    });
  } catch (error) {
    logger.error("Calendly scheduling request error", { userId, error });
    return res.status(500).json({ error: "Unable to schedule visit" });
  }
});

export { router as visitsRouter };

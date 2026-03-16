import express from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { sendContactEmail } from "./email";

const router = express.Router();

export const contactPayloadSchema = z.object({
  fullName: z.string().min(1),
  businessName: z.string().min(1),
  email: z.string().email(),
  websiteOrHandle: z.string().trim().optional().nullable(),
  interests: z
    .array(z.enum(["calendar", "ai-visuals", "full-management", "guidance"]))
    .optional()
    .default([]),
  postsPerMonth: z
    .enum(["10", "20", "40", "60", "100", "not-sure"])
    .optional()
    .nullable(),
  message: z.string().trim().optional().nullable(),
  source: z.string().trim().optional().nullable(),
});

router.post("/", async (req, res) => {
  const parsed = contactPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { fullName, businessName, email, websiteOrHandle, interests, postsPerMonth, message, source } =
    parsed.data;

  await prisma.contactSubmission.create({
    data: {
      fullName,
      businessName,
      email: email.toLowerCase(),
      websiteHandle: websiteOrHandle || undefined,
      interests: interests ?? [],
      postsPerMonth: postsPerMonth ?? undefined,
      message: message || undefined,
      source: source || undefined,
      createdIp: req.ip,
    },
  });

  // Optional email notification; skipped if SMTP env not set.
  await sendContactEmail({
    fullName,
    businessName,
    email,
    websiteOrHandle,
    interests,
    postsPerMonth,
    message,
    source,
  });

  return res.json({ success: true });
});

const newsletterSchema = z.object({
  email: z.string().email(),
});

router.post("/newsletter", async (req, res) => {
  const parsed = newsletterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Valid email is required" });
  }
  const email = parsed.data.email.toLowerCase();

  await prisma.contactSubmission.create({
    data: {
      fullName: "Newsletter",
      businessName: "Newsletter",
      email,
      source: "newsletter",
      interests: [],
      createdIp: req.ip,
    },
  });

  return res.json({ success: true });
});

export { router as contactRouter };

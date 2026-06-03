import express from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { sendContactEmail, sendConfirmationEmail, sendReplyNotificationEmail } from "./email";

const router = express.Router();

export const contactPayloadSchema = z.object({
  fullName: z.string().min(1),
  businessName: z.string().min(1),
  email: z.string().email(),
  websiteOrHandle: z.string().trim().optional().nullable(),
  interests: z
    .array(z.enum(["calendar", "ai-visuals", "full-management", "guidance", "others"]))
    .optional()
    .default([]),
  postsPerMonth: z
    .enum(["10", "20", "40", "60", "100", "not-sure"])
    .optional()
    .nullable(),
  message: z.string().trim().optional().nullable(),
  source: z.string().trim().optional().nullable(),
});

router.post("/submit-inquiry", async (req, res) => {
  const parsed = contactPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { fullName, businessName, email, websiteOrHandle, interests, postsPerMonth, message, source } =
    parsed.data;

  const submission = await prisma.contactSubmission.create({
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

  await sendConfirmationEmail({
    fullName,
    email,
  });

  return res.json({ success: true, data: { submissionId: submission.id } });
});

// router.get("/my-submissions", requireAuth, async (req, res) => {
//   const userEmail = (req.user as any).email;

//   const submissions = await prisma.contactSubmission.findMany({
//     where: { email: userEmail },
//     orderBy: { createdAt: "desc" },
//   });

//   return res.json({ success: true, data: submissions });
// });

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

router.get("/admin/submissions", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string | undefined;

    const where = {
      // source: "landing",
      ...(status ? { status } : {}),
    };

    const total = await prisma.contactSubmission.count({ where });
    const submissions = await prisma.contactSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      data: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        submissions,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/submissions/:id", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id as string },
    });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    return res.json({ success: true, data: submission });
  } catch (error) {
    return next(error);
  }
});

const replySchema = z.object({
  replyMessage: z.string().min(1),
});

router.patch("/admin/submissions/:id/reply", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id as string },
    });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const updated = await prisma.contactSubmission.update({
      where: { id: req.params.id as string },
      data: {
        replyMessage: parsed.data.replyMessage,
        repliedAt: new Date(),
        repliedBy: (req.user as any).id,
        status: "REPLIED",
      },
    });

    await sendReplyNotificationEmail({
      fullName: submission.fullName,
      email: submission.email,
      replyMessage: parsed.data.replyMessage,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

const statusSchema = z.object({
  status: z.enum(["PENDING", "REPLIED", "RESOLVED", "CLOSED"]),
});

router.patch("/admin/submissions/:id/status", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const submission = await prisma.contactSubmission.findUnique({
      where: { id: req.params.id as string },
    });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const isResolved = parsed.data.status === "RESOLVED" || parsed.data.status === "CLOSED";

    const updated = await prisma.contactSubmission.update({
      where: { id: req.params.id as string },
      data: {
        status: parsed.data.status,
        isResolved,
        resolvedAt: isResolved ? new Date() : null,
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

export { router as contactRouter };

import express from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";

const router = express.Router();

const caseStudyPayloadSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  summary: z.string().trim().min(1, "Summary is required"),
  content: z.string().trim().min(1, "Content is required"),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const caseStudyUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).optional(),
    displayOrder: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

// Get case studies - available for authenticated admins and users
router.get("/", requireAuth, async (_req, res) => {
  const items = await prisma.caseStudy.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });

  return res.json({ success: true, data: items });
});

// Create case study - admin only
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = caseStudyPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const item = await prisma.caseStudy.create({
    data: {
      title: parsed.data.title,
      summary: parsed.data.summary,
      content: parsed.data.content,
      displayOrder: parsed.data.displayOrder,
      isActive: parsed.data.isActive,
      createdByAdminId: req.user!.id,
      updatedByAdminId: req.user!.id,
    },
  });

  return res.status(201).json({ success: true, data: item });
});

// Update case study - admin only
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const caseStudyId = req.params.id as string;
  const parsed = caseStudyUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const existing = await prisma.caseStudy.findUnique({ where: { id: caseStudyId } });
  if (!existing) {
    return res.status(404).json({ error: "Case study not found" });
  }

  const item = await prisma.caseStudy.update({
    where: { id: caseStudyId },
    data: {
      ...parsed.data,
      updatedByAdminId: req.user!.id,
    },
  });

  return res.json({ success: true, data: item });
});

// Delete case study - admin only
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const caseStudyId = req.params.id as string;
  const existing = await prisma.caseStudy.findUnique({ where: { id: caseStudyId } });
  if (!existing) {
    return res.status(404).json({ error: "Case study not found" });
  }

  await prisma.caseStudy.delete({ where: { id: caseStudyId } });

  return res.json({ success: true });
});

export { router as caseStudiesRouter };

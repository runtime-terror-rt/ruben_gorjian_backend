import express from "express";
import { AuditAction, CouponStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";

const router = express.Router();

async function createCouponAuditLog(params: {
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: params.action,
      metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}

const applicablePlansSchema = z
  .array(z.string().trim().min(1).transform((plan) => plan.toUpperCase()))
  .max(20)
  .optional();

const applicablePlansUpdateSchema = z
  .union([z.array(z.string().trim().min(1).transform((plan) => plan.toUpperCase())).max(20), z.null()])
  .optional();

// GET /admin/coupons
router.get("/", async (req, res) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(String(page), 10));
    const parsedLimit = parseInt(String(limit), 10);
    const limitNum = Number.isNaN(parsedLimit) ? 20 : Math.min(100, Math.max(1, parsedLimit));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.CouponWhereInput = {};
    if (typeof status === "string" && status !== "all") {
      const normalizedStatus = status.toUpperCase();
      if (
        normalizedStatus === CouponStatus.ACTIVE ||
        normalizedStatus === CouponStatus.INACTIVE ||
        normalizedStatus === CouponStatus.EXPIRED
      ) {
        where.status = normalizedStatus;
      }
    }

    const [coupons, total] = await Promise.all([
      prisma.coupon.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, email: true } },
          _count: { select: { couponUsages: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.coupon.count({ where }),
    ]);

    return res.json({
      success: true,
      message: "Coupons fetched successfully",
      coupons: coupons.map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        maxUses: coupon.maxUses,
        usedCount: coupon.usedCount,
        maxUsesPerClient: coupon.maxUsesPerClient,
        status: coupon.status,
        description: coupon.description,
        expiresAt: coupon.expiresAt,
        applicablePlans: coupon.applicablePlans,
        createdBy: coupon.creator.name || coupon.creator.email,
        createdAt: coupon.createdAt,
        updatedAt: coupon.updatedAt,
        totalUsages: coupon._count.couponUsages,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch coupons", error: "Failed to fetch coupons" });
  }
});

// POST /admin/coupons
router.post("/", async (req, res) => {
  try {
    const schema = z.object({
      code: z.string().trim().min(3).max(50).transform((value) => value.toUpperCase()),
      discountType: z.enum(["fixed", "percentage"]),
      discountValue: z.number().positive(),
      maxUses: z.number().int().positive().nullable().optional(),
      maxUsesPerClient: z.number().int().positive().default(1),
      description: z.string().max(500).optional(),
      expiresAt: z.string().datetime().optional(),
      applicablePlans: applicablePlansSchema,
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload",
        error: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const adminId = req.user!.id;

    const existing = await prisma.coupon.findUnique({ where: { code: parsed.data.code } });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Coupon code already exists",
        error: "Coupon code already exists",
      });
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: parsed.data.code,
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue,
        maxUses: parsed.data.maxUses ?? null,
        maxUsesPerClient: parsed.data.maxUsesPerClient,
        description: parsed.data.description,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        applicablePlans: parsed.data.applicablePlans ?? [],
        createdBy: adminId,
      },
    });

    await createCouponAuditLog({
      actorId: adminId,
      actorEmail: req.user!.email,
      action: AuditAction.CREATE_USER,
      metadata: { couponCode: coupon.code, couponId: coupon.id },
    });

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxUses: coupon.maxUses,
      maxUsesPerClient: coupon.maxUsesPerClient,
      status: coupon.status,
      description: coupon.description,
      expiresAt: coupon.expiresAt,
      applicablePlans: coupon.applicablePlans,
      createdAt: coupon.createdAt,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create coupon", error: "Failed to create coupon" });
  }
});

// PUT /admin/coupons/:couponId
router.patch("/:couponId", async (req, res) => {
  try {
    const { couponId } = req.params;
    const schema = z.object({
      discountType: z.enum(["fixed", "percentage"]).optional(),
      discountValue: z.number().positive().optional(),
      maxUses: z.number().int().positive().nullable().optional(),
      maxUsesPerClient: z.number().int().positive().optional(),
      description: z.string().max(500).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      applicablePlans: applicablePlansUpdateSchema,
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload",
        error: "Invalid payload",
        details: parsed.error.flatten(),
      });
    }

    const adminId = req.user!.id;

    const coupon = await prisma.coupon.update({
      where: { id: couponId },
      data: {
        ...(parsed.data.discountType !== undefined && { discountType: parsed.data.discountType }),
        ...(parsed.data.discountValue !== undefined && { discountValue: parsed.data.discountValue }),
        ...(parsed.data.maxUses !== undefined && { maxUses: parsed.data.maxUses }),
        ...(parsed.data.maxUsesPerClient !== undefined && { maxUsesPerClient: parsed.data.maxUsesPerClient }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.expiresAt !== undefined && {
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        }),
        ...(parsed.data.applicablePlans !== undefined && {
          applicablePlans: parsed.data.applicablePlans ?? [],
        }),
      },
    });

    await createCouponAuditLog({
      actorId: adminId,
      actorEmail: req.user!.email,
      action: AuditAction.UPDATE_USER,
      metadata: { couponCode: coupon.code, couponId },
    });

    return res.json({
      success: true,
      message: "Coupon updated successfully",
      id: coupon.id,
      code: coupon.code,
      status: coupon.status,
      expiresAt: coupon.expiresAt,
      applicablePlans: coupon.applicablePlans,
      updatedAt: coupon.updatedAt,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return res.status(404).json({ success: false, message: "Coupon not found", error: "Coupon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to update coupon", error: "Failed to update coupon" });
  }
});

// PATCH /admin/coupons/:couponId/status
router.patch("/:couponId/status", async (req, res) => {
  try {
    const { couponId } = req.params;
    const schema = z.object({
      status: z.enum([CouponStatus.ACTIVE, CouponStatus.INACTIVE, CouponStatus.EXPIRED]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
        error: "Invalid status",
        details: parsed.error.flatten(),
      });
    }

    const adminId = req.user!.id;

    const coupon = await prisma.coupon.update({
      where: { id: couponId },
      data: {
        status: parsed.data.status,
      },
    });

    await createCouponAuditLog({
      actorId: adminId,
      actorEmail: req.user!.email,
      action: AuditAction.UPDATE_USER,
      metadata: { couponCode: coupon.code, newStatus: parsed.data.status },
    });

    return res.json({
      success: true,
      message: "Coupon status updated successfully",
      id: coupon.id,
      code: coupon.code,
      status: coupon.status,
      updatedAt: coupon.updatedAt,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return res.status(404).json({ success: false, message: "Coupon not found", error: "Coupon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to update coupon status", error: "Failed to update coupon status" });
  }
});

// GET /admin/coupons/:couponId/usages
router.get("/:couponId/usages", async (req, res) => {
  try {
    const { couponId } = req.params;
    const { page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(String(page), 10));
    const parsedLimit = parseInt(String(limit), 10);
    const limitNum = Number.isNaN(parsedLimit) ? 20 : Math.min(100, Math.max(1, parsedLimit));
    const skip = (pageNum - 1) * limitNum;

    const [usages, total, coupon] = await Promise.all([
      prisma.couponUsage.findMany({
        where: { couponId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { usedAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.couponUsage.count({ where: { couponId } }),
      prisma.coupon.findUnique({
        where: { id: couponId },
        select: { code: true, usedCount: true, maxUses: true },
      }),
    ]);

    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found", error: "Coupon not found" });
    }

    return res.json({
      success: true,
      message: "Coupon usages fetched successfully",
      coupon: {
        code: coupon.code,
        usedCount: coupon.usedCount,
        maxUses: coupon.maxUses,
      },
      usages: usages.map((usage) => ({
        id: usage.id,
        userId: usage.user.id,
        userName: usage.user.name,
        userEmail: usage.user.email,
        usedAt: usage.usedAt,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch coupon usages", error: "Failed to fetch coupon usages" });
  }
});

// DELETE /admin/coupons/:couponId
router.delete("/:couponId", async (req, res) => {
  try {
    const { couponId } = req.params;
    const adminId = req.user!.id;

    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found", error: "Coupon not found" });
    }

    await prisma.coupon.delete({ where: { id: couponId } });

    await createCouponAuditLog({
      actorId: adminId,
      actorEmail: req.user!.email,
      action: AuditAction.DELETE_USER,
      metadata: { couponCode: coupon.code, couponId },
    });

    return res.json({ success: true, message: "Coupon deleted successfully", id: couponId });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return res.status(404).json({ success: false, message: "Coupon not found", error: "Coupon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to delete coupon", error: "Failed to delete coupon" });
  }
});

export { router as adminCouponRouter };

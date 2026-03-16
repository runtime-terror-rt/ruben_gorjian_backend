import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { handleError, Errors } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import {
  getAllSubmissions,
  updateSubmissionStatus,
  getSubmissionById,
  validateEnhancedDeliveryFile,
  generateEnhancedPresignedUpload,
  createEnhancedDelivery,
  addEnhancedDeliveryFiles,
  getEnhancedDeliveriesForSubmission,
} from "./service";
import { notifySubmissionStatusUpdated, notifyEnhancedDeliverySent } from "../notifications/service";
import { prisma } from "../../lib/prisma";
import { getActiveSubscription } from "../billing/subscription-service";
import {
  consumeSubmissionQuota,
  releaseSubmissionQuota,
} from "./quota-service";

const router = express.Router();

async function applyQuotaForStatusChange(params: {
  submissionId: string;
  userId: string;
  previousStatus: string;
  nextStatus: string;
}) {
  const { submissionId, userId, previousStatus, nextStatus } = params;
  if (previousStatus === nextStatus) return;

  const subscription = await getActiveSubscription(userId);
  if (!subscription) return;

  if (nextStatus === "ENHANCED_SENT" || nextStatus === "COMPLETED") {
    await prisma.$transaction(async (tx) => {
      await consumeSubmissionQuota(tx, {
        submissionId,
        userId,
        subscription,
      });
    });
  }

  if (nextStatus === "REJECTED" || nextStatus === "CLOSED") {
    await prisma.$transaction(async (tx) => {
      await releaseSubmissionQuota(tx, {
        submissionId,
        userId,
        subscription,
      });
    });
  }
}

// All routes require auth and admin access
router.use(requireAuth);
router.use(requireAdmin);

/**
 * GET /api/admin/submissions
 * Get all submissions with filters
 */
router.get("/", async (req, res) => {
  try {
    const schema = z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "ENHANCED_SENT", "NEEDS_CHANGES", "CLOSED", "COMPLETED", "REJECTED"]).optional(),
      userId: z.string().optional(),
      planCategory: z.enum(["FULL_MANAGEMENT", "VISUAL_ONLY"]).optional(),
      search: z.string().optional(),
      sort: z.enum(["date", "user", "status"]).optional(),
      order: z.enum(["asc", "desc"]).optional(),
      limit: z.coerce.number().positive().max(100).optional(),
      offset: z.coerce.number().nonnegative().optional(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid query parameters", parsed.error.flatten());
    }

    const { submissions, total } = await getAllSubmissions(parsed.data);

    return res.json({
      submissions: submissions.map((s) => ({
        id: s.id,
        status: s.status,
        planCategory: s.planCategory,
        user: {
          id: s.user.id,
          email: s.user.email,
          name: s.user.name,
        },
        userNote: s.userNote,
        adminNote: s.adminNote,
        fileCount: s.files.length,
        files: s.files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          fileSize: f.fileSize,
        })),
        latestEvent: s.events[0]
          ? {
              status: s.events[0].status,
              note: s.events[0].note,
              createdAt: s.events[0].createdAt,
            }
          : null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total,
      limit: parsed.data.limit || 50,
      offset: parsed.data.offset || 0,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * GET /api/admin/submissions/:id/enhanced-deliveries
 * List enhanced deliveries for a submission (admin view)
 */
router.get("/:id/enhanced-deliveries", async (req, res) => {
  try {
    const submissionId = req.params.id;
    const submission = await getSubmissionById(submissionId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }
    const previousStatus = submission.status;

    const deliveries = await getEnhancedDeliveriesForSubmission(submissionId);
    return res.json({
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        message: delivery.message,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        admin: delivery.admin,
        files: delivery.files.map((file) => ({
          id: file.id,
          storageKey: file.storageKey,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
          createdAt: file.createdAt,
        })),
      })),
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /api/admin/submissions/:id/enhanced-deliveries
 * Create enhanced delivery and return presigned upload URLs
 */
router.post("/:id/enhanced-deliveries", async (req, res) => {
  try {
    const schema = z.object({
      message: z.string().optional(),
      files: z.array(
        z.object({
          fileName: z.string().min(1).max(255),
          mimeType: z.string(),
          size: z.number().positive(),
        })
      ).min(1).max(10),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid payload", parsed.error.flatten());
    }

    const submissionId = req.params.id;
    const adminId = req.user!.id;

    const submission = await getSubmissionById(submissionId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }
    const previousStatus = submission.status;

    for (const file of parsed.data.files) {
      const validation = validateEnhancedDeliveryFile(file);
      if (!validation.valid) {
        throw Errors.badRequest("File validation failed", {
          message: validation.error,
          fileName: file.fileName,
        });
      }
    }

    const delivery = await createEnhancedDelivery(submissionId, adminId, parsed.data.message);

    const uploadUrls = await Promise.all(
      parsed.data.files.map(async (file) => {
        const presigned = await generateEnhancedPresignedUpload(submissionId, adminId, file);
        return {
          fileId: presigned.fileId,
          fileName: file.fileName,
          uploadUrl: presigned.uploadUrl,
          storageKey: presigned.storageKey,
        };
      })
    );

    return res.status(201).json({
      delivery: {
        id: delivery.id,
        submissionId: delivery.submissionId,
        message: delivery.message,
        createdAt: delivery.createdAt,
      },
      uploadUrls,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /api/admin/submissions/:id/enhanced-deliveries/:deliveryId/complete
 * Confirm enhanced delivery uploads and update submission status
 */
router.post("/:id/enhanced-deliveries/:deliveryId/complete", async (req, res) => {
  try {
    const schema = z.object({
      files: z.array(
        z.object({
          fileName: z.string().min(1).max(255),
          mimeType: z.string(),
          size: z.number().positive(),
          storageKey: z.string().min(1),
        })
      ).min(1).max(10),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid payload", parsed.error.flatten());
    }

    const submissionId = req.params.id;
    const deliveryId = req.params.deliveryId;
    const adminId = req.user!.id;

    const submission = await getSubmissionById(submissionId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }
    const previousStatus = submission.status;

    const delivery = await prisma.enhancedDelivery.findFirst({
      where: { id: deliveryId, submissionId },
    });
    if (!delivery) {
      throw Errors.notFound("Enhanced delivery");
    }

    const expectedPrefix = `submissions/${submissionId}/enhanced/${delivery.adminId}/`;
    const seenStorageKeys = new Set<string>();

    for (const file of parsed.data.files) {
      const validation = validateEnhancedDeliveryFile(file);
      if (!validation.valid) {
        throw Errors.badRequest("File validation failed", {
          message: validation.error,
          fileName: file.fileName,
        });
      }

      if (!file.storageKey.startsWith(expectedPrefix)) {
        throw Errors.badRequest("Invalid storage key", {
          fileName: file.fileName,
        });
      }

      if (seenStorageKeys.has(file.storageKey)) {
        throw Errors.badRequest("Duplicate storage key in request", {
          fileName: file.fileName,
        });
      }
      seenStorageKeys.add(file.storageKey);
    }

    await addEnhancedDeliveryFiles(deliveryId, parsed.data.files);

    await updateSubmissionStatus(submissionId, "ENHANCED_SENT", undefined, adminId);

    await applyQuotaForStatusChange({
      submissionId,
      userId: submission.userId,
      previousStatus,
      nextStatus: "ENHANCED_SENT",
    });

    await prisma.submissionEvent.create({
      data: {
        submissionId,
        status: "ENHANCED_SENT",
        action: "ENHANCED_DELIVERY_SENT",
        actorRole: "ADMIN",
        createdBy: adminId,
        metadataJson: {
          enhancedDeliveryId: deliveryId,
          fileCount: parsed.data.files.length,
        },
      },
    });

    const submissionWithUser = await getSubmissionById(submissionId);
    if (submissionWithUser) {
      notifyEnhancedDeliverySent(submissionWithUser, delivery, parsed.data.files.length).catch((error) => {
        logger.error("Failed to send enhanced delivery notifications", { error, submissionId, deliveryId });
      });
    }

    return res.json({ success: true });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * GET /api/admin/submissions/:id
 * Get a specific submission with full details (admin view)
 */
router.get("/:id", async (req, res) => {
  try {
    const submissionId = req.params.id;

    // Admin can view any submission, so we fetch without userId filter
    const submission = await getSubmissionById(submissionId);

    if (!submission) {
      throw Errors.notFound("Submission");
    }

    return res.json({
      submission: {
        id: submission.id,
        status: submission.status,
        planCategory: submission.planCategory,
        quotaUnitsReserved: submission.quotaUnitsReserved,
        quotaUnitsConsumed: submission.quotaUnitsConsumed,
        userId: submission.userId,
        user: {
          id: submission.user.id,
          email: submission.user.email,
          name: submission.user.name,
        },
        userNote: submission.userNote,
        adminNote: submission.adminNote,
        files: submission.files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          fileSize: f.fileSize,
          storageKey: f.storageKey,
          createdAt: f.createdAt,
        })),
        events: submission.events.map((e) => ({
          id: e.id,
          status: e.status,
          note: e.note,
          createdBy: e.createdBy,
          createdAt: e.createdAt,
        })),
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt,
      },
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * PATCH /api/admin/submissions/:id
 * Update submission status and add admin note
 */
router.patch("/:id", async (req, res) => {
  try {
    const schema = z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "ENHANCED_SENT", "NEEDS_CHANGES", "CLOSED", "COMPLETED", "REJECTED"]),
      adminNote: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid payload", parsed.error.flatten());
    }

    const submissionId = req.params.id;
    const adminId = req.user!.id;

    // Get current status before update
    const currentSubmission = await getSubmissionById(submissionId);
    if (!currentSubmission) {
      throw Errors.notFound("Submission");
    }
    
    const previousStatus = currentSubmission.status;

    const submission = await updateSubmissionStatus(
      submissionId,
      parsed.data.status,
      parsed.data.adminNote,
      adminId
    );

    logger.info(
      `Admin ${adminId} updated submission ${submissionId} to status ${parsed.data.status}`
    );

    // Send notifications (async, don't block response)
    if (previousStatus !== parsed.data.status) {
      await applyQuotaForStatusChange({
        submissionId,
        userId: submission.userId,
        previousStatus,
        nextStatus: parsed.data.status,
      });

      const submissionWithUser = await getSubmissionById(submissionId);
      if (submissionWithUser) {
        notifySubmissionStatusUpdated(submissionWithUser, previousStatus).catch((error) => {
          logger.error("Failed to send status update notifications", { error, submissionId });
        });
      }
    }

    return res.json({
      submission: {
        id: submission.id,
        status: submission.status,
        adminNote: submission.adminNote,
        updatedAt: submission.updatedAt,
      },
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * GET /api/admin/submissions/:id/files/:fileId/download
 * Generate presigned download URL for a submission file
 */
router.get("/:id/files/:fileId/download", async (req, res) => {
  try {
    const { id: submissionId, fileId } = req.params;

    // Get submission and verify file exists
    const submission = await getSubmissionById(submissionId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }

    const file = submission.files.find((f) => f.id === fileId);
    if (!file) {
      throw Errors.notFound("File");
    }

    // If S3 is not configured, return stub
    if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn("S3 not configured; cannot generate download URL");
      return res.json({
        downloadUrl: null,
        fileName: file.fileName,
        message: "S3 not configured",
      });
    }

    // Sanitize filename for download header to prevent header injection
    const safeFilename = file.fileName
      .replace(/[^a-zA-Z0-9._\-\s]/g, '') // Keep only safe characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 255); // Limit length

    // Generate presigned download URL
    const s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: file.storageKey,
      ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return res.json({
      downloadUrl,
      fileName: file.fileName,
      fileSize: file.fileSize,
      expiresIn: 3600,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

export default router;

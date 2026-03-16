import express from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { requireVisualSubmissionAccess } from "../../middleware/requireVisualSubmissionAccess";
import { submissionRateLimiter, fileUploadRateLimiter } from "../../middleware/rateLimiter";
import { handleError, Errors } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  validateSubmissionFile,
  generatePresignedUpload,
  addFileToSubmission,
  createSubmissionWithQuota,
  getUserSubmissions,
  getSubmissionById,
  getEnhancedDeliveriesForSubmission,
} from "./service";
import { notifySubmissionCreated } from "../notifications/service";
import {
  adjustSubmissionReservation,
  getVisualQuotaSnapshot,
  mapSubmissionPlanCategory,
  reserveVisualQuota,
} from "./quota-service";

const router = express.Router();
const MAX_SUBMISSION_FILES = 10;

// All routes require auth and Full Management plan
router.use(requireAuth);
router.use(requireVisualSubmissionAccess);

router.get("/quota", async (req, res) => {
  try {
    const subscription = req.subscription;
    if (!subscription) {
      throw Errors.forbidden("Active subscription required");
    }

    const snapshot = await getVisualQuotaSnapshot(req.user!.id, subscription);
    return res.json({
      quota: {
        ...snapshot,
        canSubmit: snapshot.remaining > 0,
      },
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /api/submissions
 * Create a new submission with presigned upload URLs for files
 */
router.post("/", submissionRateLimiter, async (req, res) => {
  try {
    const schema = z.object({
      userNote: z.string().optional(),
      files: z.array(
        z.object({
          fileName: z.string().min(1).max(255),
          fileType: z.string(),
          fileSize: z.number().positive(),
        })
      ).min(1).max(10), // Max 10 files per submission
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid payload", parsed.error.flatten());
    }

    const { userNote, files } = parsed.data;
    const userId = req.user!.id;

    // Validate all files first
    for (const file of files) {
      const validation = validateSubmissionFile(file);
      if (!validation.valid) {
        throw Errors.badRequest("File validation failed", {
          message: validation.error,
          fileName: file.fileName,
        });
      }
    }

    const subscription = req.subscription;
    if (!subscription) {
      throw Errors.forbidden("Active subscription required");
    }

    const planCategory = mapSubmissionPlanCategory(subscription.plan.category);
    const unitsRequested = files.length;

    const submission = await prisma.$transaction(async (tx) => {
      const created = await createSubmissionWithQuota(tx, {
        userId,
        userNote,
        planCategory,
        quotaUnitsReserved: unitsRequested,
      });

      await reserveVisualQuota(tx, {
        userId,
        subscription,
        units: unitsRequested,
        submissionId: created.id,
      });

      return created;
    });

    // Generate presigned URLs for each file
    const uploadUrls = await Promise.all(
      files.map(async (file) => {
        const presigned = await generatePresignedUpload(userId, file);
        return {
          fileId: presigned.fileId,
          fileName: file.fileName,
          uploadUrl: presigned.uploadUrl,
          storageKey: presigned.storageKey,
        };
      })
    );

    logger.info(`Created submission ${submission.id} for user ${userId} with ${files.length} files`);

    return res.status(201).json({
      submission: {
        id: submission.id,
        status: submission.status,
        createdAt: submission.createdAt,
      },
      uploadUrls,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /api/submissions/:id/files/complete
 * Confirm file upload and store metadata
 */
router.post("/:id/files/complete", fileUploadRateLimiter, async (req, res) => {
  try {
    const schema = z.object({
      files: z.array(
        z.object({
          fileName: z.string().min(1).max(255),
          fileType: z.string(),
          fileSize: z.number().positive(),
          storageKey: z.string().min(1),
        })
      ).min(1).max(MAX_SUBMISSION_FILES),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid payload", parsed.error.flatten());
    }

    const submissionId = req.params.id;
    const userId = req.user!.id;

    // Verify submission belongs to user
    const submission = await getSubmissionById(submissionId, userId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }

    if (submission.status !== "SUBMITTED") {
      throw Errors.badRequest("Submission is not accepting new files", {
        status: submission.status,
      });
    }

    const totalAfterUpload = submission.files.length + parsed.data.files.length;
    if (totalAfterUpload > MAX_SUBMISSION_FILES) {
      throw Errors.badRequest(`Maximum ${MAX_SUBMISSION_FILES} files allowed per submission`);
    }

    const expectedPrefix = `submissions/${userId}/`;
    const seenStorageKeys = new Set<string>();
    for (const file of parsed.data.files) {
      const validation = validateSubmissionFile(file);
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

    const subscription = req.subscription;
    if (!subscription) {
      throw Errors.forbidden("Active subscription required");
    }

    const files = await prisma.$transaction(async (tx) => {
      const createdFiles = await Promise.all(
        parsed.data.files.map((file) => addFileToSubmission(submissionId, file, tx))
      );

      await adjustSubmissionReservation(tx, {
        submissionId,
        userId,
        subscription,
        targetUnits: totalAfterUpload,
      });

      return createdFiles;
    });

    logger.info(`Completed file uploads for submission ${submissionId}`);

    // Fetch submission with user details for notifications
    const submissionWithUser = await getSubmissionById(submissionId, userId);
    
    // Send notifications (async, don't block response)
    if (submissionWithUser) {
      notifySubmissionCreated(submissionWithUser).catch((error) => {
        logger.error("Failed to send submission notifications", { error, submissionId });
      });
    }

    return res.json({
      success: true,
      files: files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSize: f.fileSize,
      })),
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * POST /api/submissions/:id/presign-single
 * Generate a new presigned upload URL for retrying a file upload
 */
router.post("/:id/presign-single", fileUploadRateLimiter, async (req, res) => {
  try {
    const schema = z.object({
      files: z.array(
        z.object({
          fileName: z.string().min(1).max(255),
          fileType: z.string(),
          fileSize: z.number().positive(),
        })
      ).min(1).max(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid payload", parsed.error.flatten());
    }

    const submissionId = req.params.id;
    const userId = req.user!.id;

    // Verify submission belongs to user
    const submission = await getSubmissionById(submissionId, userId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }

    if (submission.status !== "SUBMITTED") {
      throw Errors.badRequest("Submission is not accepting new files", {
        status: submission.status,
      });
    }

    const files = parsed.data.files;
    for (const file of files) {
      const validation = validateSubmissionFile(file);
      if (!validation.valid) {
        throw Errors.badRequest("File validation failed", {
          message: validation.error,
          fileName: file.fileName,
        });
      }
    }

    const uploadUrls = await Promise.all(
      files.map(async (file) => {
        const presigned = await generatePresignedUpload(userId, file);
        return {
          fileId: presigned.fileId,
          uploadUrl: presigned.uploadUrl,
          storageKey: presigned.storageKey,
        };
      })
    );

    return res.json({ uploadUrls });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * GET /api/submissions
 * Get all submissions for the current user
 */
router.get("/", async (req, res) => {
  try {
    const schema = z.object({
      limit: z.coerce.number().positive().max(100).optional(),
      offset: z.coerce.number().nonnegative().optional(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw Errors.badRequest("Invalid query parameters", parsed.error.flatten());
    }

    const userId = req.user!.id;
    const { submissions, total } = await getUserSubmissions(userId, parsed.data);

    return res.json({
      submissions: submissions.map((s) => ({
        id: s.id,
        status: s.status,
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
 * GET /api/submissions/:id
 * Get a specific submission with full details
 */
router.get("/:id", async (req, res) => {
  try {
    const submissionId = req.params.id;
    const userId = req.user!.id;

    const submission = await getSubmissionById(submissionId, userId);

    if (!submission) {
      throw Errors.notFound("Submission");
    }

    return res.json({
      submission: {
        id: submission.id,
        status: submission.status,
        userNote: submission.userNote,
        adminNote: submission.adminNote,
        files: submission.files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          fileSize: f.fileSize,
          createdAt: f.createdAt,
        })),
        events: submission.events.map((e) => ({
          id: e.id,
          status: e.status,
          note: e.note,
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
 * GET /api/submissions/:id/enhanced-deliveries
 * List enhanced deliveries for the current user
 */
router.get("/:id/enhanced-deliveries", async (req, res) => {
  try {
    const submissionId = req.params.id;
    const userId = req.user!.id;

    const submission = await getSubmissionById(submissionId, userId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }

    const deliveries = await getEnhancedDeliveriesForSubmission(submissionId);
    return res.json({
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        message: delivery.message,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        admin: delivery.admin ? { id: delivery.admin.id, email: delivery.admin.email, name: delivery.admin.name } : null,
        files: delivery.files.map((file) => ({
          id: file.id,
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
 * GET /api/submissions/:id/enhanced-deliveries/:deliveryId/files/:fileId/download
 * Generate signed URL for enhanced delivery files (user view)
 */
router.get("/:id/enhanced-deliveries/:deliveryId/files/:fileId/download", async (req, res) => {
  try {
    const { id: submissionId, deliveryId, fileId } = req.params;
    const userId = req.user!.id;

    const submission = await getSubmissionById(submissionId, userId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }

    const delivery = await prisma.enhancedDelivery.findFirst({
      where: { id: deliveryId, submissionId },
      include: { files: true },
    });
    if (!delivery) {
      throw Errors.notFound("Enhanced delivery");
    }

    const file = delivery.files.find((f) => f.id === fileId);
    if (!file) {
      throw Errors.notFound("File");
    }

    if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn("S3 not configured; cannot generate download URL");
      return res.json({
        downloadUrl: null,
        fileName: file.fileName,
        message: "S3 not configured",
      });
    }

    const safeFilename = file.fileName
      .replace(/[^a-zA-Z0-9._\-\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 255);

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
      ResponseContentDisposition: `inline; filename="${safeFilename}"`,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    return res.json({
      downloadUrl,
      fileName: file.fileName,
      fileSize: file.size,
      expiresIn: 900,
    });
  } catch (error) {
    return handleError(error, res);
  }
});

/**
 * GET /api/submissions/:id/files/:fileId/download
 * Generate presigned download URL for a submission file (user view)
 */
router.get("/:id/files/:fileId/download", async (req, res) => {
  try {
    const { id: submissionId, fileId } = req.params;
    const userId = req.user!.id;

    const submission = await getSubmissionById(submissionId, userId);
    if (!submission) {
      throw Errors.notFound("Submission");
    }

    if (submission.status !== "COMPLETED") {
      throw Errors.badRequest("Submission is not completed yet", {
        status: submission.status,
      });
    }

    const file = submission.files.find((f) => f.id === fileId);
    if (!file) {
      throw Errors.notFound("File");
    }

    if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn("S3 not configured; cannot generate download URL");
      return res.json({
        downloadUrl: null,
        fileName: file.fileName,
        message: "S3 not configured",
      });
    }

    const safeFilename = file.fileName
      .replace(/[^a-zA-Z0-9._\-\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 255);

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

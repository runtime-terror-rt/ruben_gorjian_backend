import { Prisma, SubmissionPlanCategory } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";

// Allowed file types for submissions
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "video/mp4",
];

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".mp4"];

const ENHANCED_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

const ENHANCED_ALLOWED_EXTENSIONS = [".pdf", ".zip", ".docx", ".doc", ".jpg", ".jpeg", ".png"];

// Max file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

interface FileUploadRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface PresignedUploadResponse {
  fileId: string;
  uploadUrl: string | null;
  storageKey: string;
}

interface EnhancedFileUploadRequest {
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * Validate file for submission upload
 */
export function validateSubmissionFile(file: FileUploadRequest): {
  valid: boolean;
  error?: string;
} {
  // Check file size
  if (file.fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.fileType)) {
    return {
      valid: false,
      error: `File type ${file.fileType} is not allowed. Allowed types: PDF, JPG, PNG, MP4`,
    };
  }

  // Check file extension
  const extension = file.fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      error: `File extension not allowed. Allowed extensions: ${ALLOWED_EXTENSIONS.join(", ")}`,
    };
  }

  return { valid: true };
}

export function validateEnhancedDeliveryFile(file: EnhancedFileUploadRequest): {
  valid: boolean;
  error?: string;
} {
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  if (!ENHANCED_ALLOWED_MIME_TYPES.includes(file.mimeType)) {
    return {
      valid: false,
      error: `File type ${file.mimeType} is not allowed.`,
    };
  }

  const extension = file.fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!extension || !ENHANCED_ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      error: `File extension not allowed. Allowed extensions: ${ENHANCED_ALLOWED_EXTENSIONS.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Generate presigned URL for file upload
 */
export async function generatePresignedUpload(
  userId: string,
  file: FileUploadRequest
): Promise<PresignedUploadResponse> {
  const fileId = `${Date.now()}-${sanitizeFilename(file.fileName)}`;
  const storageKey = `submissions/${userId}/${fileId}`;

  // If S3 is not configured, return stub
  if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    logger.warn("S3 not fully configured; returning stubbed storage key");
    return {
      fileId,
      uploadUrl: null,
      storageKey,
    };
  }

  try {
    const s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: file.fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return {
      fileId,
      uploadUrl,
      storageKey,
    };
  } catch (error) {
    logger.error("Failed to generate presigned URL", error);
    throw new Error("Failed to generate upload URL");
  }
}

export async function generateEnhancedPresignedUpload(
  submissionId: string,
  adminId: string,
  file: EnhancedFileUploadRequest
): Promise<PresignedUploadResponse> {
  const fileId = `${Date.now()}-${sanitizeFilename(file.fileName)}`;
  const storageKey = `submissions/${submissionId}/enhanced/${adminId}/${fileId}`;

  if (!env.S3_BUCKET || !env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    logger.warn("S3 not fully configured; returning stubbed storage key");
    return {
      fileId,
      uploadUrl: null,
      storageKey,
    };
  }

  try {
    const s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: file.mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return {
      fileId,
      uploadUrl,
      storageKey,
    };
  } catch (error) {
    logger.error("Failed to generate presigned URL for enhanced delivery", error);
    throw new Error("Failed to generate upload URL");
  }
}

/**
 * Create a new submission
 * Uses a database transaction to ensure atomicity
 */
export async function createSubmission(userId: string, userNote?: string) {
  return await prisma.$transaction(async (tx) => {
    const submission = await tx.submission.create({
      data: {
        userId,
        userNote,
        status: "SUBMITTED",
      },
    });

    // Create initial event
    await tx.submissionEvent.create({
      data: {
        submissionId: submission.id,
        status: "SUBMITTED",
        action: "SUBMISSION_CREATED",
        actorRole: "USER",
        note: "Submission created",
        createdBy: userId,
      },
    });

    return submission;
  });
}

export async function createSubmissionWithQuota(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    userNote?: string;
    planCategory: SubmissionPlanCategory;
    quotaUnitsReserved: number;
  }
) {
  const submission = await tx.submission.create({
    data: {
      userId: params.userId,
      userNote: params.userNote,
      status: "SUBMITTED",
      planCategory: params.planCategory,
      quotaUnitsReserved: params.quotaUnitsReserved,
    },
  });

  await tx.submissionEvent.create({
    data: {
      submissionId: submission.id,
      status: "SUBMITTED",
      action: "SUBMISSION_CREATED",
      actorRole: "USER",
      note: "Submission created",
      createdBy: params.userId,
    },
  });

  return submission;
}

/**
 * Add file to submission
 */
export async function addFileToSubmission(
  submissionId: string,
  fileData: {
    fileName: string;
    fileType: string;
    fileSize: number;
    storageKey: string;
  },
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  return await tx.submissionFile.create({
    data: {
      submissionId,
      fileName: fileData.fileName,
      fileType: fileData.fileType,
      fileSize: fileData.fileSize,
      storageKey: fileData.storageKey,
    },
  });
}

/**
 * Get user's submissions
 */
export async function getUserSubmissions(
  userId: string,
  options?: { limit?: number; offset?: number }
) {
  const where = { userId };
  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: {
        files: true,
        events: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.submission.count({ where }),
  ]);

  return { submissions, total };
}

/**
 * Get submission by ID (with access check)
 */
export async function getSubmissionById(submissionId: string, userId?: string) {
  const where: any = { id: submissionId };
  
  // If userId is provided, filter by it (for user access)
  if (userId) {
    where.userId = userId;
  }

  return await prisma.submission.findFirst({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      files: true,
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

/**
 * Get all submissions (admin only)
 */
export async function getAllSubmissions(filters?: {
  status?: string;
  userId?: string;
  planCategory?: string;
  search?: string;
  sort?: "date" | "user" | "status";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  const where: any = {};

  if (filters?.status) {
    where.status = filters.status;
  }

  if (filters?.userId) {
    where.userId = filters.userId;
  }

  if (filters?.planCategory) {
    where.planCategory = filters.planCategory;
  }

  if (filters?.search) {
    where.OR = [
      { id: { contains: filters.search, mode: "insensitive" } },
      { user: { email: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const order = filters?.order || "desc";
  const orderBy =
    filters?.sort === "user"
      ? [{ user: { email: order } }]
      : filters?.sort === "status"
      ? [{ status: order }]
      : [{ createdAt: order }];

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        files: true,
        events: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy,
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    }),
    prisma.submission.count({ where }),
  ]);

  return { submissions, total };
}

/**
 * Update submission status (admin only)
 * Uses a database transaction to ensure atomicity
 */
export async function updateSubmissionStatus(
  submissionId: string,
  status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "ENHANCED_SENT" | "NEEDS_CHANGES" | "CLOSED" | "COMPLETED" | "REJECTED",
  adminNote?: string,
  adminId?: string
) {
  return await prisma.$transaction(async (tx) => {
    const submission = await tx.submission.update({
      where: { id: submissionId },
      data: {
        status,
        adminNote: adminNote || undefined,
      },
      include: {
        files: true,
        events: true,
      },
    });

    // Create status change event
    await tx.submissionEvent.create({
      data: {
        submissionId,
        status,
        action: "STATUS_UPDATED",
        actorRole: adminId ? "ADMIN" : "SYSTEM",
        note: adminNote,
        createdBy: adminId,
      },
    });

    return submission;
  });
}

export async function createEnhancedDelivery(
  submissionId: string,
  adminId: string,
  message?: string
) {
  return prisma.enhancedDelivery.create({
    data: {
      submissionId,
      adminId,
      message,
    },
  });
}

export async function addEnhancedDeliveryFiles(
  enhancedDeliveryId: string,
  files: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>
) {
  return prisma.enhancedDeliveryFile.createMany({
    data: files.map((file) => ({
      enhancedDeliveryId,
      storageKey: file.storageKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
    })),
  });
}

export async function getEnhancedDeliveriesForSubmission(
  submissionId: string
) {
  return prisma.enhancedDelivery.findMany({
    where: { submissionId },
    orderBy: { createdAt: "desc" },
    include: {
      admin: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      files: true,
    },
  });
}

/**
 * Sanitize filename for storage
 * Preserves extension, removes dangerous characters, normalizes spaces
 */
function sanitizeFilename(filename: string): string {
  const parts = filename.split('.');
  const ext = parts.pop();
  const name = parts.join('.');
  
  const sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove invalid filesystem characters
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
    .trim()
    .substring(0, 200); // Leave room for extension and timestamp
  
  return ext ? `${sanitized}.${ext}` : sanitized;
}

/**
 * Clean up incomplete submissions older than 24 hours
 * Should be run as a scheduled job
 */
export async function cleanupIncompleteSubmissions() {
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  
  try {
    const incomplete = await prisma.submission.findMany({
      where: {
        status: "SUBMITTED",
        createdAt: { lt: cutoffTime },
        files: { none: {} }, // No files attached
      },
      select: {
        id: true,
      },
    });

    if (incomplete.length === 0) {
      logger.info("No orphaned submissions to clean up");
      return { cleaned: 0 };
    }

    // Delete events first (due to foreign key constraint)
    await prisma.submissionEvent.deleteMany({
      where: {
        submissionId: { in: incomplete.map(s => s.id) },
      },
    });

    // Then delete submissions
    const result = await prisma.submission.deleteMany({
      where: {
        id: { in: incomplete.map(s => s.id) },
      },
    });

    logger.info(`Cleaned up ${result.count} orphaned submissions`);
    return { cleaned: result.count };
  } catch (error) {
    logger.error("Failed to clean up orphaned submissions", error);
    throw new Error("Failed to clean up orphaned submissions");
  }
}

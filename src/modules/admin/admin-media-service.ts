import { AssetType, AssetSource, AssetStatus } from "@prisma/client";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "../../lib/logger";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

interface CreateAdminMediaUploadRequest {
  userId: string;
  adminId: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface AdminMediaUploadResponse {
  mediaId: string;
  uploadUrl: string;
  storageKey: string;
}

export class AdminMediaService {
  private s3Client: S3Client | null = null;

  constructor() {
    if (env.S3_BUCKET && env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      this.s3Client = new S3Client({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      });
    }
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private inferAssetType(mimeType: string, filename: string): AssetType {
    if (mimeType.startsWith("video/")) return "VIDEO";
    if (/\.(mp4|mov|mkv|avi|webm)$/i.test(filename)) return "VIDEO";
    return "IMAGE";
  }

  /**
   * List user's media assets for admin
   */
  async getUserMedia(
    userId: string,
    options?: {
      source?: AssetSource;
      type?: AssetType;
      page?: number;
      pageSize?: number;
    }
  ) {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 50;

    // Build where clause - avoid OR with null to prevent Prisma validation errors
    const where: any = {
      userId,
    };

    // Source filter
    if (options?.source === "ADMIN_UPLOAD") {
      // For admin uploads, explicitly require source = ADMIN_UPLOAD
      where.source = "ADMIN_UPLOAD";
    } else if (options?.source === "USER_UPLOAD") {
      // For user uploads, exclude ADMIN_UPLOAD (this includes both USER_UPLOAD and null/legacy)
      // Using NOT instead of OR avoids Prisma null handling issues
      where.NOT = {
        source: "ADMIN_UPLOAD",
      };
    }
    // If no source specified, return all media for the user

    // Type filter
    if (options?.type) {
      where.type = options.type;
    }

    logger.info("Fetching user media", {
      userId,
      where: JSON.stringify(where),
      options,
    });

    try {
      const [total, assets] = await Promise.all([
        prisma.asset.count({ where }),
        prisma.asset.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            type: true,
            kind: true,
            storageKey: true,
            contentType: true,
            source: true,
            uploadedByAdminId: true,
            createdAt: true,
          },
        }),
      ]);

      logger.info("User media fetched", {
        userId,
        total,
        assetsCount: assets.length,
      });

      // Build media URLs
      const baseUrl = env.STORAGE_BASE_URL || process.env.STORAGE_BASE_URL;
      const mediaWithUrls = assets.map((asset) => ({
        ...asset,
        url: baseUrl ? `${baseUrl}/${asset.storageKey}` : null,
      }));

      return {
        items: mediaWithUrls,
        page,
        pageSize,
        total,
      };
    } catch (error) {
      logger.error("Error fetching user media", {
        userId,
        error,
        where: JSON.stringify(where),
      });
      throw error;
    }
  }

  /**
   * Create signed upload URL for admin to upload media on behalf of user
   */
  async createAdminMediaUpload(
    data: CreateAdminMediaUploadRequest
  ): Promise<AdminMediaUploadResponse> {
    const { userId, adminId, filename, mimeType, size } = data;

    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });

    if (!user) {
      throw new Error("Target user not found");
    }

    if (user.status === "BLOCKED" || user.status === "DELETED") {
      throw new Error(`Cannot upload media for ${user.status.toLowerCase()} users`);
    }

    // Generate storage key
    const sanitized = this.sanitizeFilename(filename);
    const storageKey = `user/${userId}/admin-upload/${Date.now()}-${sanitized}`;

    // Infer asset type
    const assetType = this.inferAssetType(mimeType, filename);

    // Create asset record in UPLOADING status
    const asset = await prisma.asset.create({
      data: {
        userId,
        type: assetType,
        kind: "ORIGINAL",
        storageKey,
        contentType: mimeType,
        source: "ADMIN_UPLOAD",
        uploadedByAdminId: adminId,
        uploadContext: "ADMIN_POST_AS_USER",
        status: "UPLOADING",
      },
      select: {
        id: true,
        storageKey: true,
      },
    });

    // Generate signed URL
    if (!this.s3Client || !env.S3_BUCKET) {
      logger.warn("S3 not configured; returning placeholder URL");
      return {
        mediaId: asset.id,
        uploadUrl: "",
        storageKey: asset.storageKey,
      };
    }

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
      ContentLength: size,
    });

    try {
      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 }); // 15 mins

      return {
        mediaId: asset.id,
        uploadUrl,
        storageKey: asset.storageKey,
      };
    } catch (error) {
      // Clean up asset record
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "FAILED" },
      });

      logger.error("Failed to create signed URL", { error, assetId: asset.id });
      throw new Error("Failed to generate upload URL");
    }
  }

  /**
   * Finalize admin media upload (mark as READY)
   */
  async finalizeAdminMediaUpload(
    mediaId: string,
    adminId: string,
    metadata?: {
      width?: number;
      height?: number;
      duration?: number;
    }
  ) {
    const asset = await prisma.asset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        userId: true,
        source: true,
        uploadedByAdminId: true,
        status: true,
        storageKey: true,
      },
    });

    if (!asset) {
      throw new Error("Asset not found");
    }

    if (asset.source !== "ADMIN_UPLOAD") {
      throw new Error("Can only finalize admin-uploaded assets");
    }

    if (asset.uploadedByAdminId !== adminId) {
      throw new Error("Unauthorized to finalize this asset");
    }

    if (asset.status === "READY") {
      // Already finalized
      return asset;
    }

    // Update status to READY
    const updated = await prisma.asset.update({
      where: { id: mediaId },
      data: {
        status: "READY",
      },
      select: {
        id: true,
        type: true,
        storageKey: true,
        contentType: true,
        source: true,
        createdAt: true,
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorEmail:
          (await prisma.user.findUnique({ where: { id: adminId }, select: { email: true } }))
            ?.email || "unknown",
        action: "MEDIA_ADMIN_UPLOAD",
        targetUserId: asset.userId,
        metadata: {
          mediaId: asset.id,
          storageKeyHash: Buffer.from(asset.storageKey).toString("base64").substring(0, 20),
          assetType: updated.type,
        },
      },
    });

    logger.info("Admin media upload finalized", {
      mediaId: asset.id,
      adminId,
      userId: asset.userId,
    });

    return updated;
  }

  /**
   * Delete admin-uploaded media (hard delete)
   */
  async deleteAdminMedia(mediaId: string, adminId: string) {
    const asset = await prisma.asset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        userId: true,
        storageKey: true,
        source: true,
        uploadedByAdminId: true,
      },
    });

    if (!asset) {
      throw new Error("Asset not found");
    }

    // Only allow deleting admin-uploaded assets
    if (asset.source !== "ADMIN_UPLOAD") {
      throw new Error("Can only delete admin-uploaded media");
    }

    // Only allow deleting if uploaded by current admin (or any admin with permission)
    if (asset.uploadedByAdminId !== adminId) {
      // Future: check for admin:media_delete_any permission
      throw new Error("Unauthorized to delete this media");
    }

    // Delete from S3
    if (this.s3Client && env.S3_BUCKET) {
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: asset.storageKey,
        });
        await this.s3Client.send(deleteCommand);
        logger.info("Deleted media from S3", { storageKey: asset.storageKey });
      } catch (error) {
        logger.warn("Failed to delete from S3 (continuing with DB delete)", {
          error,
          storageKey: asset.storageKey,
        });
        // Continue with DB delete even if S3 delete fails
      }
    }

    // Delete from database
    await prisma.asset.delete({
      where: { id: mediaId },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorEmail:
          (await prisma.user.findUnique({ where: { id: adminId }, select: { email: true } }))
            ?.email || "unknown",
        action: "MEDIA_ADMIN_DELETE",
        targetUserId: asset.userId,
        metadata: {
          mediaId: asset.id,
          storageKeyHash: Buffer.from(asset.storageKey).toString("base64").substring(0, 20),
        },
      },
    });

    logger.info("Admin media deleted", {
      mediaId: asset.id,
      adminId,
      userId: asset.userId,
    });

    return { success: true };
  }
}

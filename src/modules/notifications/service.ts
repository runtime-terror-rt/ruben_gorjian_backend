import { prisma } from "../../lib/prisma";
import { Submission, NotificationType, EnhancedDelivery } from "@prisma/client";
import { sendSubmissionEmail } from "./email";
import { logger } from "../../lib/logger";

interface NotificationPayload {
  submissionId: string;
  status: string;
  previousStatus?: string;
  timestamp: string;
  userNote?: string;
  adminNote?: string;
  enhancedDeliveryId?: string;
  fileCount?: number;
  message?: string;
}

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload: NotificationPayload;
}

/**
 * Create an in-app notification
 */
export async function createNotification(params: CreateNotificationParams) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        payload: params.payload as any,
      },
    });
    
    logger.info("Notification created", {
      notificationId: notification.id,
      userId: params.userId,
      type: params.type,
    });
    
    return notification;
  } catch (error) {
    logger.error("Failed to create notification", { error, params });
    throw error;
  }
}

/**
 * Get admin user IDs
 */
async function getAdminUserIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: {
      role: { in: ["ADMIN", "SUPER_ADMIN"] },
      status: "ACTIVE",
    },
    select: { id: true },
  });
  
  return admins.map((admin) => admin.id);
}

/**
 * Notify when a submission is created
 */
export async function notifySubmissionCreated(submission: Submission & { user: { email: string; name: string | null } }) {
  try {
    const payload: NotificationPayload = {
      submissionId: submission.id,
      status: submission.status,
      timestamp: submission.createdAt.toISOString(),
      userNote: submission.userNote || undefined,
    };

    // Notify the user
    await createNotification({
      userId: submission.userId,
      type: "SUBMISSION_CREATED",
      title: "Submission Received",
      message: "Your submission has been received and is awaiting review.",
      payload,
    });

    // Notify all admins
    const adminIds = await getAdminUserIds();
    for (const adminId of adminIds) {
      await createNotification({
        userId: adminId,
        type: "SUBMISSION_CREATED",
        title: "New Submission",
        message: `${submission.user.name || submission.user.email} submitted new files for review.`,
        payload,
      });
    }

    // Send email notification
    await sendSubmissionEmail({
      type: "created",
      submission,
      recipientType: "user",
    });

    // Send email to admins
    await sendSubmissionEmail({
      type: "created",
      submission,
      recipientType: "admin",
    });

    logger.info("Submission created notifications sent", {
      submissionId: submission.id,
      userId: submission.userId,
    });
  } catch (error) {
    logger.error("Failed to send submission created notifications", {
      error,
      submissionId: submission.id,
    });
    // Don't throw - notifications are non-critical
  }
}

/**
 * Notify when submission status is updated
 */
export async function notifySubmissionStatusUpdated(
  submission: Submission & { user: { email: string; name: string | null } },
  previousStatus: string
) {
  try {
    const payload: NotificationPayload = {
      submissionId: submission.id,
      status: submission.status,
      previousStatus,
      timestamp: submission.updatedAt.toISOString(),
      adminNote: submission.adminNote || undefined,
    };

    const statusMessages: Record<string, string> = {
      IN_REVIEW: "Your submission is now being reviewed.",
      ENHANCED_SENT: "Your enhanced files are ready for review.",
      NEEDS_CHANGES: "Your submission needs changes.",
      CLOSED: "Your submission has been closed.",
      COMPLETED: "Your submission has been completed!",
      REJECTED: "Your submission has been reviewed.",
    };

    const message = statusMessages[submission.status] || "Your submission status has been updated.";

    // Notify the user
    await createNotification({
      userId: submission.userId,
      type: "SUBMISSION_STATUS_UPDATED",
      title: "Submission Status Updated",
      message,
      payload,
    });

    // Optionally notify admins (for now, only notify user)
    // Could add admin notifications here if needed

    // Send email notification to user
    await sendSubmissionEmail({
      type: "status_updated",
      submission,
      recipientType: "user",
      previousStatus,
    });

    logger.info("Submission status updated notifications sent", {
      submissionId: submission.id,
      userId: submission.userId,
      status: submission.status,
      previousStatus,
    });
  } catch (error) {
    logger.error("Failed to send submission status updated notifications", {
      error,
      submissionId: submission.id,
    });
    // Don't throw - notifications are non-critical
  }
}

/**
 * Notify when enhanced delivery is sent
 */
export async function notifyEnhancedDeliverySent(
  submission: Submission & { user: { email: string; name: string | null } },
  delivery: EnhancedDelivery,
  fileCount: number
) {
  try {
    const payload: NotificationPayload = {
      submissionId: submission.id,
      status: submission.status,
      timestamp: submission.updatedAt.toISOString(),
      enhancedDeliveryId: delivery.id,
      fileCount,
      message: delivery.message || undefined,
    };

    await createNotification({
      userId: submission.userId,
      type: "ENHANCED_DELIVERY_SENT",
      title: "Enhanced Files Ready",
      message: "Your enhanced submission files are ready to view and download.",
      payload,
    });

    await sendSubmissionEmail({
      type: "enhanced_delivery",
      submission,
      recipientType: "user",
      deliveryMessage: delivery.message || undefined,
    });

    logger.info("Enhanced delivery notifications sent", {
      submissionId: submission.id,
      deliveryId: delivery.id,
      userId: submission.userId,
    });
  } catch (error) {
    logger.error("Failed to send enhanced delivery notifications", {
      error,
      submissionId: submission.id,
      deliveryId: delivery.id,
    });
  }
}

/**
 * Get user notifications with pagination
 */
export async function getUserNotifications(userId: string, options: { limit?: number; offset?: number } = {}) {
  const { limit = 50, offset = 0 } = options;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({
      where: { userId },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  return {
    notifications,
    total,
    unreadCount,
    hasMore: offset + limit < total,
  };
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(notificationId: string, userId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    throw new Error("Notification not found");
  }

  if (notification.readAt) {
    return notification; // Already read
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}

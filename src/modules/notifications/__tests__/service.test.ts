import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "../../../lib/prisma";
import {
  createNotification,
  notifySubmissionCreated,
  notifySubmissionStatusUpdated,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from "../service";

// Mock dependencies
vi.mock("../../../lib/prisma", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../email", () => ({
  sendSubmissionEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

describe("Notification Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createNotification", () => {
    it("should create a notification successfully", async () => {
      const mockNotification = {
        id: "notif_123",
        userId: "user_123",
        type: "SUBMISSION_CREATED",
        title: "Test Notification",
        message: "Test message",
        payload: { submissionId: "sub_123", status: "SUBMITTED", timestamp: new Date().toISOString() },
        readAt: null,
        createdAt: new Date(),
      };

      (prisma.notification.create as any).mockResolvedValue(mockNotification);

      const result = await createNotification({
        userId: "user_123",
        type: "SUBMISSION_CREATED",
        title: "Test Notification",
        message: "Test message",
        payload: {
          submissionId: "sub_123",
          status: "SUBMITTED",
          timestamp: new Date().toISOString(),
        },
      });

      expect(result).toEqual(mockNotification);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: "user_123",
          type: "SUBMISSION_CREATED",
          title: "Test Notification",
          message: "Test message",
          payload: expect.any(Object),
        },
      });
    });
  });

  describe("notifySubmissionCreated", () => {
    it("should notify user and admins when submission is created", async () => {
      const mockSubmission = {
        id: "sub_123",
        userId: "user_123",
        status: "SUBMITTED" as const,
        userNote: "Test note",
        adminNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          email: "user@test.com",
          name: "Test User",
        },
      };

      const mockAdmins = [
        { id: "admin_1" },
        { id: "admin_2" },
      ];

      (prisma.user.findMany as any).mockResolvedValue(mockAdmins);
      (prisma.notification.create as any).mockResolvedValue({
        id: "notif_123",
        userId: "user_123",
        type: "SUBMISSION_CREATED",
      });

      await notifySubmissionCreated(mockSubmission);

      // Should create notification for user + 2 admins = 3 total
      expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    });
  });

  describe("notifySubmissionStatusUpdated", () => {
    it("should notify user when submission status changes", async () => {
      const mockSubmission = {
        id: "sub_123",
        userId: "user_123",
        status: "COMPLETED" as const,
        userNote: null,
        adminNote: "All done!",
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          email: "user@test.com",
          name: "Test User",
        },
      };

      (prisma.notification.create as any).mockResolvedValue({
        id: "notif_123",
        userId: "user_123",
        type: "SUBMISSION_STATUS_UPDATED",
      });

      await notifySubmissionStatusUpdated(mockSubmission, "IN_REVIEW");

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user_123",
          type: "SUBMISSION_STATUS_UPDATED",
          title: "Submission Status Updated",
          message: "Your submission has been completed!",
        }),
      });
    });

    it("should include correct message for IN_REVIEW status", async () => {
      const mockSubmission = {
        id: "sub_123",
        userId: "user_123",
        status: "IN_REVIEW" as const,
        userNote: null,
        adminNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          email: "user@test.com",
          name: "Test User",
        },
      };

      (prisma.notification.create as any).mockResolvedValue({});

      await notifySubmissionStatusUpdated(mockSubmission, "SUBMITTED");

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: "Your submission is now being reviewed.",
        }),
      });
    });
  });

  describe("getUserNotifications", () => {
    it("should fetch user notifications with pagination", async () => {
      const mockNotifications = [
        {
          id: "notif_1",
          userId: "user_123",
          type: "SUBMISSION_CREATED",
          title: "Notification 1",
          message: "Message 1",
          payload: {},
          readAt: null,
          createdAt: new Date(),
        },
      ];

      (prisma.notification.findMany as any).mockResolvedValue(mockNotifications);
      (prisma.notification.count as any).mockResolvedValueOnce(10).mockResolvedValueOnce(5);

      const result = await getUserNotifications("user_123", { limit: 20, offset: 0 });

      expect(result).toEqual({
        notifications: mockNotifications,
        total: 10,
        unreadCount: 5,
        hasMore: false,
      });
    });
  });

  describe("markNotificationRead", () => {
    it("should mark notification as read", async () => {
      const mockNotification = {
        id: "notif_123",
        userId: "user_123",
        readAt: null,
      };

      (prisma.notification.findFirst as any).mockResolvedValue(mockNotification);
      (prisma.notification.update as any).mockResolvedValue({
        ...mockNotification,
        readAt: new Date(),
      });

      await markNotificationRead("notif_123", "user_123");

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: "notif_123" },
        data: { readAt: expect.any(Date) },
      });
    });

    it("should throw error if notification not found", async () => {
      (prisma.notification.findFirst as any).mockResolvedValue(null);

      await expect(markNotificationRead("notif_123", "user_123")).rejects.toThrow(
        "Notification not found"
      );
    });

    it("should not update if already read", async () => {
      const mockNotification = {
        id: "notif_123",
        userId: "user_123",
        readAt: new Date(),
      };

      (prisma.notification.findFirst as any).mockResolvedValue(mockNotification);

      const result = await markNotificationRead("notif_123", "user_123");

      expect(result).toEqual(mockNotification);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe("markAllNotificationsRead", () => {
    it("should mark all unread notifications as read", async () => {
      (prisma.notification.updateMany as any).mockResolvedValue({ count: 5 });

      await markAllNotificationsRead("user_123");

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: "user_123", readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread notification count", async () => {
      (prisma.notification.count as any).mockResolvedValue(7);

      const count = await getUnreadCount("user_123");

      expect(count).toBe(7);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: "user_123", readAt: null },
      });
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AdminPostService } from "../../src/modules/admin/admin-post-service";
import { validatePostAsUserPermission } from "../../src/middleware/requireAdminPostPermission";
import { prisma } from "../../src/lib/prisma";
import { enqueuePostPublish } from "../../src/modules/jobs/post-queue";

// Mock dependencies
vi.mock("../../src/middleware/requireAdminPostPermission");
vi.mock("../../src/lib/prisma");
vi.mock("../../src/modules/jobs/post-queue");

describe("AdminPostService", () => {
  let adminPostService: AdminPostService;
  const mockAdminId = "admin-123";
  const mockUserId = "user-456";

  beforeEach(() => {
    adminPostService = new AdminPostService();
    vi.clearAllMocks();
  });

  describe("createPostAsUser", () => {
    it("should successfully create an admin post", async () => {
      // Mock permission validation
      (validatePostAsUserPermission as any).mockResolvedValue({
        allowed: true,
        requiresApproval: false,
      });

      // Mock user query
      (prisma.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: "user@example.com",
        status: "ACTIVE",
        subscriptions: [{ plan: { basePostQuota: 50 } }],
      });

      // Mock social accounts query
      (prisma.socialAccount.findMany as any).mockResolvedValue([
        {
          id: "sa-1",
          platform: "INSTAGRAM",
          displayName: "Test Account",
          expiresAt: new Date(Date.now() + 86400000), // Tomorrow
        },
      ]);

      // Mock asset query
      (prisma.asset.findMany as any).mockResolvedValue([
        { id: "asset-1", type: "IMAGE", kind: "original" },
      ]);

      // Mock post creation
      const mockPost = {
        id: "post-123",
        userId: mockUserId,
        caption: "Test caption",
        hashtags: ["#test"],
        status: "PUBLISHING",
        scheduledFor: null,
        initiatedBy: "ADMIN",
        adminId: mockAdminId,
        adminReason: "Test reason",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prisma.post.create as any).mockResolvedValue(mockPost);

      // Mock postAsset creation
      (prisma.postAsset.createMany as any).mockResolvedValue({ count: 1 });

      // Mock postTarget creation and query
      (prisma.postTarget.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.postTarget.findMany as any).mockResolvedValue([
        {
          id: "target-1",
          postId: "post-123",
          platform: "INSTAGRAM",
          status: "PENDING",
          socialAccountId: "sa-1",
          scheduledFor: null,
          errorMessage: null,
        },
      ]);

      // Mock other prisma operations
      (prisma.postEvent.create as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});
      (prisma.notification.create as any).mockResolvedValue({});
      (enqueuePostPublish as any).mockResolvedValue(true);

      const result = await adminPostService.createPostAsUser({
        userId: mockUserId,
        adminId: mockAdminId,
        content: { caption: "Test caption", hashtags: ["test"] },
        mediaIds: ["asset-1"],
        platforms: ["INSTAGRAM"],
        publishMode: "NOW",
        reason: "Test reason",
      });

      expect(result.post.id).toBe("post-123");
      expect(result.requiresApproval).toBe(false);
      expect(enqueuePostPublish).toHaveBeenCalledWith("post-123");
    });

    it("should create a draft when user requires approval", async () => {
      (validatePostAsUserPermission as any).mockResolvedValue({
        allowed: true,
        requiresApproval: true,
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: "user@example.com",
        status: "ACTIVE",
        subscriptions: [{ plan: { basePostQuota: 50 } }],
      });

      (prisma.socialAccount.findMany as any).mockResolvedValue([
        {
          id: "sa-1",
          platform: "INSTAGRAM",
          displayName: "Test Account",
          expiresAt: new Date(Date.now() + 86400000),
        },
      ]);

      (prisma.asset.findMany as any).mockResolvedValue([
        { id: "asset-1", type: "IMAGE", kind: "original" },
      ]);

      const mockPost = {
        id: "post-456",
        userId: mockUserId,
        caption: "Needs approval",
        hashtags: ["#test"],
        status: "DRAFT",
        scheduledFor: null,
        initiatedBy: "ADMIN",
        adminId: mockAdminId,
        adminReason: "Approval required",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prisma.post.create as any).mockResolvedValue(mockPost);

      (prisma.postAsset.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.postTarget.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.postTarget.findMany as any).mockResolvedValue([
        {
          id: "target-1",
          postId: "post-456",
          platform: "INSTAGRAM",
          status: "PENDING",
          socialAccountId: "sa-1",
          scheduledFor: null,
          errorMessage: null,
        },
      ]);
      (prisma.postEvent.create as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});
      (prisma.notification.create as any).mockResolvedValue({});
      (enqueuePostPublish as any).mockResolvedValue(true);

      const result = await adminPostService.createPostAsUser({
        userId: mockUserId,
        adminId: mockAdminId,
        content: { caption: "Needs approval", hashtags: ["test"] },
        mediaIds: ["asset-1"],
        platforms: ["INSTAGRAM"],
        publishMode: "NOW",
        reason: "Approval required",
      });

      expect(result.post.status).toBe("DRAFT");
      expect(result.requiresApproval).toBe(true);
      expect(enqueuePostPublish).not.toHaveBeenCalled();
    });

    it("should reject Instagram posts without media", async () => {
      (validatePostAsUserPermission as any).mockResolvedValue({
        allowed: true,
        requiresApproval: false,
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: "user@example.com",
        status: "ACTIVE",
        subscriptions: [],
      });

      (prisma.socialAccount.findMany as any).mockResolvedValue([
        { id: "sa-1", platform: "INSTAGRAM" },
      ]);

      await expect(
        adminPostService.createPostAsUser({
          userId: mockUserId,
          adminId: mockAdminId,
          content: { caption: "Test" },
          platforms: ["INSTAGRAM"],
          publishMode: "NOW",
          reason: "Test",
        })
      ).rejects.toThrow("Instagram posts require at least one image or video");
    });

    it("should reject if user is blocked", async () => {
      (validatePostAsUserPermission as any).mockResolvedValue({
        allowed: true,
        requiresApproval: false,
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: "user@example.com",
        status: "BLOCKED",
      });

      await expect(
        adminPostService.createPostAsUser({
          userId: mockUserId,
          adminId: mockAdminId,
          content: { caption: "Test" },
          platforms: ["INSTAGRAM"],
          publishMode: "NOW",
          reason: "Test",
        })
      ).rejects.toThrow("Cannot post for blocked users");
    });

    it("should reject if platforms not connected", async () => {
      (validatePostAsUserPermission as any).mockResolvedValue({
        allowed: true,
        requiresApproval: false,
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: "user@example.com",
        status: "ACTIVE",
        subscriptions: [],
      });

      (prisma.socialAccount.findMany as any).mockResolvedValue([]);

      await expect(
        adminPostService.createPostAsUser({
          userId: mockUserId,
          adminId: mockAdminId,
          content: { caption: "Test" },
          platforms: ["INSTAGRAM"],
          publishMode: "NOW",
          reason: "Test",
        })
      ).rejects.toThrow("User has not connected any of the selected platforms");
    });

    it("should validate scheduled time is in the future", async () => {
      (validatePostAsUserPermission as any).mockResolvedValue({
        allowed: true,
        requiresApproval: false,
      });

      (prisma.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: "user@example.com",
        status: "ACTIVE",
        subscriptions: [],
      });

      (prisma.socialAccount.findMany as any).mockResolvedValue([
        { id: "sa-1", platform: "INSTAGRAM" },
      ]);

      const pastDate = new Date(Date.now() - 86400000); // Yesterday

      await expect(
        adminPostService.createPostAsUser({
          userId: mockUserId,
          adminId: mockAdminId,
          content: { caption: "Test" },
          platforms: ["INSTAGRAM"],
          publishMode: "SCHEDULE",
          scheduledFor: pastDate,
          reason: "Test",
        })
      ).rejects.toThrow("Scheduled time must be in the future");
    });
  });

  describe("cancelAdminPost", () => {
    it("should cancel a scheduled admin post", async () => {
      const mockPost = {
        id: "post-123",
        userId: mockUserId,
        status: "SCHEDULED",
        initiatedBy: "ADMIN",
        adminId: mockAdminId,
      };

      (prisma.post.findUnique as any).mockResolvedValue(mockPost);
      (prisma.post.update as any).mockResolvedValue({
        id: "post-123",
        status: "DRAFT",
        updatedAt: new Date(),
      });
      (prisma.postTarget.updateMany as any).mockResolvedValue({});
      (prisma.postEvent.create as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});
      (prisma.notification.create as any).mockResolvedValue({});
      (prisma.user.findUnique as any).mockResolvedValue({
        email: "admin@example.com",
      });

      const result = await adminPostService.cancelAdminPost("post-123", mockAdminId);

      expect(result.status).toBe("DRAFT");
      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: "post-123" },
        data: { status: "DRAFT" },
        select: { id: true, status: true, updatedAt: true },
      });
    });

    it("should reject canceling non-scheduled posts", async () => {
      (prisma.post.findUnique as any).mockResolvedValue({
        id: "post-123",
        status: "POSTED",
        initiatedBy: "ADMIN",
      });

      await expect(
        adminPostService.cancelAdminPost("post-123", mockAdminId)
      ).rejects.toThrow("Cannot cancel post with status: POSTED");
    });
  });

  describe("getUserConnectedPlatforms", () => {
    it("should return user's connected platforms with expiry status", async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 86400000);
      const pastDate = new Date(now.getTime() - 86400000);

      (prisma.socialAccount.findMany as any).mockResolvedValue([
        {
          id: "sa-1",
          platform: "INSTAGRAM",
          displayName: "Instagram Account",
          externalAccountId: "ig-123",
          expiresAt: futureDate,
          updatedAt: now,
        },
        {
          id: "sa-2",
          platform: "FACEBOOK",
          displayName: "Facebook Account",
          externalAccountId: "fb-456",
          expiresAt: pastDate, // Expired
          updatedAt: now,
        },
      ]);

      const result = await adminPostService.getUserConnectedPlatforms(mockUserId);

      expect(result).toHaveLength(2);
      expect(result[0].isExpired).toBe(false);
      expect(result[1].isExpired).toBe(true);
    });
  });
});

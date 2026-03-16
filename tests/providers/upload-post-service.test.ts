import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClient, mockPrisma } = vi.hoisted(() => ({
  mockClient: {
    ensureProfile: vi.fn(),
    getUserProfile: vi.fn(),
    publish: vi.fn(),
    getJobStatus: vi.fn(),
  },
  mockPrisma: {
    uploadPostProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    externalPublishJob: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    postTarget: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    post: {
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../src/modules/providers/upload-post/client", () => ({
  UploadPostClient: vi.fn().mockImplementation(() => mockClient),
}));

import { UploadPostService } from "../../src/modules/providers/upload-post/service";

describe("UploadPostService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ensures profile with upsert to avoid create race collisions", async () => {
    mockPrisma.uploadPostProfile.findUnique.mockResolvedValue(null);
    mockPrisma.uploadPostProfile.upsert.mockResolvedValue({
      id: "upp_1",
      userId: "user_1",
      username: "talexia_user_1",
    });
    mockClient.ensureProfile.mockResolvedValue({});

    const service = new UploadPostService();
    const [profileA, profileB] = await Promise.all([
      service.ensureProfile("user_1"),
      service.ensureProfile("user_1"),
    ]);

    expect(profileA.userId).toBe("user_1");
    expect(profileB.userId).toBe("user_1");
    expect(mockPrisma.uploadPostProfile.upsert).toHaveBeenCalled();
  });

  it("processes webhook terminal success and updates post target/post status", async () => {
    mockPrisma.externalPublishJob.findUnique.mockResolvedValue({
      id: "job_1",
      postTargetId: "target_1",
      attemptCount: 0,
    });
    mockPrisma.externalPublishJob.update.mockResolvedValue({});
    mockPrisma.postTarget.findUnique.mockResolvedValue({
      id: "target_1",
      postId: "post_1",
      post: { targets: [] },
    });
    mockPrisma.postTarget.update.mockResolvedValue({});
    mockPrisma.postTarget.findMany.mockResolvedValue([{ status: "POSTED" }]);
    mockPrisma.post.update.mockResolvedValue({});

    const service = new UploadPostService();
    await service.processWebhook({ job_id: "remote_1", status: "posted" });

    expect(mockPrisma.externalPublishJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remoteStatus: "COMPLETED" }),
      })
    );
    expect(mockPrisma.postTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );
    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );
  });

  it("parses documented Upload-Post profile shape (profile.social_accounts) and returns connected platforms", async () => {
    mockPrisma.uploadPostProfile.findUnique.mockResolvedValue({
      id: "upp_1",
      userId: "user_1",
      username: "talexia_user_1",
    });
    mockPrisma.uploadPostProfile.upsert.mockResolvedValue({
      id: "upp_1",
      userId: "user_1",
      username: "talexia_user_1",
    });
    mockPrisma.uploadPostProfile.update.mockResolvedValue({});
    mockClient.ensureProfile.mockResolvedValue({});
    // Documented shape: https://docs.upload-post.com/api/user-profiles/
    mockClient.getUserProfile.mockResolvedValue({
      success: true,
      profile: {
        username: "talexia_user_1",
        created_at: "2023-10-27T10:00:00Z",
        social_accounts: {
          instagram: {
            username: "ig_user",
            display_name: "IG User",
            social_images: "https://example.com/ig.jpg",
          },
          facebook: {
            username: "fb_page",
            display_name: "FB Page",
            social_images: "https://example.com/fb.jpg",
          },
          linkedin: null,
          tiktok: "",
        },
      },
    });

    const service = new UploadPostService();
    const result = await service.getConnectedPlatforms("user_1");

    expect(result.confident).toBe(true);
    expect(result.platforms.has("INSTAGRAM")).toBe(true);
    expect(result.platforms.has("FACEBOOK")).toBe(true);
    expect(result.platforms.has("LINKEDIN")).toBe(false);
    expect(result.platforms.size).toBe(2);
  });

  it("reconciles pending jobs and applies terminal failure status", async () => {
    mockPrisma.externalPublishJob.findMany.mockResolvedValue([
      {
        id: "job_1",
        postTargetId: "target_1",
        remoteJobId: "remote_1",
        identifierType: "JOB_ID",
        attemptCount: 0,
      },
    ]);
    mockClient.getJobStatus.mockResolvedValue({
      identifierType: "JOB_ID",
      identifier: "remote_1",
      status: "failed",
      message: "Publish failed",
      raw: {},
    });
    mockPrisma.externalPublishJob.update.mockResolvedValue({});
    mockPrisma.postTarget.findUnique.mockResolvedValue({
      id: "target_1",
      postId: "post_1",
      post: { targets: [] },
    });
    mockPrisma.postTarget.update.mockResolvedValue({});
    mockPrisma.postTarget.findMany.mockResolvedValue([{ status: "FAILED" }]);
    mockPrisma.post.update.mockResolvedValue({});

    const service = new UploadPostService();
    await service.reconcilePendingJobs(10);

    expect(mockClient.getJobStatus).toHaveBeenCalledWith("JOB_ID", "remote_1");
    expect(mockPrisma.postTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});

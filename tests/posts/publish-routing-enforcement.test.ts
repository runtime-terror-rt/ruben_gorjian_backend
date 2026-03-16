import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    post: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    postTarget: {
      update: vi.fn(),
      findMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    usageMonthly: {
      upsert: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
  publishPost: vi.fn(),
  uploadPublishForTarget: vi.fn(),
  decidePublishingProvider: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mocks.prisma),
}));

vi.mock("../../src/modules/social/publisher", () => ({
  SocialPublisher: class {
    publishPost = mocks.publishPost;
  },
}));

vi.mock("../../src/modules/providers/upload-post/service", () => ({
  UploadPostService: class {
    publishForTarget = mocks.uploadPublishForTarget;
  },
}));

vi.mock("../../src/modules/social/provider-routing", () => ({
  decidePublishingProvider: mocks.decidePublishingProvider,
}));

import { PostService } from "../../src/modules/posts/service";

function buildPost() {
  return {
    id: "post_1",
    userId: "user_1",
    caption: "Hello world",
    hashtags: [],
    scheduledFor: new Date("2026-02-26T10:00:00.000Z"),
    initiatedBy: "USER",
    adminId: null,
    PostAsset: [
      {
        Asset: {
          storageKey: "image.jpg",
          type: "IMAGE",
        },
      },
    ],
    asset: null,
    targets: [
      {
        id: "target_1",
        platform: "FACEBOOK",
        socialAccount: {
          id: "social_1",
          accessToken: "token",
          externalAccountId: "native-123",
        },
      },
    ],
  };
}

describe("publish routing enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_BASE_URL = "https://cdn.example.com";
    mocks.prisma.post.update.mockResolvedValue({});
    mocks.prisma.postTarget.update.mockResolvedValue({});
  });

  it("publishes through Upload-Post when routing resolves to FORCE_UPLOAD_POST", async () => {
    mocks.prisma.post.findUnique.mockResolvedValue(buildPost());
    mocks.decidePublishingProvider.mockResolvedValue("UPLOAD_POST");
    mocks.uploadPublishForTarget.mockResolvedValue({
      status: "posted",
      identifier: "remote-1",
    });

    const service = new PostService();
    const result = await service.publishPost("post_1");

    expect(result.anySuccessful).toBe(true);
    expect(mocks.uploadPublishForTarget).toHaveBeenCalledTimes(1);
    expect(mocks.publishPost).not.toHaveBeenCalled();
  });

  it("does not fallback to Upload-Post when native publish fails", async () => {
    mocks.prisma.post.findUnique.mockResolvedValue(buildPost());
    mocks.decidePublishingProvider.mockResolvedValue("NATIVE");
    mocks.publishPost.mockResolvedValue({ success: false, error: "Native failed" });

    const service = new PostService();
    const result = await service.publishPost("post_1");

    expect(result.anySuccessful).toBe(false);
    expect(mocks.publishPost).toHaveBeenCalledTimes(1);
    expect(mocks.uploadPublishForTarget).not.toHaveBeenCalled();
    expect(mocks.prisma.postTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", errorMessage: "Native failed" }),
      })
    );
  });
});

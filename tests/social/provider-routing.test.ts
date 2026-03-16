import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    providerRoutingConfig: {
      findUnique: vi.fn(),
    },
    globalPublishingRoutingConfig: {
      findUnique: vi.fn(),
    },
    socialAccount: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrisma,
}));

const uploadPostMocks = vi.hoisted(() => ({
  verifyPlatformConnected: vi.fn(),
}));

vi.mock("../../src/modules/providers/upload-post/service", () => ({
  UploadPostService: class {
    verifyPlatformConnected = uploadPostMocks.verifyPlatformConnected;
  },
}));

import { decidePublishingProvider } from "../../src/modules/social/provider-routing";

describe("provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.providerRoutingConfig.findUnique.mockResolvedValue(null);
    mockPrisma.globalPublishingRoutingConfig.findUnique.mockResolvedValue(null);
    mockPrisma.socialAccount.findFirst.mockResolvedValue(null);
    uploadPostMocks.verifyPlatformConnected.mockResolvedValue({ connected: true, confident: true });
  });

  it("defaults to native mode when config is missing and native path is available", async () => {
    const provider = await decidePublishingProvider({
      userId: "user_1",
      platform: "INSTAGRAM",
      nativeAllowed: true,
    });

    expect(provider).toBe("NATIVE");
  });

  it("throws guided error in default native mode when native path is unavailable", async () => {
    await expect(
      decidePublishingProvider({
        userId: "user_1",
        platform: "FACEBOOK",
        nativeAllowed: false,
      })
    ).rejects.toMatchObject({
      code: "ROUTING_MODE_INCOMPATIBLE",
    });
  });

  it("returns Upload-Post when forced and connected", async () => {
    mockPrisma.providerRoutingConfig.findUnique.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mockPrisma.socialAccount.findFirst.mockResolvedValue({ id: "sa_1" });
    uploadPostMocks.verifyPlatformConnected.mockResolvedValue({ connected: true, confident: true });

    const provider = await decidePublishingProvider({
      userId: "user_1",
      platform: "LINKEDIN",
      nativeAllowed: false,
    });

    expect(provider).toBe("UPLOAD_POST");
  });

  it("forbids fallback to native in FORCE_UPLOAD_POST mode when Upload-Post is not connected", async () => {
    mockPrisma.providerRoutingConfig.findUnique.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });

    await expect(
      decidePublishingProvider({
        userId: "user_1",
        platform: "INSTAGRAM",
        nativeAllowed: false,
      })
    ).rejects.toMatchObject({
      code: "ROUTING_MODE_INCOMPATIBLE",
    });
  });

  it("rejects disabled Upload-Post platform toggle in FORCE_UPLOAD_POST mode", async () => {
    mockPrisma.providerRoutingConfig.findUnique.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: false,
      useFacebook: true,
      useLinkedin: true,
    });

    await expect(
      decidePublishingProvider({
        userId: "user_1",
        platform: "INSTAGRAM",
        nativeAllowed: true,
      })
    ).rejects.toMatchObject({
      code: "ROUTING_MODE_INCOMPATIBLE",
    });
  });

  it("inherits global mode when per-user routing config is missing", async () => {
    mockPrisma.globalPublishingRoutingConfig.findUnique.mockResolvedValue({
      id: "global",
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mockPrisma.socialAccount.findFirst.mockResolvedValue({ id: "sa_1" });
    uploadPostMocks.verifyPlatformConnected.mockResolvedValue({ connected: true, confident: true });

    const provider = await decidePublishingProvider({
      userId: "user_1",
      platform: "FACEBOOK",
      nativeAllowed: false,
    });

    expect(provider).toBe("UPLOAD_POST");
  });

  it("does not treat placeholder as connected when Upload-Post verification is uncertain", async () => {
    mockPrisma.providerRoutingConfig.findUnique.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mockPrisma.socialAccount.findFirst.mockResolvedValue({ id: "sa_1" });
    uploadPostMocks.verifyPlatformConnected.mockResolvedValue({ connected: false, confident: false });

    await expect(
      decidePublishingProvider({
        userId: "user_1",
        platform: "INSTAGRAM",
        nativeAllowed: false,
      })
    ).rejects.toMatchObject({
      code: "ROUTING_MODE_INCOMPATIBLE",
    });
  });
});

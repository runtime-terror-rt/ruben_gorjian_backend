import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkPlatformLimit: vi.fn(),
  getUserSocialAccounts: vi.fn(),
  getAuthUrl: vi.fn(),
  getConnectUrl: vi.fn(),
  getConnectedPlatforms: vi.fn(),
  verifyPlatformConnected: vi.fn(),
  getEffectiveProviderRoutingConfig: vi.fn(),
  isUploadPostEnabledForPlatform: vi.fn(),
  createOAuthState: vi.fn(),
  findOAuthState: vi.fn(),
  deleteOAuthState: vi.fn(),
  upsertSocialAccount: vi.fn(),
  deleteManySocialAccount: vi.fn(),
}));

vi.mock("../../src/middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", role: "USER", email: "user@example.com" };
    next();
  },
}));

vi.mock("../../src/modules/social/service", () => ({
  SocialAccountService: class {
    checkPlatformLimit = mocks.checkPlatformLimit;
    getUserSocialAccounts = mocks.getUserSocialAccounts;
    connectAccount = vi.fn();
    disconnectAccount = vi.fn();
    refreshTokenIfNeeded = vi.fn();
  },
}));

vi.mock("../../src/modules/social/oauth", () => ({
  SocialOAuthService: class {
    getAuthUrl = mocks.getAuthUrl;
  },
}));

vi.mock("../../src/modules/providers/upload-post/service", () => ({
  UploadPostService: class {
    getConnectUrl = mocks.getConnectUrl;
    getConnectedPlatforms = mocks.getConnectedPlatforms;
    verifyPlatformConnected = mocks.verifyPlatformConnected;
  },
}));

vi.mock("../../src/modules/social/provider-routing", async () => {
  const actual = await vi.importActual<any>("../../src/modules/social/provider-routing");
  return {
    ...actual,
    getEffectiveProviderRoutingConfig: mocks.getEffectiveProviderRoutingConfig,
    isUploadPostEnabledForPlatform: mocks.isUploadPostEnabledForPlatform,
  };
});

vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    socialOAuthState: {
      create: mocks.createOAuthState,
      findUnique: mocks.findOAuthState,
      delete: mocks.deleteOAuthState,
    },
    socialAccount: {
      upsert: mocks.upsertSocialAccount,
      deleteMany: mocks.deleteManySocialAccount,
    },
  },
}));

import { socialRouter } from "../../src/modules/social/routes";

describe("social connect routing by admin mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkPlatformLimit.mockResolvedValue(true);
    mocks.createOAuthState.mockResolvedValue({ id: "state_1" });
    mocks.isUploadPostEnabledForPlatform.mockReturnValue(true);
    mocks.deleteOAuthState.mockResolvedValue({ id: "state_1" });
    mocks.upsertSocialAccount.mockResolvedValue({ id: "account_1" });
    mocks.deleteManySocialAccount.mockResolvedValue({ count: 0 });
    mocks.getConnectedPlatforms.mockResolvedValue({ platforms: new Set(), confident: true });
    mocks.getUserSocialAccounts.mockResolvedValue([]);
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/social", socialRouter);
    return app;
  }

  it("uses Upload-Post connect flow when mode is FORCE_UPLOAD_POST", async () => {
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.getConnectUrl.mockResolvedValue({ url: "https://upload-post.example/connect" });

    const res = await request(buildApp())
      .post("/social/connect")
      .send({ platform: "INSTAGRAM" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://upload-post.example/connect");
    expect(mocks.getConnectUrl).toHaveBeenCalled();
    expect(mocks.getAuthUrl).not.toHaveBeenCalled();
  });

  it("uses native OAuth flow when mode is FORCE_NATIVE", async () => {
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_NATIVE",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.getAuthUrl.mockReturnValue("https://native-oauth.example/connect");

    const res = await request(buildApp())
      .post("/social/connect")
      .send({ platform: "FACEBOOK" });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://native-oauth.example/connect");
    expect(mocks.getAuthUrl).toHaveBeenCalled();
    expect(mocks.getConnectUrl).not.toHaveBeenCalled();
  });

  it("returns clear incompatibility error when Upload-Post mode disables platform", async () => {
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: false,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.isUploadPostEnabledForPlatform.mockReturnValue(false);

    const res = await request(buildApp())
      .post("/social/connect")
      .send({ platform: "INSTAGRAM" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ROUTING_MODE_INCOMPATIBLE");
    expect(String(res.body.error || "").toLowerCase()).toContain("disabled");
  });

  it("reconciles Upload-Post placeholders on social accounts fetch", async () => {
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.getConnectedPlatforms.mockResolvedValue({
      confident: true,
      platforms: new Set(["INSTAGRAM"]),
    });
    mocks.getUserSocialAccounts.mockResolvedValue([
      { id: "sa_1", platform: "INSTAGRAM", externalAccountId: "upload-post:instagram:user_1" },
    ]);

    const res = await request(buildApp()).get("/social");

    expect(res.status).toBe(200);
    expect(mocks.upsertSocialAccount).toHaveBeenCalledTimes(1);
    expect(mocks.deleteManySocialAccount).toHaveBeenCalledTimes(2);
  });

  it("sets X-Talexia-Upload-Post-Sync header when Upload-Post sync fails but still returns accounts", async () => {
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.getConnectedPlatforms.mockRejectedValue(new Error("Upload-Post timeout"));
    mocks.getUserSocialAccounts.mockResolvedValue([]);

    const res = await request(buildApp()).get("/social");

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([]);
    expect(res.headers["x-talexia-upload-post-sync"]).toBe("failed");
    expect(res.headers["x-talexia-upload-post-sync-error"]).toContain("timeout");
  });

  it("redirects back to Talexia with success when Upload-Post callback confirms connection", async () => {
    process.env.FRONTEND_URL = "http://localhost:3000";
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.findOAuthState.mockResolvedValue({
      id: "state_1",
      state: "state-ok",
      userId: "user_1",
      platform: "INSTAGRAM",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.verifyPlatformConnected.mockResolvedValue({ connected: true, confident: true });

    const res = await request(buildApp()).get(
      "/social/callback/upload-post?state=state-ok&platform=instagram"
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/dashboard/social?success=connected");
    expect(res.headers.location).toContain("platform=instagram");
    expect(res.headers.location).not.toContain("pendingVerification=true");
    expect(mocks.upsertSocialAccount).toHaveBeenCalledTimes(1);
  });

  it("returns guided error and does not create placeholder when callback cannot confidently verify yet", async () => {
    process.env.FRONTEND_URL = "http://localhost:3000";
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.findOAuthState.mockResolvedValue({
      id: "state_1",
      state: "state-pending",
      userId: "user_1",
      platform: "INSTAGRAM",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.verifyPlatformConnected.mockResolvedValue({ connected: false, confident: false });

    const res = await request(buildApp()).get(
      "/social/callback/upload-post?state=state-pending&platform=instagram"
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/dashboard/social?error=connection_pending_confirmation");
    expect(mocks.upsertSocialAccount).not.toHaveBeenCalled();
  });

  it("redirects with clear error when callback says platform is not connected", async () => {
    process.env.FRONTEND_URL = "http://localhost:3000";
    mocks.getEffectiveProviderRoutingConfig.mockResolvedValue({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });
    mocks.findOAuthState.mockResolvedValue({
      id: "state_1",
      state: "state-not-connected",
      userId: "user_1",
      platform: "INSTAGRAM",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.verifyPlatformConnected.mockResolvedValue({ connected: false, confident: true });

    const res = await request(buildApp()).get(
      "/social/callback/upload-post?state=state-not-connected&platform=instagram"
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/dashboard/social?error=connection_not_confirmed");
    expect(mocks.upsertSocialAccount).not.toHaveBeenCalled();
  });
});

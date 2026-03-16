import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../middleware/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.headers["x-test-user-id"];
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: String(userId) };
    next();
  },
}));

vi.mock("../../../config/env", () => ({
  env: {
    STORAGE_BASE_URL: "https://cdn.example.com",
  },
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    userProfile: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "../../../lib/prisma";
import { settingsRouter } from "../routes";

async function invokeSettingsRoute({
  method,
  path,
  headers = {},
  body,
}: {
  method: "GET" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );

    const req: any = {
      method,
      url: path,
      originalUrl: path,
      path,
      headers: normalizedHeaders,
      body,
      get(name: string) {
        return normalizedHeaders[name.toLowerCase()];
      },
      header(name: string) {
        return normalizedHeaders[name.toLowerCase()];
      },
    };

    const res: any = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: any) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };

    settingsRouter.handle(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      if (!res.headersSent) {
        resolve({ status: res.statusCode, body: null });
      }
    });
  });
}

describe("settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await invokeSettingsRoute({
      method: "GET",
      path: "/",
    });

    expect(res.status).toBe(401);
  });

  it("rejects invalid payload", async () => {
    const res = await invokeSettingsRoute({
      method: "PATCH",
      path: "/",
      headers: { "x-test-user-id": "user_1" },
      body: { profile: { fullName: "" } },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid payload");
  });

  it("updates settings with avatar", async () => {
    (prisma.userProfile.upsert as any).mockResolvedValue({ id: "profile_1" });
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "owner@example.com",
      profile: {
        fullName: "Owner",
        businessName: "Talexia",
        website: "https://talexia.ai",
        industry: "hospitality",
        timezone: "UTC",
        bio: "Bio",
        avatarStorageKey: "user/user_1/avatar.png",
        avatarContentType: "image/png",
        updatedAt: new Date("2026-02-23T00:00:00Z"),
      },
    });

    const res = await invokeSettingsRoute({
      method: "PATCH",
      path: "/",
      headers: { "x-test-user-id": "user_1" },
      body: {
        profile: {
          fullName: "Owner",
          bio: "Bio",
          avatar: {
            storageKey: "user/user_1/avatar.png",
            contentType: "image/png",
          },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(prisma.userProfile.upsert).toHaveBeenCalled();
    expect(res.body.profile.avatar.storageKey).toBe("user/user_1/avatar.png");
    expect(res.body.profile.avatar.url).toContain("cdn.example.com/user/user_1/avatar.png");
  });

  it("removes profile photo", async () => {
    (prisma.userProfile.upsert as any).mockResolvedValue({ id: "profile_1" });
    (prisma.user.findUnique as any).mockResolvedValue({
      email: "owner@example.com",
      profile: {
        fullName: "Owner",
        businessName: null,
        website: null,
        industry: null,
        timezone: null,
        bio: null,
        avatarStorageKey: null,
        avatarContentType: null,
        updatedAt: new Date("2026-02-23T00:00:00Z"),
      },
    });

    const res = await invokeSettingsRoute({
      method: "DELETE",
      path: "/photo",
      headers: { "x-test-user-id": "user_1" },
    });

    expect(res.status).toBe(200);
    expect(res.body.profile.avatar.storageKey).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const adminPostServiceMock = {
  createPostAsUser: vi.fn(),
  getAdminPostsForUser: vi.fn(),
  cancelAdminPost: vi.fn(),
  getUserConnectedPlatforms: vi.fn(),
  getUserMedia: vi.fn(),
  approveAdminPost: vi.fn(),
};

vi.mock("../../src/middleware/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "admin-1", role: "ADMIN" };
    next();
  },
}));

vi.mock("../../src/middleware/requireAdminPostPermission", () => ({
  requireAdminPostPermission: (_req: any, _res: any, next: any) => next(),
  validatePostAsUserPermission: vi.fn(),
}));

vi.mock("../../src/modules/admin/admin-post-service", () => ({
  AdminPostService: class {
    createPostAsUser = adminPostServiceMock.createPostAsUser;
    getAdminPostsForUser = adminPostServiceMock.getAdminPostsForUser;
    cancelAdminPost = adminPostServiceMock.cancelAdminPost;
    getUserConnectedPlatforms = adminPostServiceMock.getUserConnectedPlatforms;
    getUserMedia = adminPostServiceMock.getUserMedia;
    approveAdminPost = adminPostServiceMock.approveAdminPost;
  },
}));

import { app } from "../../src/app";
import { validatePostAsUserPermission } from "../../src/middleware/requireAdminPostPermission";

describe("Admin post routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects scheduled posts without timezone offset", async () => {
    adminPostServiceMock.createPostAsUser.mockResolvedValue({
      post: { id: "post-1" },
      targets: [],
      requiresApproval: false,
    });

    const res = await request(app)
      .post("/api/admin/users/user-1/posts")
      .send({
        content: { caption: "Hello" },
        platforms: ["INSTAGRAM"],
        publishMode: "SCHEDULE",
        scheduledFor: "2026-02-01T10:00",
        reason: "Test",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("scheduledFor must include a timezone offset");
    expect(adminPostServiceMock.createPostAsUser).not.toHaveBeenCalled();
  });

  it("blocks access to connected platforms when permission is revoked", async () => {
    (validatePostAsUserPermission as any).mockResolvedValue({
      allowed: false,
      requiresApproval: false,
      error: "User has revoked admin posting permission",
    });

    const res = await request(app).get("/api/admin/users/user-1/connected-platforms");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User has revoked admin posting permission");
  });

  it("blocks access to user media when permission is revoked", async () => {
    (validatePostAsUserPermission as any).mockResolvedValue({
      allowed: false,
      requiresApproval: false,
      error: "User has revoked admin posting permission",
    });

    const res = await request(app).get("/api/admin/users/user-1/media");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("User has revoked admin posting permission");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { requireAdmin } from "../src/middleware/requireAdmin";
import { requireAuth } from "../src/middleware/requireAuth";
import { prisma } from "../src/lib/prisma";
import { verifyAccessToken } from "../src/utils/tokens";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../src/utils/tokens", () => ({
  verifyAccessToken: vi.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
};

const mockedVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
}

describe("requireAdmin", () => {
  it("blocks non-admin roles", () => {
    const req = { user: { role: "USER" } } as any;
    const res = createRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows admin roles", () => {
    const req = { user: { role: "ADMIN" } } as any;
    const res = createRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe("requireAuth", () => {
  beforeEach(() => {
    mockedPrisma.user.findUnique.mockReset();
    mockedVerify.mockReset();
  });

  it("blocks blocked users", async () => {
    mockedVerify.mockReturnValue({ id: "user-1" });
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "blocked@example.com",
      role: "USER",
      isFounder: false,
      status: "BLOCKED",
    } as any);

    const req = { cookies: { token: "token" } } as any;
    const res = createRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks deleted users", async () => {
    mockedVerify.mockReturnValue({ id: "user-2" });
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      email: "deleted@example.com",
      role: "USER",
      isFounder: false,
      status: "DELETED",
    } as any);

    const req = { cookies: { token: "token" } } as any;
    const res = createRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows active users", async () => {
    mockedVerify.mockReturnValue({ id: "user-3" });
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-3",
      email: "active@example.com",
      role: "USER",
      isFounder: false,
      status: "ACTIVE",
    } as any);

    const req = { cookies: { token: "token" } } as any;
    const res = createRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

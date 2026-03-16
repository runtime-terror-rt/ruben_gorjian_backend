import { describe, expect, it, vi, beforeEach } from "vitest";
import { hasExceededVerificationResendLimit } from "../src/modules/admin/limits";
import { prisma } from "../src/lib/prisma";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    auditLog: {
      count: vi.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  auditLog: { count: ReturnType<typeof vi.fn> };
};

describe("hasExceededVerificationResendLimit", () => {
  beforeEach(() => {
    mockedPrisma.auditLog.count.mockReset();
  });

  it("returns false when under limit", async () => {
    mockedPrisma.auditLog.count.mockResolvedValue(2);
    const result = await hasExceededVerificationResendLimit("user-1", 3);
    expect(result).toBe(false);
  });

  it("returns true when at limit", async () => {
    mockedPrisma.auditLog.count.mockResolvedValue(3);
    const result = await hasExceededVerificationResendLimit("user-1", 3);
    expect(result).toBe(true);
  });
});

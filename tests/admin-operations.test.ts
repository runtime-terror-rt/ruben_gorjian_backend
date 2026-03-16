import { describe, expect, it, vi, beforeEach } from "vitest";
import { getOrCreateAdminOperation } from "../src/modules/admin/operations";
import { prisma } from "../src/lib/prisma";

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    adminOperation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  adminOperation: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe("getOrCreateAdminOperation", () => {
  beforeEach(() => {
    mockedPrisma.adminOperation.create.mockReset();
    mockedPrisma.adminOperation.findUnique.mockReset();
  });

  it("creates a new operation when key is unused", async () => {
    mockedPrisma.adminOperation.create.mockResolvedValue({ id: "op-1" } as any);

    const result = await getOrCreateAdminOperation("key-1", "admin-1", "RESEND_VERIFICATION", "user-1");

    expect(result?.id).toBe("op-1");
    expect(mockedPrisma.adminOperation.create).toHaveBeenCalled();
  });

  it("returns existing operation on unique conflict", async () => {
    const error = new Error("Unique") as any;
    error.code = "P2002";
    mockedPrisma.adminOperation.create.mockRejectedValue(error);
    mockedPrisma.adminOperation.findUnique.mockResolvedValue({ id: "op-2" } as any);

    const result = await getOrCreateAdminOperation("key-2", "admin-1", "CANCEL_SUBSCRIPTION", "user-2");

    expect(result?.id).toBe("op-2");
    expect(mockedPrisma.adminOperation.findUnique).toHaveBeenCalledWith({ where: { key: "key-2" } });
  });
});

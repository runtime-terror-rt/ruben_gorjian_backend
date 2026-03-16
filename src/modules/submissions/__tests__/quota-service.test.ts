import { describe, it, expect, vi } from "vitest";
import { reserveVisualQuota, creditVisualTopup } from "../quota-service";
import { prisma } from "../../../lib/prisma";

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

describe("quota-service", () => {
  it("should throw quota_exceeded when remaining is insufficient", async () => {
    const subscription = {
      currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
      plan: { baseVisualQuota: 2 },
    } as any;

    const mockTx = {
      usageMonthly: {
        upsert: vi.fn().mockResolvedValue({ id: "usage_1" }),
        findUnique: vi.fn().mockResolvedValue({
          id: "usage_1",
          visualsBonus: 0,
          visualsUsed: 1,
          visualsReserved: 1,
        }),
        update: vi.fn(),
      },
      visualQuotaLedger: {
        create: vi.fn(),
      },
      $queryRaw: vi.fn(),
    } as any;

    await expect(
      reserveVisualQuota(mockTx, {
        userId: "user_1",
        subscription,
        units: 1,
        submissionId: "sub_1",
      })
    ).rejects.toThrow("Quota exceeded");
  });

  it("should ignore duplicate Stripe events for top-ups", async () => {
    const subscription = {
      currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
      plan: { baseVisualQuota: 2 },
    } as any;

    const mockTx = {
      usageMonthly: {
        upsert: vi.fn().mockResolvedValue({ id: "usage_1" }),
        update: vi.fn(),
      },
      visualQuotaLedger: {
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
      },
      $queryRaw: vi.fn(),
    } as any;

    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(mockTx));

    await creditVisualTopup({
      userId: "user_1",
      subscription,
      units: 5,
      stripeEventId: "evt_123",
    });

    expect(mockTx.usageMonthly.update).not.toHaveBeenCalled();
  });
});

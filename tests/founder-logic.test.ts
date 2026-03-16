import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isFounderEligible } from "../src/modules/billing/founder";
import { prisma } from "../src/lib/prisma";

vi.mock("../src/lib/prisma", () => {
  const user = { findUnique: vi.fn() };
  const founder = { count: vi.fn() };
  const subscription = { count: vi.fn() };
  const $executeRaw = vi.fn();
  const $transaction = vi.fn(async (callback: any) => callback({ user, founder, subscription, $executeRaw }));
  return { prisma: { user, founder, subscription, $transaction } };
});

const mockedPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  founder: { count: ReturnType<typeof vi.fn> };
  subscription: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("isFounderEligible", () => {
  beforeEach(() => {
    mockedPrisma.user.findUnique.mockReset();
    mockedPrisma.founder.count.mockReset();
    mockedPrisma.subscription.count.mockReset();
    mockedPrisma.$transaction.mockClear();
  });

  afterEach(() => {
  });

  it("returns true for existing founder regardless of counts", async () => {
    vi.useFakeTimers({ now: new Date("2025-01-01").getTime() });
    mockedPrisma.user.findUnique.mockResolvedValue({ isFounder: true } as any);
    const eligible = await isFounderEligible("user-1");
    expect(eligible).toBe(true);
    vi.useRealTimers();
  });

  it("returns true when under founder cap before cutoff", async () => {
    vi.useFakeTimers({ now: new Date("2025-01-01").getTime() });
    mockedPrisma.user.findUnique.mockResolvedValue({ isFounder: false } as any);
    mockedPrisma.founder.count.mockResolvedValue(10 as any);
    mockedPrisma.subscription.count.mockResolvedValue(5 as any);

    const eligible = await isFounderEligible("user-2");
    expect(eligible).toBe(true);
    vi.useRealTimers();
  });

  it("returns false when cap reached", async () => {
    vi.useFakeTimers({ now: new Date("2025-01-01").getTime() });
    mockedPrisma.user.findUnique.mockResolvedValue({ isFounder: false } as any);
    mockedPrisma.founder.count.mockResolvedValue(20 as any);
    mockedPrisma.subscription.count.mockResolvedValue(5 as any);

    const eligible = await isFounderEligible("user-3");
    expect(eligible).toBe(false);
    vi.useRealTimers();
  });

  it("returns false after cutoff date", async () => {
    vi.useFakeTimers({ now: new Date("2027-01-01").getTime() });
    mockedPrisma.user.findUnique.mockResolvedValue({ isFounder: false } as any);

    const eligible = await isFounderEligible("user-4");
    expect(eligible).toBe(false);
    vi.useRealTimers();
  });
});

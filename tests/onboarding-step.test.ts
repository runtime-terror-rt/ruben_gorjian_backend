import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma";
import { router as brandRouter } from "../src/modules/brand/routes";
import express from "express";
import request from "supertest";
import { signAccessToken } from "../src/utils/tokens";

vi.mock("../src/lib/prisma", () => {
  const brandProfile = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  const user = {
    update: vi.fn(),
    findUnique: vi.fn(),
  };
  return { prisma: { brandProfile, user } };
});

const mockedPrisma = prisma as unknown as {
  brandProfile: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  user: { update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/brand", brandRouter);
  return app;
}

describe("Onboarding step persistence", () => {
  const token = signAccessToken({ id: "user-1", email: "test@example.com", role: "USER" } as any);

  beforeEach(() => {
    mockedPrisma.brandProfile.upsert.mockReset();
    mockedPrisma.user.update.mockReset();
    mockedPrisma.brandProfile.findUnique.mockReset();
    mockedPrisma.user.findUnique.mockReset();
  });

  it("saves step and does not mark completed before final", async () => {
    mockedPrisma.brandProfile.upsert.mockResolvedValue({ userId: "user-1" } as any);
    mockedPrisma.user.update.mockResolvedValue({ id: "user-1" } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      role: "USER",
      status: "ACTIVE",
    } as any);
    const app = createApp();
    const res = await request(app)
      .post("/brand")
      .set("Authorization", `Bearer ${token}`)
      .send({ industry: "Coffee", step: 1 });
    expect(res.status).toBe(200);
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { onboardingCompleted: false, onboardingStep: 1 },
    });
  });

  it("marks completed on final step", async () => {
    mockedPrisma.brandProfile.upsert.mockResolvedValue({ userId: "user-1" } as any);
    mockedPrisma.user.update.mockResolvedValue({ id: "user-1" } as any);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      role: "USER",
      status: "ACTIVE",
    } as any);
    const app = createApp();
    const res = await request(app)
      .post("/brand")
      .set("Authorization", `Bearer ${token}`)
      .send({ industry: "Coffee", step: 3 });
    expect(res.status).toBe(200);
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { onboardingCompleted: true, onboardingStep: 3 },
    });
  });
});

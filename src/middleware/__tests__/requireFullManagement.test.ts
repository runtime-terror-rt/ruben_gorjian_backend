import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { requireFullManagement } from "../requireFullManagement";
import { prisma } from "../../lib/prisma";
import { PlanCategory } from "../../types/plan-category";

// Mock Prisma
vi.mock("../../lib/prisma", () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(),
    },
  },
}));

describe("requireFullManagement middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      user: {
        id: "user_123",
        email: "test@example.com",
      } as any,
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();

    vi.clearAllMocks();
  });

  it("should return 401 if user is not authenticated", async () => {
    mockReq.user = undefined;

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should return 403 if user has no subscription", async () => {
    (prisma.subscription.findFirst as any).mockResolvedValue(null);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Full Management plan required",
      message: "This feature is only available to users with a Full Management plan.",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should return 403 if user has Calendar Only plan", async () => {
    const mockSubscription = {
      id: "sub_123",
      userId: "user_123",
      planCode: "CALENDAR_A",
      status: "ACTIVE",
      plan: {
        id: "plan_123",
        code: "CALENDAR_A",
        name: "Calendar Only A",
        category: PlanCategory.CALENDAR_ONLY,
      },
    };

    (prisma.subscription.findFirst as any).mockResolvedValue(mockSubscription);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Full Management plan required",
      message: "This feature is only available to users with a Full Management plan.",
      currentPlan: "Calendar Only A",
      currentCategory: PlanCategory.CALENDAR_ONLY,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should return 403 if user has Visual Add-On plan", async () => {
    const mockSubscription = {
      id: "sub_123",
      userId: "user_123",
      planCode: "VISUAL_20",
      status: "ACTIVE",
      plan: {
        id: "plan_123",
        code: "VISUAL_20",
        name: "Visual Add-On 20",
        category: PlanCategory.VISUAL_ADD_ON,
      },
    };

    (prisma.subscription.findFirst as any).mockResolvedValue(mockSubscription);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should allow access for Full Management plan", async () => {
    const mockSubscription = {
      id: "sub_123",
      userId: "user_123",
      planCode: "FM_25",
      status: "ACTIVE",
      plan: {
        id: "plan_123",
        code: "FM_25",
        name: "Full Management 25",
        category: PlanCategory.FULL_MANAGEMENT,
      },
    };

    (prisma.subscription.findFirst as any).mockResolvedValue(mockSubscription);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.subscription).toEqual(mockSubscription);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("should allow access for Jewelry Full Management plan", async () => {
    const mockSubscription = {
      id: "sub_123",
      userId: "user_123",
      planCode: "JFM_20",
      status: "ACTIVE",
      plan: {
        id: "plan_123",
        code: "JFM_20",
        name: "Jewelry Full Management 20",
        category: PlanCategory.JEWELRY_FULL_MANAGEMENT,
      },
    };

    (prisma.subscription.findFirst as any).mockResolvedValue(mockSubscription);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.subscription).toEqual(mockSubscription);
  });

  it("should allow access for TRIALING subscription", async () => {
    const mockSubscription = {
      id: "sub_123",
      userId: "user_123",
      planCode: "FM_25",
      status: "TRIALING",
      plan: {
        id: "plan_123",
        code: "FM_25",
        name: "Full Management 25",
        category: PlanCategory.FULL_MANAGEMENT,
      },
    };

    (prisma.subscription.findFirst as any).mockResolvedValue(mockSubscription);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it("should return 403 for CANCELED subscription", async () => {
    (prisma.subscription.findFirst as any).mockResolvedValue(null);

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should handle database errors gracefully", async () => {
    (prisma.subscription.findFirst as any).mockRejectedValue(new Error("Database error"));

    await requireFullManagement(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Failed to verify plan access",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });
});

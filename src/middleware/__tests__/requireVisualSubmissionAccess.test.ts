import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { requireVisualSubmissionAccess } from "../requireVisualSubmissionAccess";
import { prisma } from "../../lib/prisma";
import { PlanCategory } from "../../types/plan-category";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(),
    },
  },
}));

describe("requireVisualSubmissionAccess middleware", () => {
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

    await requireVisualSubmissionAccess(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should return 403 if user has no subscription", async () => {
    (prisma.subscription.findFirst as any).mockResolvedValue(null);

    await requireVisualSubmissionAccess(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should deny Calendar Only plans", async () => {
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

    await requireVisualSubmissionAccess(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("should allow Visual Add-On plans", async () => {
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

    await requireVisualSubmissionAccess(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockReq.subscription).toEqual(mockSubscription);
  });

  it("should allow Jewelry Visual plans", async () => {
    const mockSubscription = {
      id: "sub_123",
      userId: "user_123",
      planCode: "JV_40",
      status: "ACTIVE",
      plan: {
        id: "plan_123",
        code: "JV_40",
        name: "Jewelry Visual 40",
        category: PlanCategory.JEWELRY_VISUAL,
      },
    };

    (prisma.subscription.findFirst as any).mockResolvedValue(mockSubscription);

    await requireVisualSubmissionAccess(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it("should allow Full Management plans", async () => {
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

    await requireVisualSubmissionAccess(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });
});

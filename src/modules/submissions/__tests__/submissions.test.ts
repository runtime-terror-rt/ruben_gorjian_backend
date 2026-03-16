import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateSubmissionFile, validateEnhancedDeliveryFile, updateSubmissionStatus } from "../service";

// Mock Prisma - must be defined inside the factory
vi.mock("../../../lib/prisma", () => ({
  prisma: {
    submission: {
      update: vi.fn(),
    },
    submissionEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../../lib/prisma";

describe("Submission Service", () => {
  describe("validateSubmissionFile", () => {
    it("should accept valid PDF file", () => {
      const file = {
        fileName: "document.pdf",
        fileType: "application/pdf",
        fileSize: 5 * 1024 * 1024, // 5MB
      };

      const result = validateSubmissionFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept valid image files", () => {
      const jpgFile = {
        fileName: "image.jpg",
        fileType: "image/jpeg",
        fileSize: 2 * 1024 * 1024,
      };

      const pngFile = {
        fileName: "image.png",
        fileType: "image/png",
        fileSize: 3 * 1024 * 1024,
      };

      expect(validateSubmissionFile(jpgFile).valid).toBe(true);
      expect(validateSubmissionFile(pngFile).valid).toBe(true);
    });

    it("should accept valid video file", () => {
      const file = {
        fileName: "video.mp4",
        fileType: "video/mp4",
        fileSize: 50 * 1024 * 1024, // 50MB
      };

      const result = validateSubmissionFile(file);
      expect(result.valid).toBe(true);
    });

    it("should reject file that is too large", () => {
      const file = {
        fileName: "large.mp4",
        fileType: "video/mp4",
        fileSize: 150 * 1024 * 1024, // 150MB (over 100MB limit)
      };

      const result = validateSubmissionFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum");
    });

    it("should reject invalid file type", () => {
      const file = {
        fileName: "document.docx",
        fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileSize: 1 * 1024 * 1024,
      };

      const result = validateSubmissionFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not allowed");
    });

    it("should reject invalid file extension", () => {
      const file = {
        fileName: "file.exe",
        fileType: "application/pdf", // Type is valid but extension is not
        fileSize: 1 * 1024 * 1024,
      };

      const result = validateSubmissionFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("extension not allowed");
    });
  });

  describe("updateSubmissionStatus", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (prisma.$transaction as any).mockImplementation((callback: any) => callback(prisma));
    });

    it("should update submission status and create event", async () => {
      const mockSubmission = {
        id: "sub_123",
        userId: "user_123",
        status: "IN_REVIEW",
        userNote: null,
        adminNote: "Looks good",
        createdAt: new Date(),
        updatedAt: new Date(),
        files: [],
        events: [],
      };

      (prisma.submission.update as any).mockResolvedValue(mockSubmission);
      (prisma.submissionEvent.create as any).mockResolvedValue({
        id: "event_123",
        submissionId: "sub_123",
        status: "IN_REVIEW",
        note: "Looks good",
        createdBy: "admin_123",
        createdAt: new Date(),
      });

      const result = await updateSubmissionStatus(
        "sub_123",
        "IN_REVIEW",
        "Looks good",
        "admin_123"
      );

      expect(prisma.submission.update).toHaveBeenCalledWith({
        where: { id: "sub_123" },
        data: {
          status: "IN_REVIEW",
          adminNote: "Looks good",
        },
        include: {
          files: true,
          events: true,
        },
      });

      expect(prisma.submissionEvent.create).toHaveBeenCalledWith({
        data: {
          submissionId: "sub_123",
          status: "IN_REVIEW",
          note: "Looks good",
          createdBy: "admin_123",
          action: "STATUS_UPDATED",
          actorRole: "ADMIN",
        },
      });

      expect(result.status).toBe("IN_REVIEW");
    });

    it("should handle status transitions correctly", async () => {
      const statuses: Array<"SUBMITTED" | "IN_REVIEW" | "COMPLETED" | "REJECTED"> = [
        "SUBMITTED",
        "IN_REVIEW",
        "COMPLETED",
      ];

      for (const status of statuses) {
        const mockSubmission = {
          id: "sub_123",
          userId: "user_123",
          status,
          userNote: null,
          adminNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          files: [],
          events: [],
        };

        (prisma.submission.update as any).mockResolvedValue(mockSubmission);
        (prisma.submissionEvent.create as any).mockResolvedValue({
          id: `event_${status}`,
          submissionId: "sub_123",
          status,
          note: null,
          createdBy: "admin_123",
          createdAt: new Date(),
        });

        const result = await updateSubmissionStatus("sub_123", status, undefined, "admin_123");

        expect(result.status).toBe(status);
      }
    });

    it("should allow updating to REJECTED status", async () => {
      const mockSubmission = {
        id: "sub_123",
        userId: "user_123",
        status: "REJECTED",
        userNote: null,
        adminNote: "Does not meet requirements",
        createdAt: new Date(),
        updatedAt: new Date(),
        files: [],
        events: [],
      };

      (prisma.submission.update as any).mockResolvedValue(mockSubmission);
      (prisma.submissionEvent.create as any).mockResolvedValue({
        id: "event_rejected",
        submissionId: "sub_123",
        status: "REJECTED",
        note: "Does not meet requirements",
        createdBy: "admin_123",
        createdAt: new Date(),
      });

      const result = await updateSubmissionStatus(
        "sub_123",
        "REJECTED",
        "Does not meet requirements",
        "admin_123"
      );

      expect(result.status).toBe("REJECTED");
      expect(result.adminNote).toBe("Does not meet requirements");
    });
  });

  describe("validateEnhancedDeliveryFile", () => {
    it("should accept valid enhanced file types", () => {
      const file = {
        fileName: "enhanced.pdf",
        mimeType: "application/pdf",
        size: 2 * 1024 * 1024,
      };

      const result = validateEnhancedDeliveryFile(file);
      expect(result.valid).toBe(true);
    });

    it("should reject unsupported enhanced file types", () => {
      const file = {
        fileName: "script.exe",
        mimeType: "application/octet-stream",
        size: 1024,
      };

      const result = validateEnhancedDeliveryFile(file);
      expect(result.valid).toBe(false);
    });
  });
});

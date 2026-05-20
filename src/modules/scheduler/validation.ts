import { z } from "zod";
import { isValidSchedulerDateTimeInput } from "./functions";

function dateTimeString(field: string) {
  return z
    .string()
    .trim()
    .refine((value) => isValidSchedulerDateTimeInput(value), {
      message: `${field} must be a valid datetime`,
    });
}

export const schedulerMediaUserSchema = z.object({
  userId: z.string().optional(),
});

export const schedulerMediaFinalizeSchema = z.object({
  userId: z.string().optional(),
  assetIds: z.array(z.string().min(1)).min(1),
});

export const schedulerCreatePostSchema = z.object({
  userId: z.string().optional(),
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().min(1)).max(30).optional(),
  cta: z.string().max(280).nullable().optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  scheduledAt: dateTimeString("scheduledAt"),
  platforms: z.array(z.string().min(1)).min(1).optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerUpdatePostSchema = z.object({
  userId: z.string().optional(),
  caption: z.string().min(1).max(2200).optional(),
  hashtags: z.array(z.string().min(1)).max(30).optional(),
  cta: z.string().max(280).nullable().optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  scheduledAt: dateTimeString("scheduledAt").optional(),
  platforms: z.array(z.string().min(1)).min(1).optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerListQuerySchema = z.object({
  view: z.enum(["day", "week", "month", "list"]).optional().default("list"),
  date: z.string().date().optional(),
  from: dateTimeString("from").optional(),
  to: dateTimeString("to").optional(),
  status: z.string().optional(),
  scheduleType: z.string().optional(),
  sessionStatus: z.string().optional(),
  calendlySyncStatus: z.string().optional(),
  failure: z.coerce.boolean().optional(),
  userId: z.string().optional(),
  userEmail: z.string().email().optional(),
  platform: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const schedulerClientListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "DELETED"]).optional(),
});

export const schedulerFailureTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  userId: z.string().optional(),
  userEmail: z.string().email().optional(),
});

export const schedulerPublishStatusSchema = z.object({
  userId: z.string().optional(),
  status: z.enum(["completed", "failed"]),
  failureReason: z.string().max(500).nullable().optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerCreateSessionSchema = z.object({
  userId: z.string().optional(),
  scheduleType: z.enum(["PHOTO_SESSION", "VIDEO_SESSION"]),
  scheduledAt: dateTimeString("scheduledAt"),
  sessionTitle: z.string().max(220).nullable().optional(),
  sessionNotes: z.string().max(2000).nullable().optional(),
  sessionDurationMinutes: z.coerce.number().int().min(15).max(600),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerUpdateSessionSchema = z.object({
  userId: z.string().optional(),
  scheduledAt: dateTimeString("scheduledAt").optional(),
  sessionTitle: z.string().max(220).nullable().optional(),
  sessionNotes: z.string().max(2000).nullable().optional(),
  sessionDurationMinutes: z.coerce.number().int().min(15).max(600).optional(),
  replaceMedia: z.coerce.boolean().optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerUpdateSessionStatusSchema = z.object({
  userId: z.string().optional(),
  status: z.enum(["completed", "failed", "canceled"]),
  sessionFailureReason: z.string().max(1000).nullable().optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export function formatZodError(error: z.ZodError) {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    })),
  };
}

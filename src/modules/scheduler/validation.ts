import { z } from "zod";

function dateTimeString(field: string) {
  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: `${field} must be a valid ISO datetime`,
    })
    .transform((value) => new Date(value));
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
  socialAccountIds: z.array(z.string().min(1)).min(1),
  assetIds: z.array(z.string().min(1)).optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerUpdatePostSchema = z.object({
  userId: z.string().optional(),
  caption: z.string().min(1).max(2200).optional(),
  hashtags: z.array(z.string().min(1)).max(30).optional(),
  cta: z.string().max(280).nullable().optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  scheduledAt: dateTimeString("scheduledAt").optional(),
  socialAccountIds: z.array(z.string().min(1)).min(1).optional(),
  assetIds: z.array(z.string().min(1)).optional(),
  adminReason: z.string().max(500).nullable().optional(),
});

export const schedulerListQuerySchema = z.object({
  view: z.enum(["day", "week", "month", "list"]).optional().default("list"),
  date: z.string().date().optional(),
  from: dateTimeString("from").optional(),
  to: dateTimeString("to").optional(),
  status: z.string().optional(),
  failure: z.coerce.boolean().optional(),
  userId: z.string().optional(),
  platform: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const schedulerPublishStatusSchema = z.object({
  userId: z.string().optional(),
  status: z.enum(["completed", "failed"]),
  failureReason: z.string().max(500).nullable().optional(),
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

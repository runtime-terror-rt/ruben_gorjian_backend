import express from "express";
import multer from "multer";
import { PostStatus, ScheduleType, SessionStatus, SocialPlatform } from "@prisma/client";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { SchedulerService } from "./service";
import { parseEnumQueryList } from "./functions";
import {
  schedulerClientListQuerySchema,
  schedulerCreateSessionSchema,
  schedulerFailureTicketsQuerySchema,
  formatZodError,
  schedulerListQuerySchema,
  schedulerCreatePostSchema,
  schedulerPublishStatusSchema,
  schedulerUpdateSessionSchema,
  schedulerUpdateSessionStatusSchema,
  schedulerUpdatePostSchema,
} from "./validation";

const router = express.Router();
const schedulerService = new SchedulerService();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 20,
    fileSize: 100 * 1024 * 1024,
  },
});

const platformMap: Record<string, SocialPlatform> = {
  instagram: SocialPlatform.INSTAGRAM,
  facebook: SocialPlatform.FACEBOOK,
  linkedin: SocialPlatform.LINKEDIN,
  tiktok: SocialPlatform.TIKTOK,
};

const postStatusMap: Record<string, PostStatus> = {
  draft: PostStatus.DRAFT,
  scheduled: PostStatus.SCHEDULED,
  publishing: PostStatus.PUBLISHING,
  posted: PostStatus.POSTED,
  failed: PostStatus.FAILED,
};

const scheduleTypeMap: Record<string, ScheduleType> = {
  posting: ScheduleType.POSTING,
  photo_session: ScheduleType.PHOTO_SESSION,
  video_session: ScheduleType.VIDEO_SESSION,
};

const sessionStatusMap: Record<string, SessionStatus> = {
  booked: SessionStatus.BOOKED,
  completed: SessionStatus.COMPLETED,
  failed: SessionStatus.FAILED,
  canceled: SessionStatus.CANCELED,
};

function resolveSessionError(message: string) {
  const lowered = message.toLowerCase();
  if (message.startsWith("VIDEO_SESSION_NOT_INCLUDED:")) {
    return {
      statusCode: 403,
      code: "VIDEO_SESSION_NOT_INCLUDED",
      message: message.replace("VIDEO_SESSION_NOT_INCLUDED:", "").trim(),
    };
  }
  if (message.startsWith("VIDEO_SESSION_HOURS_EXCEEDED:")) {
    return {
      statusCode: 403,
      code: "VIDEO_SESSION_HOURS_EXCEEDED",
      message: message.replace("VIDEO_SESSION_HOURS_EXCEEDED:", "").trim(),
    };
  }
  if (message.startsWith("SCHEDULE_90_MIN_CONFLICT:")) {
    return {
      statusCode: 400,
      code: "SCHEDULE_90_MIN_CONFLICT",
      message: message.replace("SCHEDULE_90_MIN_CONFLICT:", "").trim(),
    };
  }

  if (
    lowered.includes("not allowed") ||
    lowered.includes("not available for your current plan") ||
    lowered.includes("active subscription is required") ||
    lowered.includes("reached your") ||
    lowered.includes("no remaining") ||
    lowered.includes("only admin")
  ) {
    return { statusCode: 403, message };
  }
  if (lowered.includes("not found")) return { statusCode: 404, message };
  return { statusCode: 400, message };
}

router.use(requireAuth);

router.get("/clients", requireAdmin, async (req, res) => {
  const parsed = schedulerClientListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler client filters", details: formatZodError(parsed.error) });
  }

  try {
    const result = await schedulerService.listSchedulerClients(req.user!, parsed.data);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to fetch scheduler clients",
    });
  }
});

router.post("/posts", upload.array("files", 20), async (req, res) => {
  const rawData = req.body?.data;
  if (typeof rawData !== "string" || !rawData.trim()) {
    return res.status(400).json({
      error: "Invalid scheduler post payload",
      details: {
        issues: [
          {
            path: "data",
            message: "data is required and must be a JSON string",
            code: "invalid_type",
          },
        ],
      },
    });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawData);
  } catch (error) {
    return res.status(400).json({
      error: "Invalid scheduler post payload",
      details: {
        issues: [
          {
            path: "data",
            message: "data must be a valid JSON string",
            code: "invalid_json",
          },
        ],
      },
    });
  }

  const parsed = schedulerCreatePostSchema.safeParse(parsedPayload);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler post payload", details: formatZodError(parsed.error) });
  }

  const files = ((req as any).files ?? []) as Array<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }>;

  try {
    let uploadedAssetIds: string[] = [];
    if (files.length > 0) {
      const uploaded = await schedulerService.uploadMediaFiles(req.user!, {
        userId: parsed.data.userId,
        files,
      });
      uploadedAssetIds = uploaded.media.map((item) => item.id);
    }

    const result = await schedulerService.createScheduledPost(req.user!, {
      ...parsed.data,
      uploadedAssetIds,
    });
    return res.status(201).json({ post: result });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to create scheduled post",
    });
  }
});

router.patch("/posts/:id", async (req, res) => {
  const parsed = schedulerUpdatePostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler update payload", details: formatZodError(parsed.error) });
  }

  const postId = req.params.id as string;

  try {
    const result = await schedulerService.updateScheduledPost(req.user!, postId, parsed.data);
    return res.json({ post: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update scheduled post";
    const statusCode = message.includes("not found") ? 404 : 400;
    return res.status(statusCode).json({ error: message });
  }
});

router.delete("/posts/:id", async (req, res) => {
  const postId = req.params.id as string;

  try {
    const result = await schedulerService.deleteScheduledPost(req.user!, postId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete scheduled post";
    const statusCode = message.includes("not found") ? 404 : 400;
    return res.status(statusCode).json({ error: message });
  }
});

router.get("/posts/:id", async (req, res) => {
  const postId = req.params.id as string;

  try {
    const post = await schedulerService.getScheduledPost(req.user!, postId);
    return res.json({
      post,
      meta: {
        count: 1,
        totalCount: 1,
        page: 1,
        pageSize: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch scheduled post";
    const statusCode = message.includes("not found") ? 404 : 400;
    return res.status(statusCode).json({ error: message });
  }
});

router.patch("/posts/:id/publish-status", requireAuth, requireAdmin, async (req, res) => {
  const parsed = schedulerPublishStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid publish status payload", details: formatZodError(parsed.error) });
  }

  const postId = req.params.id as string;

  try {
    const post = await schedulerService.updatePublishStatus(req.user!, postId, parsed.data);
    return res.json({ post });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update publish status";
    const statusCode = message.includes("not found") ? 404 : 400;
    return res.status(statusCode).json({ error: message });
  }
});

router.post("/sessions", upload.array("files", 20), async (req, res) => {
  let payload: unknown = req.body;
  if (typeof req.body?.data === "string" && req.body.data.trim()) {
    try {
      payload = JSON.parse(req.body.data);
    } catch {
      return res.status(400).json({
        error: "Invalid scheduler session payload",
        details: { issues: [{ path: "data", message: "data must be valid JSON", code: "invalid_json" }] },
      });
    }
  }

  const parsed = schedulerCreateSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler session payload", details: formatZodError(parsed.error) });
  }

  const files = ((req as any).files ?? []) as Array<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }>;

  try {
    let uploadedAssetIds: string[] = [];
    if (files.length > 0) {
      const uploaded = await schedulerService.uploadMediaFiles(req.user!, {
        userId: parsed.data.userId,
        files,
      });
      uploadedAssetIds = uploaded.media.map((item) => item.id);
    }

    const session = await schedulerService.createScheduledSession(req.user!, {
      ...parsed.data,
      uploadedAssetIds,
    });
    return res.status(201).json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session";
    const resolved = resolveSessionError(message);
    return res.status(resolved.statusCode).json({
      error: resolved.message,
      ...(resolved.code ? { code: resolved.code } : {}),
    });
  }
});

router.patch("/sessions/:id", upload.array("files", 20), async (req, res) => {
  let payload: unknown = req.body;
  if (typeof req.body?.data === "string" && req.body.data.trim()) {
    try {
      payload = JSON.parse(req.body.data);
    } catch {
      return res.status(400).json({
        error: "Invalid scheduler session update payload",
        details: { issues: [{ path: "data", message: "data must be valid JSON", code: "invalid_json" }] },
      });
    }
  }

  const parsed = schedulerUpdateSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler session update payload", details: formatZodError(parsed.error) });
  }

  const sessionId = req.params.id as string;
  const files = ((req as any).files ?? []) as Array<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }>;

  try {
    let uploadedAssetIds: string[] = [];
    if (files.length > 0) {
      const uploaded = await schedulerService.uploadMediaFiles(req.user!, {
        userId: parsed.data.userId,
        files,
      });
      uploadedAssetIds = uploaded.media.map((item) => item.id);
    }

    const session = await schedulerService.updateScheduledSession(req.user!, sessionId, {
      ...parsed.data,
      uploadedAssetIds,
    });
    return res.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update session";
    const resolved = resolveSessionError(message);
    return res.status(resolved.statusCode).json({
      error: resolved.message,
      ...(resolved.code ? { code: resolved.code } : {}),
    });
  }
});

router.patch("/sessions/:id/status", requireAuth, requireAdmin, async (req, res) => {
  const parsed = schedulerUpdateSessionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler session status payload", details: formatZodError(parsed.error) });
  }

  const sessionId = req.params.id as string;

  try {
    const session = await schedulerService.updateScheduledSessionStatus(req.user!, sessionId, parsed.data);
    return res.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update session status";
    const resolved = resolveSessionError(message);
    return res.status(resolved.statusCode).json({
      error: resolved.message,
      ...(resolved.code ? { code: resolved.code } : {}),
    });
  }
});

router.get("/posts", async (req, res) => {
  const parsed = schedulerListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid scheduler filters", details: formatZodError(parsed.error) });
  }

  try {
    const statuses = parseEnumQueryList(parsed.data.status, postStatusMap, "status");
    const scheduleTypes = parseEnumQueryList(parsed.data.scheduleType, scheduleTypeMap, "scheduleType");
    const sessionStatuses = parseEnumQueryList(parsed.data.sessionStatus, sessionStatusMap, "sessionStatus");
    const platforms = parseEnumQueryList(parsed.data.platform, platformMap, "platform");
    const result = await schedulerService.listScheduledPosts(req.user!, {
      view: parsed.data.view,
      date: parsed.data.date ? new Date(`${parsed.data.date}T00:00:00.000Z`) : undefined,
      from: parsed.data.from,
      to: parsed.data.to,
      status: statuses,
      scheduleType: scheduleTypes,
      sessionStatus: sessionStatuses,
      failure: parsed.data.failure,
      userId: parsed.data.userId,
      userEmail: parsed.data.userEmail,
      platform: platforms,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to fetch scheduled posts",
    });
  }
});

router.get("/failure-tickets", requireAdmin, async (req, res) => {
  const parsed = schedulerFailureTicketsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid failure ticket filters",
      details: formatZodError(parsed.error),
    });
  }

  try {
    const result = await schedulerService.listFailureTickets(req.user!, parsed.data);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to fetch failure tickets",
    });
  }
});

export { router as schedulerRouter };

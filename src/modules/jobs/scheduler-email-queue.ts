import { JobsOptions, Queue, Worker } from "bullmq";
import { PostStatus, SessionStatus } from "@prisma/client";
import { getRedis } from "../../lib/redis";
import { logger } from "../../lib/logger";
import { sendSchedulerEmail } from "../scheduler/email";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";

const redis = getRedis();
const WEEK_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_BEFORE_MS = 24 * 60 * 60 * 1000;
const SCHEDULER_ADMIN_EMAIL = (env.SCHEDULER_ADMIN_EMAIL || "Office@talexia.us").trim();

type SchedulerReminderType = "WEEK_BEFORE" | "DAY_BEFORE";

type SchedulerEmailJob = {
  to: string;
  subject: string;
  body: string;
  context?: string;
  postId?: string;
  action?: string;
  reminderType?: SchedulerReminderType;
  scheduledForIso?: string;
};

export const schedulerEmailQueue =
  redis &&
  new Queue("scheduler-email", {
    connection: redis as any,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

export function startSchedulerEmailQueueWorker(concurrency = 3) {
  if (!redis) {
    logger.warn("Redis not configured; scheduler email queue worker not started");
    return;
  }

  const worker = new Worker(
    "scheduler-email",
    async (job) => {
      const payload = job.data as SchedulerEmailJob;

      if (payload.context === "scheduler-reminder" && payload.postId) {
        await processSchedulerReminderJob(payload.postId, payload.reminderType, payload.scheduledForIso);
        return { sent: true };
      }

      const sent = await sendSchedulerEmail({
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
      });

      if (!sent.sent) {
        throw new Error(sent.reason || "Unknown email send failure");
      }

      return { sent: true };
    },
    {
      connection: redis as any,
      concurrency,
    }
  );

  worker.on("completed", (job) => {
    logger.info("Scheduler email job completed", {
      id: job.id,
      to: job.data?.to,
      subject: job.data?.subject,
      postId: job.data?.postId,
      action: job.data?.action,
      context: job.data?.context,
    });
  });

  worker.on("failed", (job, err) => {
    logger.error("Scheduler email job failed", {
      id: job?.id,
      to: job?.data?.to,
      subject: job?.data?.subject,
      postId: job?.data?.postId,
      action: job?.data?.action,
      context: job?.data?.context,
      error: err?.message || "Unknown error",
    });
  });

  logger.info("Scheduler email queue worker started");
}

function getReminderJobId(postId: string, type: SchedulerReminderType) {
  const key = type === "WEEK_BEFORE" ? "week-before" : "day-before";
  return `scheduler-reminder:${postId}:${key}`;
}

function buildReminderPayload(args: {
  postId: string;
  scheduleType: string;
  scheduledForIso: string;
  reminderType: SchedulerReminderType;
}) {
  const isWeek = args.reminderType === "WEEK_BEFORE";
  const leadText = isWeek ? "in 1 week" : "in 24 hours";
  const scheduleLabel = args.scheduleType.split("_").join(" ");
  const subject = `Reminder: ${scheduleLabel} is ${leadText}`;
  const body =
    `Hello,\n\n` +
    `This is a reminder that your ${scheduleLabel.toLowerCase()} is scheduled ${leadText}.\n` +
    `Schedule ID: ${args.postId}\n` +
    `Scheduled At (UTC): ${args.scheduledForIso}`;

  return { subject, body };
}

function isReminderEligible(post: {
  status: PostStatus;
  sessionStatus: SessionStatus | null;
  scheduledFor: Date | null;
}) {
  if (!post.scheduledFor) return false;
  if (post.scheduledFor.getTime() <= Date.now()) return false;

  if (post.status === "POSTED" || post.status === "FAILED") {
    return false;
  }

  if (
    post.sessionStatus === "COMPLETED" ||
    post.sessionStatus === "FAILED" ||
    post.sessionStatus === "CANCELED"
  ) {
    return false;
  }

  return true;
}

async function processSchedulerReminderJob(
  postId: string,
  reminderType?: SchedulerReminderType,
  expectedScheduledForIso?: string
) {
  if (!reminderType) {
    logger.warn("Scheduler reminder skipped: missing reminderType", { postId });
    return;
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      scheduleType: true,
      status: true,
      sessionStatus: true,
      scheduledFor: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!post || !post.user.email) {
    logger.info("Scheduler reminder skipped: post/user email missing", { postId, reminderType });
    return;
  }

  if (!isReminderEligible(post)) {
    logger.info("Scheduler reminder skipped: post not eligible", {
      postId,
      reminderType,
      status: post.status,
      sessionStatus: post.sessionStatus,
    });
    return;
  }

  const scheduledForIso = post.scheduledFor!.toISOString();
  if (expectedScheduledForIso && expectedScheduledForIso !== scheduledForIso) {
    logger.info("Scheduler reminder skipped: schedule changed", {
      postId,
      reminderType,
      expectedScheduledForIso,
      actualScheduledForIso: scheduledForIso,
    });
    return;
  }

  const recipients = Array.from(
    new Set(
      [post.user.email, SCHEDULER_ADMIN_EMAIL]
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0)
    )
  );

  await Promise.all(
    recipients.map(async (recipient) => {
      const { subject, body } = buildReminderPayload({
        postId,
        scheduleType: post.scheduleType,
        scheduledForIso,
        reminderType,
      });
      const sent = await sendSchedulerEmail({
        to: recipient,
        subject: recipient === post.user.email.toLowerCase() ? subject : `[Admin] ${subject}`,
        body,
      });

      if (!sent.sent) {
        throw new Error(sent.reason || "Failed to send scheduler reminder email");
      }
    })
  );
}

export async function enqueueSchedulerEmail(
  data: SchedulerEmailJob,
  opts?: JobsOptions
) {
  if (!schedulerEmailQueue) {
    logger.warn("Redis not configured; skipping scheduler email enqueue", {
      to: data.to,
      subject: data.subject,
      postId: data.postId,
      action: data.action,
      context: data.context,
    });
    return false;
  }

  await schedulerEmailQueue.add("send-email", data, opts);
  logger.info("Scheduler email enqueued", {
    to: data.to,
    subject: data.subject,
    postId: data.postId,
    action: data.action,
    context: data.context,
  });
  return true;
}

export async function clearSchedulerReminderEmails(postId: string) {
  if (!schedulerEmailQueue) {
    logger.warn("Redis not configured; skipping scheduler reminder clear", { postId });
    return false;
  }

  const reminderTypes: SchedulerReminderType[] = ["WEEK_BEFORE", "DAY_BEFORE"];
  for (const reminderType of reminderTypes) {
    const jobId = getReminderJobId(postId, reminderType);
    const job = await schedulerEmailQueue.getJob(jobId);
    if (job) {
      try {
        await job.remove();
        logger.info("Scheduler reminder job removed", { postId, reminderType, jobId });
      } catch (error) {
        logger.warn("Failed removing scheduler reminder job", {
          postId,
          reminderType,
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return true;
}

export async function enqueueSchedulerReminderEmails(postId: string, scheduledAt: Date) {
  if (!schedulerEmailQueue) {
    logger.warn("Redis not configured; skipping scheduler reminder enqueue", { postId });
    return false;
  }

  await clearSchedulerReminderEmails(postId);

  const reminders: Array<{ type: SchedulerReminderType; delayMs: number }> = [
    { type: "WEEK_BEFORE", delayMs: scheduledAt.getTime() - Date.now() - WEEK_BEFORE_MS },
    { type: "DAY_BEFORE", delayMs: scheduledAt.getTime() - Date.now() - DAY_BEFORE_MS },
  ];

  for (const reminder of reminders) {
    if (reminder.delayMs <= 0) {
      logger.info("Scheduler reminder skipped due to past trigger window", {
        postId,
        reminderType: reminder.type,
        scheduledAt: scheduledAt.toISOString(),
      });
      continue;
    }

    const jobId = getReminderJobId(postId, reminder.type);
    await schedulerEmailQueue.add(
      "send-email",
      {
        to: SCHEDULER_ADMIN_EMAIL,
        subject: "scheduler-reminder-placeholder",
        body: "scheduler-reminder-placeholder",
        context: "scheduler-reminder",
        postId,
        reminderType: reminder.type,
        scheduledForIso: scheduledAt.toISOString(),
      },
      {
        delay: reminder.delayMs,
        jobId,
      }
    );

    logger.info("Scheduler reminder enqueued", {
      postId,
      reminderType: reminder.type,
      delayMs: reminder.delayMs,
      runAt: new Date(Date.now() + reminder.delayMs).toISOString(),
      jobId,
    });
  }

  return true;
}

import { Queue, Worker, JobsOptions, type ConnectionOptions } from "bullmq";
import { getRedis } from "../../lib/redis";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { buildTalexiaEmailHeader } from "../../lib/email-branding";

const redis = getRedis();
const bullmqConnection = redis as unknown as ConnectionOptions;

export const brandBriefReminderQueue =
  redis &&
  new Queue("brand-brief-reminder", {
    connection: bullmqConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

export function startBrandBriefReminderWorker(concurrency = 1) {
  if (!redis) {
    logger.warn("Redis not configured; brand brief reminder worker not started");
    return;
  }

  const worker = new Worker(
    "brand-brief-reminder",
    async (job) => {
      const userId = job.data.userId as string;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, brandBriefOnboardingCompleted: true, brandBriefReminderLevel: true },
      });

      if (!user) {
        logger.warn(`Reminder user not found`, { userId });
        return;
      }

      if (user.brandBriefOnboardingCompleted) {
        logger.info(`User completed brand brief, stopping reminders`, { userId });
        return;
      }

      const { CONTACT_FROM_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FRONTEND_URL, CONTACT_TO_EMAIL } = env;

      if (!CONTACT_FROM_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        throw new Error("Email not configured for reminders");
      }

      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });

      const currentLevel = user.brandBriefReminderLevel;
      const briefUrl = `${FRONTEND_URL || "https://app.talexia.us"}/dashboard`;
      
      const safeUserName = user.name || user.email;


      // Always send Reminder to User
      const userHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Action Required: Brand Brief", "We need your brand brief to start your service")}
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;color:#1e293b;font-size:16px;">Hi ${safeUserName},</p>
            <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">
              This is a friendly reminder that we need your Brand Brief to begin our service. The Brand Brief is the source material and authorization for everything we produce.
            </p>
            <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
              Please take a moment to submit your brief so we can get started!
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0f172a;border-radius:6px;">
                  <a href="${briefUrl}" style="display:block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Complete Brand Brief</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      await transporter.sendMail({
        from: CONTACT_FROM_EMAIL,
        to: user.email,
        subject: `Action Required: Please submit your Talexia Brand Brief`,
        text: `Hi ${safeUserName},\n\nWe need your Brand Brief to begin our service. Please complete it here: ${briefUrl}`,
        html: userHtml,
      });
      logger.info(`Reminder email (level ${currentLevel}) sent to user ${userId}`);

      // Escalation if level === 2 (which is the 3rd reminder since we start at 0)
      // wait, the job ran for the 3rd time when currentLevel === 2 (0=first, 1=second, 2=third)
      // Actually, the prompt says "after the 3rd reminder".
      // Let's just do it AT the 3rd reminder for safety or at level 3 (4th reminder).
      // "If the client still has not submitted after the 3rd reminder, send a one-time alert email"
      // "This escalation email is sent once (not every cycle). The automatic client reminders continue"
      if (currentLevel === 3) {
        const escalationEmail = CONTACT_TO_EMAIL || "office@talexia.us";
        await transporter.sendMail({
          from: CONTACT_FROM_EMAIL,
          to: escalationEmail,
          subject: `Action Required: Client ${safeUserName} has not submitted Brand Brief`,
          text: `Client ${safeUserName} (${user.email}) has not submitted their Brand Brief after 3 reminders.\nPlease follow up with them manually.`,
          html: `<p>Client <strong>${safeUserName}</strong> (${user.email}) has not submitted their Brand Brief after 3 reminders.</p><p>Please follow up with them manually.</p>`,
        });
        logger.info(`Escalation email sent for user ${userId}`);
      }

      // Schedule Next Job (if level 0 -> 24h, otherwise -> 48h)
      const nextLevel = currentLevel + 1;
      const delayMs = currentLevel === 0 ? 24 * 60 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000;

      await prisma.user.update({
        where: { id: userId },
        data: { 
          brandBriefReminderLevel: nextLevel,
          brandBriefLastReminderAt: new Date()
        }
      });

      await enqueueBrandBriefReminder(userId, delayMs);
      return { success: true, nextLevel };
    },
    {
      connection: bullmqConnection,
      concurrency,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(`Brand brief reminder job failed`, { 
      id: job?.id, 
      userId: job?.data?.userId,
      error: err?.message,
    });
  });

  logger.info("Brand brief reminder worker started");
}

export async function enqueueBrandBriefReminder(userId: string, delayMs: number = 3 * 60 * 60 * 1000) {
  if (!brandBriefReminderQueue) {
    logger.warn("Redis not configured; skipping reminder enqueue");
    return false;
  }
  
  await brandBriefReminderQueue.add("reminder", { userId }, {
    delay: delayMs,
    removeOnComplete: true,
  });
  return true;
}

export async function clearBrandBriefReminders(userId: string) {
  if (!brandBriefReminderQueue) {
    return false;
  }

  try {
    const delayedJobs = await brandBriefReminderQueue.getDelayed();
    for (const job of delayedJobs) {
      if (job.data && job.data.userId === userId) {
        await job.remove();
        logger.info("Cleared brand brief reminder", { userId, jobId: job.id });
      }
    }
  } catch (error) {
    logger.warn("Failed to remove reminder job", { userId });
  }

  return true;
}

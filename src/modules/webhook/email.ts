import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { buildTalexiaEmailHeader, getTalexiaLogoAttachment } from "../../lib/email-branding";

type UploadPostWebhookEvent = {
  id: string;
  type:
    | "connect.success"
    | "connect.failed"
    | "post.created"
    | "post.processing"
    | "post.completed"
    | "post.failed"
    | "schedule.executed"
    | "schedule.failed";
  data: {
    username?: string;
    platform?: "facebook" | "instagram" | "tiktok";
    request_id?: string;
    job_id?: string;
    post_url?: string;
    error?: string;
  };
  timestamp: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildWebhookEmailHtml(event: UploadPostWebhookEvent) {
  const subject = `Upload-Post Webhook: ${event.type}`;
  const bodyLines = [
    `Event ID: ${event.id}`,
    `Type: ${event.type}`,
    `Timestamp: ${event.timestamp}`,
  ];

  if (event.data.username) bodyLines.push(`Username: ${event.data.username}`);
  if (event.data.platform) bodyLines.push(`Platform: ${event.data.platform}`);
  if (event.data.request_id) bodyLines.push(`Request ID: ${event.data.request_id}`);
  if (event.data.job_id) bodyLines.push(`Job ID: ${event.data.job_id}`);
  if (event.data.post_url) bodyLines.push(`Post URL: ${event.data.post_url}`);
  if (event.data.error) bodyLines.push(`Error: ${event.data.error}`);

  const bodyHtml = bodyLines
    .map((line) => `<p style="margin:0 0 10px;color:#475569;font-size:14px;line-height:1.7;">${escapeHtml(line)}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Webhook Notification", "Automated updates from Upload-Post")}
        <tr>
          <td style="padding:28px 36px 24px;">
            <h2 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:700;">${escapeHtml(subject)}</h2>
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">This is an automated webhook notification.</p>
            <p style="margin:6px 0 0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} Talexia. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

export async function sendUploadPostWebhookNotification(event: UploadPostWebhookEvent) {
  const transporter = buildTransporter();
  if (!transporter || !env.CONTACT_FROM_EMAIL) {
    logger.warn("Webhook email not sent: Email not configured");
    return { sent: false, reason: "Email not configured" };
  }

  const to = env.NOTIFICATION_TO_SEND_EMAIL;
  if (!to) {
    logger.warn("Webhook email not sent: No recipient configured");
    return { sent: false, reason: "No recipient configured" };
  }

  const subject = `Upload-Post Webhook: ${event.type}`;
  const body = [
    `Event ID: ${event.id}`,
    `Type: ${event.type}`,
    `Timestamp: ${event.timestamp}`,
    event.data.username ? `Username: ${event.data.username}` : "",
    event.data.platform ? `Platform: ${event.data.platform}` : "",
    event.data.request_id ? `Request ID: ${event.data.request_id}` : "",
    event.data.job_id ? `Job ID: ${event.data.job_id}` : "",
    event.data.post_url ? `Post URL: ${event.data.post_url}` : "",
    event.data.error ? `Error: ${event.data.error}` : "",
  ].filter(Boolean).join("\n");

  const logoAttachment = getTalexiaLogoAttachment();

  try {
    const html = buildWebhookEmailHtml(event);

    await transporter.sendMail({
      from: env.CONTACT_FROM_EMAIL,
      to,
      subject,
      text: body,
      html,
      ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    });
    logger.info("Webhook email sent", { to, subject, eventId: event.id });
    return { sent: true };
  } catch (error) {
    logger.error("Webhook email send failed", {
      to,
      subject,
      eventId: event.id,
      error,
    });
    return { sent: false, reason: "Email sending failed" };
  }
}
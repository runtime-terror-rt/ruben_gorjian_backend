import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { buildTalexiaEmailHeader, getTalexiaLogoAttachment } from "../../lib/email-branding";

type SchedulerEmailPayload = {
  to: string;
  subject: string;
  body: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSchedulerEmailHtml(payload: SchedulerEmailPayload) {
  const lines = payload.body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line.length === 0 && arr[index - 1]?.length === 0));

  const bodyHtml = lines
    .map((line) => (line.length === 0 ? "<br/>" : `<p style=\"margin:0 0 10px;color:#475569;font-size:14px;line-height:1.7;\">${escapeHtml(line)}</p>`))
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Scheduler Notification", "Automated updates from Talexia")}
        <tr>
          <td style="padding:28px 36px 24px;">
            <h2 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:700;">${escapeHtml(payload.subject)}</h2>
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">This message was sent to ${escapeHtml(payload.to)}.</p>
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

export async function sendSchedulerEmail(payload: SchedulerEmailPayload) {
  const transporter = buildTransporter();
  if (!transporter || !env.CONTACT_FROM_EMAIL) {
    return { sent: false, reason: "Email not configured" };
  }
  const logoAttachment = getTalexiaLogoAttachment();

  try {
    const html = buildSchedulerEmailHtml(payload);

    await transporter.sendMail({
      from: env.CONTACT_FROM_EMAIL,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      html,
      ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    });
    return { sent: true };
  } catch (error) {
    logger.error("Scheduler email send failed", {
      to: payload.to,
      subject: payload.subject,
      error,
    });
    return { sent: false, reason: "Email sending failed" };
  }
}

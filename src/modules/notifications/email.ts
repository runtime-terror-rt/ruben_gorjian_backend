import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { Submission } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { buildTalexiaEmailHeader, getTalexiaLogoAttachment } from "../../lib/email-branding";

interface SendSubmissionEmailParams {
  type: "created" | "status_updated" | "enhanced_delivery";
  submission: Submission & { user: { email: string; name: string | null } };
  recipientType: "user" | "admin";
  previousStatus?: string;
  deliveryMessage?: string;
}

type DetailRow = {
  label: string;
  value: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSubmissionEmailHtml(params: {
  eyebrow: string;
  title: string;
  greetingName?: string;
  intro: string;
  detailRows: DetailRow[];
  note?: string;
  cta?: {
    label: string;
    url: string;
  };
  closing?: string;
}) {
  const detailRowsHtml = params.detailRows
    .map(
      (row, index) => `
              <tr style="background:${index % 2 === 0 ? "#f8fafc" : "#ffffff"};">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;line-height:1.6;white-space:pre-wrap;">${escapeHtml(row.value)}</td>
              </tr>`
    )
    .join("");

  const noteHtml = params.note
    ? `
            <div style="margin-top:20px;padding:16px;border:1px solid #cbd5e1;border-left:4px solid #0f172a;border-radius:8px;background:#f8fafc;color:#334155;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(params.note)}</div>`
    : "";

  const ctaHtml = params.cta
    ? `
            <a href="${escapeHtml(params.cta.url)}" style="display:inline-block;margin-top:24px;padding:12px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">${escapeHtml(params.cta.label)}</a>`
    : "";

  const greetingHtml = params.greetingName ? `<p style="margin:0 0 18px;color:#1e293b;font-size:16px;">Hi ${escapeHtml(params.greetingName)},</p>` : "";
  const closingHtml = params.closing ? `<p style="margin:24px 0 0;color:#475569;font-size:15px;line-height:1.6;">${escapeHtml(params.closing)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader(params.eyebrow, params.title)}
        <tr>
          <td style="padding:40px 40px 32px;">
            ${greetingHtml}
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.7;">${escapeHtml(params.intro)}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              ${detailRowsHtml}
            </table>
            ${noteHtml}
            ${ctaHtml}
            ${closingHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} Talexia. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildSubmissionEmailText(params: {
  greetingName?: string;
  intro: string;
  detailRows: DetailRow[];
  note?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  closing?: string;
}) {
  const lines: string[] = [];

  if (params.greetingName) {
    lines.push(`Hi ${params.greetingName},`);
    lines.push("");
  }

  lines.push(params.intro);
  lines.push("");

  for (const row of params.detailRows) {
    lines.push(`${row.label}: ${row.value}`);
  }

  if (params.note) {
    lines.push("");
    lines.push(params.note);
  }

  if (params.ctaLabel && params.ctaUrl) {
    lines.push("");
    lines.push(`${params.ctaLabel}: ${params.ctaUrl}`);
  }

  if (params.closing) {
    lines.push("");
    lines.push(params.closing);
  }

  return lines.join("\n");
}

/**
 * Send email notification for submission events
 */
export async function sendSubmissionEmail(params: SendSubmissionEmailParams) {
  const { CONTACT_FROM_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL, FRONTEND_URL } = env;

  if (!CONTACT_FROM_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    logger.info("Email not configured, skipping submission notification");
    return { sent: false, reason: "Email not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  const logoAttachment = getTalexiaLogoAttachment();

  const { type, submission, recipientType, previousStatus, deliveryMessage } = params;
  const baseUrl = FRONTEND_URL || "http://localhost:3000";

  let subject: string;
  let body: string;
  let html: string | undefined;
  let to: string;

  if (recipientType === "admin") {
    // Email to admins
    if (type === "created") {
      const userName = submission.user.name || submission.user.email;
      const userNote = submission.userNote || undefined;
      
      subject = `[Talexia] New Submission from ${userName}`;
      body = buildSubmissionEmailText({
        intro: "A new submission has been received.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "From", value: `${userName} (${submission.user.email})` },
          { label: "Status", value: submission.status },
          { label: "Created", value: submission.createdAt.toLocaleString() },
        ],
        note: userNote ? `User Note:\n${userNote}` : undefined,
        ctaLabel: "View and manage this submission",
        ctaUrl: `${baseUrl}/admin/submissions`,
      });
      html = buildSubmissionEmailHtml({
        eyebrow: "New Submission",
        title: "New Submission Received",
        intro: "A new submission has been received.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "From", value: `${userName} (${submission.user.email})` },
          { label: "Status", value: submission.status },
          { label: "Created", value: submission.createdAt.toLocaleString() },
        ],
        note: userNote ? `User Note:\n${userNote}` : undefined,
        cta: {
          label: "View and manage this submission",
          url: `${baseUrl}/admin/submissions`,
        },
      });
      
      to = CONTACT_TO_EMAIL || SMTP_USER;
    } else {
      // Admins don't need status update emails currently
      return { sent: false, reason: "Admin status updates not enabled" };
    }
  } else {
    // Email to user
    to = submission.user.email;

    if (type === "created") {
      subject = "Submission Received - Talexia";
      body = buildSubmissionEmailText({
        greetingName: submission.user.name || "there",
        intro: "Your submission has been received and is awaiting review.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "Status", value: submission.status },
          { label: "Submitted", value: submission.createdAt.toLocaleString() },
        ],
        ctaLabel: "View submission dashboard",
        ctaUrl: `${baseUrl}/dashboard/submissions`,
        closing: "We'll notify you when there's an update. Best regards, The Talexia Team",
      });
      html = buildSubmissionEmailHtml({
        eyebrow: "Submission Received",
        title: "Submission Received",
        greetingName: submission.user.name || "there",
        intro: "Your submission has been received and is awaiting review.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "Status", value: submission.status },
          { label: "Submitted", value: submission.createdAt.toLocaleString() },
        ],
        cta: {
          label: "View submission dashboard",
          url: `${baseUrl}/dashboard/submissions`,
        },
        closing: "We'll notify you when there's an update. Best regards, The Talexia Team",
      });
    } else if (type === "enhanced_delivery") {
      const messageBlock = deliveryMessage || undefined;
      subject = "Enhanced Submission Ready - Talexia";
      body = buildSubmissionEmailText({
        greetingName: submission.user.name || "there",
        intro: "Your enhanced submission files are ready.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "Status", value: submission.status },
          { label: "Updated", value: submission.updatedAt.toLocaleString() },
        ],
        note: messageBlock ? `Admin Message:\n${messageBlock}` : undefined,
        ctaLabel: "View enhanced delivery",
        ctaUrl: `${baseUrl}/dashboard/submissions`,
        closing: "Best regards, The Talexia Team",
      });
      html = buildSubmissionEmailHtml({
        eyebrow: "Enhanced Submission Ready",
        title: "Enhanced Submission Ready",
        greetingName: submission.user.name || "there",
        intro: "Your enhanced submission files are ready.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "Status", value: submission.status },
          { label: "Updated", value: submission.updatedAt.toLocaleString() },
        ],
        note: messageBlock ? `Admin Message:\n${messageBlock}` : undefined,
        cta: {
          label: "View enhanced delivery",
          url: `${baseUrl}/dashboard/submissions`,
        },
        closing: "Best regards, The Talexia Team",
      });
    } else {
      // Status updated
      const statusLabels: Record<string, string> = {
        IN_REVIEW: "In Review",
        ENHANCED_SENT: "Enhanced Files Ready",
        NEEDS_CHANGES: "Needs Changes",
        CLOSED: "Closed",
        COMPLETED: "Completed",
        REJECTED: "Reviewed",
      };

      const statusLabel = statusLabels[submission.status] || submission.status;
      const previousStatusLabel = previousStatus ?? "N/A";
      const adminNote = submission.adminNote || undefined;

      subject = `Submission Update: ${statusLabel} - Talexia`;
      body = buildSubmissionEmailText({
        greetingName: submission.user.name || "there",
        intro: "Your submission status has been updated.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "Previous Status", value: previousStatusLabel },
          { label: "New Status", value: statusLabel },
          { label: "Updated", value: submission.updatedAt.toLocaleString() },
        ],
        note: adminNote ? `Admin Note:\n${adminNote}` : undefined,
        ctaLabel: "View submission dashboard",
        ctaUrl: `${baseUrl}/dashboard/submissions`,
        closing: "Best regards, The Talexia Team",
      });
      html = buildSubmissionEmailHtml({
        eyebrow: "Submission Update",
        title: `Submission Update: ${statusLabel}`,
        greetingName: submission.user.name || "there",
        intro: "Your submission status has been updated.",
        detailRows: [
          { label: "Submission ID", value: submission.id },
          { label: "Previous Status", value: previousStatusLabel },
          { label: "New Status", value: statusLabel },
          { label: "Updated", value: submission.updatedAt.toLocaleString() },
        ],
        note: adminNote ? `Admin Note:\n${adminNote}` : undefined,
        cta: {
          label: "View submission dashboard",
          url: `${baseUrl}/dashboard/submissions`,
        },
        closing: "Best regards, The Talexia Team",
      });
    }
  }

  try {
    await transporter.sendMail({
      from: CONTACT_FROM_EMAIL,
      to,
      subject,
      text: body,
      html,
      ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    });

    logger.info("Submission email sent", {
      type,
      recipientType,
      to,
      submissionId: submission.id,
    });

    return { sent: true };
  } catch (error) {
    logger.error("Failed to send submission email", {
      error,
      type,
      recipientType,
      submissionId: submission.id,
    });
    return { sent: false, reason: "Email sending failed" };
  }
}

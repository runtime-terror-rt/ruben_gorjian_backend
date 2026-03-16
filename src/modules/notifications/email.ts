import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { Submission } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

interface SendSubmissionEmailParams {
  type: "created" | "status_updated" | "enhanced_delivery";
  submission: Submission & { user: { email: string; name: string | null } };
  recipientType: "user" | "admin";
  previousStatus?: string;
  deliveryMessage?: string;
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

  const { type, submission, recipientType, previousStatus, deliveryMessage } = params;
  const baseUrl = FRONTEND_URL || "http://localhost:3000";

  let subject: string;
  let body: string;
  let to: string;

  if (recipientType === "admin") {
    // Email to admins
    if (type === "created") {
      const userName = submission.user.name || submission.user.email;
      const userNote = submission.userNote ? `\n\nUser Note:\n${submission.userNote}` : "";
      
      subject = `[Talexia] New Submission from ${userName}`;
      body = `A new submission has been received.\n\n` +
        `Submission ID: ${submission.id}\n` +
        `From: ${userName} (${submission.user.email})\n` +
        `Status: ${submission.status}\n` +
        `Created: ${submission.createdAt.toLocaleString()}${userNote}\n\n` +
        `View and manage this submission:\n${baseUrl}/admin/submissions`;
      
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
      body = `Hi ${submission.user.name || "there"},\n\n` +
        `Your submission has been received and is awaiting review.\n\n` +
        `Submission ID: ${submission.id}\n` +
        `Status: ${submission.status}\n` +
        `Submitted: ${submission.createdAt.toLocaleString()}\n\n` +
        `You can track the status of your submission in your dashboard:\n${baseUrl}/dashboard/submissions\n\n` +
        `We'll notify you when there's an update.\n\n` +
        `Best regards,\nThe Talexia Team`;
    } else if (type === "enhanced_delivery") {
      const messageBlock = deliveryMessage ? `\n\nAdmin Message:\n${deliveryMessage}` : "";
      subject = "Enhanced Submission Ready - Talexia";
      body = `Hi ${submission.user.name || "there"},\n\n` +
        `Your enhanced submission files are ready.\n\n` +
        `Submission ID: ${submission.id}\n` +
        `Status: ${submission.status}\n` +
        `Updated: ${submission.updatedAt.toLocaleString()}${messageBlock}\n\n` +
        `View your enhanced delivery:\n${baseUrl}/dashboard/submissions\n\n` +
        `Best regards,\nThe Talexia Team`;
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
      const adminNote = submission.adminNote ? `\n\nAdmin Note:\n${submission.adminNote}` : "";

      subject = `Submission Update: ${statusLabel} - Talexia`;
      body = `Hi ${submission.user.name || "there"},\n\n` +
        `Your submission status has been updated.\n\n` +
        `Submission ID: ${submission.id}\n` +
        `Previous Status: ${previousStatus}\n` +
        `New Status: ${statusLabel}\n` +
        `Updated: ${submission.updatedAt.toLocaleString()}${adminNote}\n\n` +
        `View your submission:\n${baseUrl}/dashboard/submissions\n\n` +
        `Best regards,\nThe Talexia Team`;
    }
  }

  try {
    await transporter.sendMail({
      from: CONTACT_FROM_EMAIL,
      to,
      subject,
      text: body,
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

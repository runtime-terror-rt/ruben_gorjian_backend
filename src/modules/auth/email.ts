import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { buildTalexiaEmailHeader, getTalexiaLogoAttachment } from "../../lib/email-branding";

function verificationBaseUrl() {
  return env.FRONTEND_URL ?? "http://localhost:3000";
}

function passwordResetBaseUrl() {
  return env.FRONTEND_URL ?? "http://localhost:3000";
}

function resolveRecipientName(name: string | undefined, email: string): string {
  const normalizedName = name?.trim();
  if (normalizedName) {
    return normalizedName;
  }

  const localPart = email.split("@")[0]?.trim();
  if (localPart) {
    return localPart
      .replace(/[._-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  return "User";
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  pendingPlanCode?: string,
  userName?: string,
) {
  const { CONTACT_FROM_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL } = env;

  if (!CONTACT_FROM_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return { sent: false, reason: "Email not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const logoAttachment = getTalexiaLogoAttachment();

  const verificationUrl = `${verificationBaseUrl().replace(/\/$/, "")}/verify?token=${encodeURIComponent(
    token
  )}${pendingPlanCode ? `&planCode=${encodeURIComponent(pendingPlanCode)}` : ""}`;
  const greetingName = resolveRecipientName(userName, email);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Email Verification")}
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi ${greetingName},</p>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              Confirm your email address to finish setting up your Talexia account.
            </p>
            ${pendingPlanCode
      ? `<p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
              Selected Plan: <strong>${pendingPlanCode}</strong>
            </p>`
      : ""}
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td><a href="${verificationUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">Verify Email</a></td>
              </tr>
            </table>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.6;">
              If the button does not work, copy this link and open it in your browser:
            </p>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;word-break:break-all;">${verificationUrl}</p>
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

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: email, // send to the user
    subject: "Verify your Talexia account",
    text: `Confirm your email to finish setting up your Talexia account.\n\nVerify: ${verificationUrl}\n\nIf you didn't request this, you can ignore it.`,
    html,
    ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    ...(CONTACT_TO_EMAIL ? { bcc: CONTACT_TO_EMAIL } : {}),
  });

  return { sent: true };
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  userName?: string,
) {
  const { CONTACT_FROM_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL } = env;

  if (!CONTACT_FROM_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return { sent: false, reason: "Email not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const logoAttachment = getTalexiaLogoAttachment();

  const resetUrl = `${passwordResetBaseUrl().replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(
    token,
  )}`;
  const greetingName = resolveRecipientName(userName, email);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Password Reset", "Reset your password with a secure link")}
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi ${greetingName},</p>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              We received a request to reset your Talexia password.
            </p>
            <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
              Click the button below to choose a new password. This link will expire in 1 hour.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td><a href="${resetUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">Reset Password</a></td>
              </tr>
            </table>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.6;">
              If the button does not work, copy this link and open it in your browser:
            </p>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;word-break:break-all;">${resetUrl}</p>
            <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">
              If you did not request this, you can safely ignore this email.
            </p>
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

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: email,
    subject: "Reset your Talexia password",
    text: `We received a request to reset your Talexia password.\n\nReset password: ${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html,
    ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    ...(CONTACT_TO_EMAIL ? { bcc: CONTACT_TO_EMAIL } : {}),
  });

  return { sent: true };
}

export async function sendEnterprisePlanInviteEmail(params: {
  email: string;
  token: string;
  planCode: string;
  planName?: string;
  amount?: number;
  billingCycle?: "monthly" | "yearly";
  fullName?: string;
  companyName?: string;
  socialPlatforms?: string[];
  postsPerMonth?: number | null;
  reelsPerMonth?: number | null;
  microReelsPerMonth?: number | null;
  proPhotoShootFrequency?: string | null;
  proPhotoShootLength?: string | null;
  captionHashtags?: boolean | null;
  scheduling?: boolean | null;
}) {
  const { CONTACT_FROM_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL } = env;

  if (!CONTACT_FROM_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return { sent: false, reason: "Email not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const logoAttachment = getTalexiaLogoAttachment();

  const _inviteBase = verificationBaseUrl().replace(/\/$/, "");
  const inviteUrl = `${_inviteBase}/enterprise-plan/accept?token=${encodeURIComponent(params.token)}${params.planCode ? `&planCode=${encodeURIComponent(
    params.planCode
  )}` : ""}`;
  const recipientName = resolveRecipientName(params.fullName, params.email);
  const quotedAmount = typeof params.amount === "number"
    ? params.amount.toFixed(2)
    : null;
  const billingCycleLabel = params.billingCycle === "yearly" ? "Yearly" : "Monthly";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Enterprise Plan Invitation", "A custom enterprise plan invitation is ready")}
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi ${recipientName},</p>
            <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
              You have been invited to activate a custom Talexia Enterprise plan.
            </p>
            <!-- Plan details table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;">Plan Code</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;">${params.planCode}</td>
              </tr>
              ${params.planName ? `<tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Plan Name</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.planName}</td>
              </tr>` : ""}
              ${quotedAmount ? `<tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Quoted Price</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">$${quotedAmount} / ${billingCycleLabel.toLowerCase()}</td>
              </tr>` : ""}
              ${params.companyName ? `<tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Company</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.companyName}</td>
              </tr>` : ""}
              ${params.socialPlatforms && params.socialPlatforms.length ? `<tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Social Platforms</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.socialPlatforms.join(", ")}</td>
              </tr>` : ""}
              ${typeof params.postsPerMonth === "number" ? `<tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Posts / month</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.postsPerMonth}</td>
              </tr>` : ""}
              ${typeof params.reelsPerMonth === "number" ? `<tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Reels / month</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.reelsPerMonth}</td>
              </tr>` : ""}
              ${typeof params.microReelsPerMonth === "number" ? `<tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Micro Reels / month</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.microReelsPerMonth}</td>
              </tr>` : ""}
              ${params.proPhotoShootFrequency ? `<tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Pro Photoshoot Frequency</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.proPhotoShootFrequency}${params.proPhotoShootLength ? ` — ${params.proPhotoShootLength}` : ""}</td>
              </tr>` : ""}
              ${typeof params.captionHashtags === "boolean" ? `<tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Caption Hashtags</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.captionHashtags ? "Yes" : "No"}</td>
              </tr>` : ""}
              ${typeof params.scheduling === "boolean" ? `<tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Scheduling</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;">${params.scheduling ? "Yes" : "No"}</td>
              </tr>` : ""}
            </table>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td><a href="${inviteUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">Review Plan</a></td>
              </tr>
            </table>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.6;">If the button does not work, copy and open this link:</p>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;word-break:break-all;">${inviteUrl}</p>
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

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: params.email,
    subject: "Your Talexia Enterprise Plan Is Ready",
    text: `You have been invited to activate a custom Talexia Enterprise plan (${params.planCode}).\n\nOpen: ${inviteUrl}`,
    html,
    ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
    ...(CONTACT_TO_EMAIL ? { bcc: CONTACT_TO_EMAIL } : {}),
  });

  return { sent: true };
}

export async function sendInvoiceEmail(
  email: string,
  invoiceNumber: string,
  amountPaid: string,
  hostedInvoiceUrl?: string,
  invoicePdfUrl?: string,
  extra?: {
    planName?: string;
    billingCycle?: string;
    userName?: string;
    date?: string;
    customerEmail?: string;
    invoiceStatus?: string;
    subtotalAmount?: string;
    taxAmount?: string;
    transactionId?: string;
  },
) {
  const { CONTACT_FROM_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = env;

  if (!CONTACT_FROM_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return { sent: false, reason: "Email not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const logoAttachment = getTalexiaLogoAttachment();

  const greeting = `Hi ${resolveRecipientName(extra?.userName, email)},`;
  const invoiceDate = extra?.date ?? new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const planLabel = extra?.planName ? extra.planName.replace(/_/g, " ") : "Subscription";
  const cycleLabel = extra?.billingCycle ?? "Monthly";
  const statusLabel = extra?.invoiceStatus ?? "Paid";
  const customerEmail = extra?.customerEmail ?? email;
  const subtotalAmount = extra?.subtotalAmount ?? amountPaid;
  const taxAmount = extra?.taxAmount ?? "0.00";
  const transactionId = extra?.transactionId ?? "N/A";
  const downloadUrl = invoicePdfUrl || hostedInvoiceUrl;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Payment Confirmed", "Your payment was processed successfully")}
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 24px;color:#1e293b;font-size:16px;">${greeting}</p>
            <p style="margin:0 0 32px;color:#475569;font-size:15px;line-height:1.6;">
              Thank you! Your payment has been successfully processed. Here are your invoice details:
            </p>
            <!-- Invoice table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:32px;">
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;">INVOICE NUMBER</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;text-align:right;">${invoiceNumber}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Date</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${invoiceDate}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Plan</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${planLabel} (${cycleLabel})</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Customer Email</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${customerEmail}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Payment Status</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${statusLabel}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Transaction ID</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${transactionId}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Subtotal</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">$${subtotalAmount}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Tax</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">$${taxAmount}</td>
              </tr>
              <tr>
                <td style="padding:16px 16px;color:#1e293b;font-size:15px;font-weight:700;">Amount Paid</td>
                <td style="padding:16px 16px;color:#0f172a;font-size:18px;font-weight:700;text-align:right;">$${amountPaid}</td>
              </tr>
            </table>
            <!-- CTA buttons -->
            ${downloadUrl
      ? `<table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr>
                <td><a href="${downloadUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">Download Invoice</a></td>
              </tr>
            </table>`
      : ""}
            <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
              If you have any questions about this invoice, please contact our support team.
            </p>
          </td>
        </tr>
        <!-- Footer -->
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

  const textLines = [
    greeting,
    "",
    `Your Talexia subscription payment of $${amountPaid} has been received.`,
    `Invoice: ${invoiceNumber}`,
    `Date: ${invoiceDate}`,
    `Plan: ${planLabel} (${cycleLabel})`,
    `Customer Email: ${customerEmail}`,
    `Payment Status: ${statusLabel}`,
    `Transaction ID: ${transactionId}`,
    `Subtotal: $${subtotalAmount}`,
    `Tax: $${taxAmount}`,
  ];
  if (downloadUrl) textLines.push(`Download Invoice: ${downloadUrl}`);

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: email,
    subject: `Talexia Invoice ${invoiceNumber} – Payment Confirmed`,
    text: textLines.join("\n"),
    html,
    ...(logoAttachment ? { attachments: [logoAttachment] } : {}),
  });

  return { sent: true };
}

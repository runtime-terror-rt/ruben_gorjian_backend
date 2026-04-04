import nodemailer from "nodemailer";
import { env } from "../../config/env";

type ContactEmailPayload = {
  fullName: string;
  businessName: string;
  email: string;
  websiteOrHandle?: string | null;
  interests?: string[];
  postsPerMonth?: string | null;
  message?: string | null;
  source?: string | null;
};

type ConfirmationEmailPayload = {
  fullName: string;
  email: string;
};

type ReplyNotificationEmailPayload = {
  fullName: string;
  email: string;
  replyMessage: string;
};

function createTransporter() {
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

export async function sendContactEmail(payload: ContactEmailPayload) {
  const { CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL } = env;

  if (!CONTACT_FROM_EMAIL || !CONTACT_TO_EMAIL) {
    return { sent: false };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false };
  }

  const interests = payload.interests?.length ? payload.interests.join(", ") : "Not provided";
  const websiteHandle = payload.websiteOrHandle || "Not provided";
  const postsPerMonth = payload.postsPerMonth || "Not provided";
  const message = payload.message || "Not provided";
  const source = payload.source || "Not provided";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0f172a;padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Talexia</h1>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">New Contact Submission</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;">Full Name</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;text-align:right;">${payload.fullName}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Business Name</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${payload.businessName}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Email</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${payload.email}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Website/Handle</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${websiteHandle}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Interests</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${interests}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Posts Per Month</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${postsPerMonth}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 16px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Source</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">${source}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#64748b;font-size:13px;vertical-align:top;">Message</td>
                <td style="padding:12px 16px;color:#1e293b;font-size:13px;line-height:1.6;text-align:right;white-space:pre-wrap;">${message}</td>
              </tr>
            </table>
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

  const text = [
    `Full Name: ${payload.fullName}`,
    `Business Name: ${payload.businessName}`,
    `Email: ${payload.email}`,
    `Website/Handle: ${websiteHandle}`,
    `Interests: ${interests}`,
    `Posts Per Month: ${postsPerMonth}`,
    `Message: ${message}`,
    `Source: ${source}`,
  ].join("\n");

  try {
    await transporter.sendMail({
      from: CONTACT_FROM_EMAIL,
      to: CONTACT_TO_EMAIL,
      subject: `New Talexia contact: ${payload.fullName} (${payload.businessName})`,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send contact email:", error);
    return { sent: false };
  }
}

export async function sendConfirmationEmail(payload: ConfirmationEmailPayload) {
  const { CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL } = env;

  if (!CONTACT_FROM_EMAIL) {
    return { sent: false };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false };
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0f172a;padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Talexia</h1>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">Contact Confirmation</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hello ${payload.fullName},</p>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              Thank you for contacting Talexia. We have received your message and will review it shortly. Our team will get back to you within 24-48 hours.
            </p>
            <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;">Best regards,<br/>Talexia Team</p>
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

  const text = [
    `Hello ${payload.fullName},`,
    "",
    "Thank you for contacting Talexia. We have received your message and will review it shortly. Our team will get back to you within 24-48 hours.",
    "",
    "Best regards,",
    "Talexia Team",
  ].join("\n");

  try {
    await transporter.sendMail({
      from: CONTACT_FROM_EMAIL,
      to: payload.email,
      subject: "Talexia - We received your message",
      text,
      html,
      ...(CONTACT_TO_EMAIL ? { bcc: CONTACT_TO_EMAIL } : {}),
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send confirmation email:", error);
    return { sent: false };
  }
}

export async function sendReplyNotificationEmail(payload: ReplyNotificationEmailPayload) {
  const { CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL } = env;

  if (!CONTACT_FROM_EMAIL) {
    return { sent: false };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false };
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0f172a;padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Talexia</h1>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">Support Reply</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <div style="margin:0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;color:#334155;font-size:14px;line-height:1.7;white-space:pre-wrap;">${payload.replyMessage}</div>
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

  const text = payload.replyMessage;

  try {
    await transporter.sendMail({
      from: CONTACT_FROM_EMAIL,
      to: payload.email,
      subject: "Talexia - Response to your message",
      text,
      html,
      ...(CONTACT_TO_EMAIL ? { bcc: CONTACT_TO_EMAIL } : {}),
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send reply notification email:", error);
    return { sent: false };
  }
}

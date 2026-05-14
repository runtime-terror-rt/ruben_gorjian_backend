import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { buildTalexiaEmailHeader, getTalexiaLogoAttachment } from "../../lib/email-branding";

type BrandBriefEmailPayload = {
  userEmail: string;
  userName: string;
  planCode: string;
  planName: string;
  briefId: string;
  briefCreatedAt: Date;
  pdfBuffer: Buffer;
};

function sanitize(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveAdminRecipient(): string | undefined {
  const fromConfig = env.BRAND_BRIEF_MAIL_CONFIRMATION?.trim();
  if (fromConfig) return fromConfig;

  return env.CONTACT_TO_EMAIL?.trim() || undefined;
}

type BrandBriefEmailTableRow = {
  label: string;
  value: string;
};

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatList(values?: string[] | null): string {
  if (!values || values.length === 0) {
    return "N/A";
  }

  return values.map((value) => htmlEscape(value)).join(", ");
}

function buildTableSection(title: string, rows: BrandBriefEmailTableRow[]) {
  const renderedRows = rows
    .map((row, index) => {
      const shaded = index % 2 === 0 ? ' style="background:#f8fafc;"' : "";
      return `<tr${shaded}>
        <td style="padding:12px 16px;color:#64748b;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0;width:42%;">${htmlEscape(row.label)}</td>
        <td style="padding:12px 16px;color:#1e293b;font-size:13px;line-height:1.6;border-bottom:1px solid #e2e8f0;">${row.value}</td>
      </tr>`;
    })
    .join("");

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 24px;">
    <tr>
      <td colspan="2" style="padding:12px 16px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${htmlEscape(title)}</td>
    </tr>
    ${renderedRows}
  </table>`;
}

export async function sendBrandBriefSubmissionEmails(payload: BrandBriefEmailPayload & {
  restaurantName: string;
  location: string;
  businessType: string;
  cuisineType: string;
  dietaryCertifications: string[];
  websiteUrl?: string | null;
  instagramHandle: string;
  facebookPageUrl?: string | null;
  tiktokHandle?: string | null;
  onlineOrderingUrl?: string | null;
  foodDescription: string;
  uniqueSellingPoint: string;
  customerReviews: string;
  forbiddenPhrases?: string | null;
  preferredPhrases?: string | null;
  captionSample1: string;
  captionSample2: string;
  captionSample3: string;
  toneAndVoice: string[];
  captionTargeting: string;
  language: string;
  signatureDishes: string[];
  signatureDishDetails: string;
  excludedItems?: string | null;
  upcomingPromotions?: string | null;
  hashtagStyle: string;
  confirmMinDishes: string;
  actionShotsPossible?: string | null;
  preferredShootTime?: string | null;
  physicalConstraints?: string | null;
  specialNotes?: string | null;
  clientName: string;
  restaurantNameAuth: string;
  submissionDate: Date;
  talexiaPlan: string;
}) {
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

  const adminRecipient = resolveAdminRecipient();
  const logoAttachment = getTalexiaLogoAttachment();
  const attachmentName = `brand-brief-${payload.planCode}-${payload.briefId.slice(0, 8)}.pdf`;
  const commonAttachments = [
    ...(logoAttachment ? [logoAttachment] : []),
    {
      filename: attachmentName,
      content: payload.pdfBuffer,
      contentType: "application/pdf",
    },
  ];

  const safeUserName = htmlEscape(payload.userName);
  const safeUserEmail = htmlEscape(payload.userEmail);
  const safePlanCode = htmlEscape(payload.planCode);
  const safePlanName = htmlEscape(payload.planName);

  const userHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("Brand Brief Submission Received", "Your submission has been recorded successfully")}
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;color:#1e293b;font-size:16px;">Hi ${safeUserName},</p>
            <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">
              Thank you for submitting your brand brief for <strong>${safePlanName}</strong>. We have received your submission successfully.
            </p>
            <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">
              All the details you provided are attached as a PDF document for your records. Please keep this for your reference.
            </p>
            <p style="margin:0 0 0;color:#475569;font-size:14px;line-height:1.6;">
              If you have any questions, please feel free to reach out to us.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: payload.userEmail,
    subject: "Talexia Brand Brief Submission Confirmation",
    text: `Your brand brief has been submitted successfully.\nPlan: ${payload.planName} (${payload.planCode})\nRestaurant: ${payload.restaurantName}\nLocation: ${payload.location}\nSubmitted by: ${payload.userName} <${payload.userEmail}>`,
    html: userHtml,
    attachments: commonAttachments,
  });

  if (adminRecipient) {
    const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${buildTalexiaEmailHeader("New Brand Brief Submitted", "A client has submitted a new brand brief")}
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 24px;color:#1e293b;font-size:16px;">A new brand brief has been submitted.</p>
            ${buildTableSection("Submission Details", [
              { label: "Client Name", value: safeUserName },
              { label: "Email", value: `<a href="mailto:${safeUserEmail}" style="color:#0f172a;text-decoration:none;font-weight:500;">${safeUserEmail}</a>` },
              { label: "Plan", value: `${safePlanName} (${safePlanCode})` },
              { label: "Restaurant", value: htmlEscape(payload.restaurantName) },
              { label: "Location", value: htmlEscape(payload.location) },
            ])}
            <p style="margin:0 0 0;color:#475569;font-size:14px;line-height:1.6;">
              All details are included in the attached PDF document.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: CONTACT_FROM_EMAIL,
      to: adminRecipient,
      subject: `New Brand Brief: ${payload.planCode}`,
      text: `A client submitted a brand brief.\nClient: ${payload.userName}\nEmail: ${payload.userEmail}\nPlan: ${payload.planName} (${payload.planCode})\nRestaurant: ${payload.restaurantName}\nLocation: ${payload.location}\nBrief ID: ${payload.briefId}`,
      html: adminHtml,
      attachments: commonAttachments,
    });
  }

  return { sent: true, adminRecipient: adminRecipient ?? null };
}

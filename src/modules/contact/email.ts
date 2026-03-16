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

export async function sendContactEmail(payload: ContactEmailPayload) {
  const { CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = env;

  if (!CONTACT_FROM_EMAIL || !CONTACT_TO_EMAIL || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    // Email is optional; skip silently if not configured.
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

  const subject = `New Talexia contact: ${payload.fullName} (${payload.businessName})`;
  const interests = payload.interests?.length ? payload.interests.join(", ") : "Not provided";
  const body = [
    `Full Name: ${payload.fullName}`,
    `Business Name: ${payload.businessName}`,
    `Email: ${payload.email}`,
    `Website/Handle: ${payload.websiteOrHandle || "Not provided"}`,
    `Interests: ${interests}`,
    `Posts Per Month: ${payload.postsPerMonth || "Not provided"}`,
    `Message: ${payload.message || "Not provided"}`,
    `Source: ${payload.source || "Not provided"}`,
  ].join("\n");

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: CONTACT_TO_EMAIL,
    subject,
    text: body,
  });

  return { sent: true };
}

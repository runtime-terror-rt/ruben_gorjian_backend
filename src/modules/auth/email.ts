import nodemailer from "nodemailer";
import { env } from "../../config/env";

function verificationBaseUrl() {
  return env.FRONTEND_URL ?? "http://localhost:3000";
}

export async function sendVerificationEmail(email: string, token: string, pendingPlanCode?: string) {
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

  const verificationUrl = `${verificationBaseUrl().replace(/\/$/, "")}/verify?token=${encodeURIComponent(
    token
  )}${pendingPlanCode ? `&planCode=${encodeURIComponent(pendingPlanCode)}` : ""}`;

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: email, // send to the user
    subject: "Verify your Talexia account",
    text: `Confirm your email to finish setting up your Talexia account.\n\nVerify: ${verificationUrl}\n\nIf you didn't request this, you can ignore it.`,
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

  const lines = [
    `Your Talexia subscription payment of $${amountPaid} has been received.`,
    `Invoice: ${invoiceNumber}`,
  ];
  if (hostedInvoiceUrl) lines.push(`View invoice: ${hostedInvoiceUrl}`);
  if (invoicePdfUrl) lines.push(`Download PDF: ${invoicePdfUrl}`);

  await transporter.sendMail({
    from: CONTACT_FROM_EMAIL,
    to: email,
    subject: `Talexia Invoice ${invoiceNumber} – Payment Confirmed`,
    text: lines.join("\n"),
  });

  return { sent: true };
}

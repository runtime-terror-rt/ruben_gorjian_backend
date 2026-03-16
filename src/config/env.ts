import dotenv from "dotenv";
import { z } from "zod";
import { logger } from "../lib/logger";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("4000"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_VISUAL_TOPUP_PRICE_ID: z.string().optional(),
  STRIPE_VISUAL_TOPUP_UNITS: z.coerce.number().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_BASE_URL: z.string().optional(),
  SOCIAL_REDIRECT_BASE: z.string().optional(),
  JWT_SECRET: z.string().min(20, "JWT_SECRET must be at least 20 characters for security"),
  STORAGE_BUCKET: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  APP_URL: z.string().optional(),
  CALENDLY_API_ENDPOINT: z.string().url().optional(),
  CALENDLY_API_TOKEN: z.string().optional(),
  CALENDLY_BOOKING_URL: z.string().url().optional(),
  CONTACT_FROM_EMAIL: z.string().email().optional(),
  CONTACT_TO_EMAIL: z.string().email().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  DEFAULT_PLAN_CODE: z.string().optional(), // Default plan assigned at signup
  UPLOAD_POST_BASE_URL: z.string().url().optional(),
  UPLOAD_POST_API_KEY: z.string().optional(),
  UPLOAD_POST_CLIENT_ID: z.string().optional(),
  UPLOAD_POST_CLIENT_SECRET: z.string().optional(),
  UPLOAD_POST_WEBHOOK_TOKEN: z.string().optional(),
  // Optional branding for Upload-Post connect page (generate-jwt)
  UPLOAD_POST_CONNECT_LOGO_URL: z.string().url().optional(),
  UPLOAD_POST_CONNECT_TITLE: z.string().optional(),
  UPLOAD_POST_CONNECT_DESCRIPTION: z.string().optional(),
  UPLOAD_POST_REDIRECT_BUTTON_TEXT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

// Additional security checks
if (parsed.data.JWT_SECRET === "change_me") {
  throw new Error("JWT_SECRET must be changed from default value");
}

if (parsed.data.NODE_ENV === "production") {
  if (!parsed.data.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required in production");
  }
  if (!parsed.data.FRONTEND_URL) {
    throw new Error("FRONTEND_URL is required in production");
  }
}

export const env = parsed.data;

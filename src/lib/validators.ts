import { z } from "zod";

/**
 * Allowed URL protocols for user-provided URLs
 * Only http and https are allowed for security
 */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * Custom Zod validator for URLs that only allows http/https protocols
 * Prevents dangerous protocols like javascript:, data:, file:, etc.
 */
export const safeUrl = () =>
  z
    .string()
    .url("Invalid URL format")
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return ALLOWED_PROTOCOLS.includes(parsed.protocol);
        } catch {
          return false;
        }
      },
      {
        message: "URL must use http or https protocol only",
      }
    );

/**
 * Validates and sanitizes storage keys to prevent path traversal attacks
 * Storage keys should:
 * - Not contain path traversal sequences (../, ..\\)
 * - Not start with / or \
 * - Not contain null bytes
 * - Only contain alphanumeric, hyphens, underscores, dots, and forward slashes
 * - Not exceed reasonable length (512 chars)
 */
export function sanitizeStorageKey(key: string | null | undefined): string | null {
  if (!key || typeof key !== "string") {
    return null;
  }

  // Remove leading/trailing whitespace
  const trimmed = key.trim();

  // Check for empty string
  if (trimmed.length === 0) {
    return null;
  }

  // Check length
  if (trimmed.length > 512) {
    throw new Error("Storage key exceeds maximum length");
  }

  // Check for path traversal sequences
  if (trimmed.includes("..") || trimmed.includes("../") || trimmed.includes("..\\")) {
    throw new Error("Storage key contains invalid path traversal sequences");
  }

  // Check for null bytes
  if (trimmed.includes("\0")) {
    throw new Error("Storage key contains null bytes");
  }

  // Check for absolute paths (leading slash)
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error("Storage key cannot start with / or \\");
  }

  // Allow only safe characters: alphanumeric, hyphens, underscores, dots, forward slashes
  // This pattern allows paths like "user/123/image.jpg" but blocks dangerous sequences
  const safePattern = /^[a-zA-Z0-9._\-\/]+$/;
  if (!safePattern.test(trimmed)) {
    throw new Error("Storage key contains invalid characters");
  }

  // Normalize: remove multiple consecutive slashes
  const normalized = trimmed.replace(/\/+/g, "/");

  return normalized;
}

/**
 * Validates a storage key and constructs a safe URL
 * Throws an error if the storage key is invalid
 */
export function buildStorageUrl(baseUrl: string, storageKey: string | null | undefined): string | null {
  if (!storageKey) {
    return null;
  }

  const sanitized = sanitizeStorageKey(storageKey);
  if (!sanitized) {
    return null;
  }

  // Ensure baseUrl doesn't end with slash and storageKey doesn't start with slash
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanKey = sanitized.replace(/^\/+/, "");

  return `${cleanBase}/${cleanKey}`;
}

/**
 * Validates that a timezone string is a valid IANA timezone identifier
 * Returns true if valid, false otherwise
 */
export function isValidTimezone(timezone: string | null | undefined): boolean {
  if (!timezone || typeof timezone !== "string" || timezone.trim().length === 0) {
    return false;
  }

  // Special case: "AUTO" is allowed for auto-detection
  if (timezone === "AUTO") {
    return true;
  }

  try {
    // Try to create a DateTimeFormat with the timezone
    // This will throw if the timezone is invalid
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zod validator for IANA timezone identifiers
 * Allows "AUTO" for auto-detection or valid IANA timezone strings
 */
export const timezoneValidator = () =>
  z
    .string()
    .refine(
      (tz) => isValidTimezone(tz),
      {
        message: "Invalid timezone. Must be a valid IANA timezone identifier or 'AUTO'",
      }
    );


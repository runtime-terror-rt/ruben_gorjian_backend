import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Rate limiter for submission creation
 * Limits users to 10 submissions per 15 minutes
 */
export const submissionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 submissions per 15 minutes per IP
  message: "Too many submissions created. Please wait before creating more.",
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  
  // Use user ID as key if available, otherwise use IP
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `user:${req.user.id}`;
    }
    return ipKeyGenerator(req.ip ?? "unknown") || "unknown";
  },
  
  // Skip rate limiting for admins
  skip: (req) => {
    return req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
  },
});

/**
 * More aggressive rate limiter for file uploads
 * Limits to 50 file upload requests per 15 minutes
 */
export const fileUploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Max 50 file upload requests per 15 minutes
  message: "Too many file uploads. Please wait before uploading more files.",
  standardHeaders: true,
  legacyHeaders: false,
  
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `user:${req.user.id}:upload`;
    }
    const ipKey = ipKeyGenerator(req.ip ?? "unknown") || "unknown";
    return `${ipKey}:upload`;
  },
  
  skip: (req) => {
    return req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
  },
});

/**
 * Rate limiter for the manual billing sync endpoint
 * Prevents users from hammering the Stripe sync route
 */
export const billingSyncRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: "Too many sync requests. Please wait before trying again.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user?.id) return `user:${req.user.id}:sync`;
    return ipKeyGenerator(req.ip ?? "unknown") || "unknown";
  },
});

/**
 * General API rate limiter
 * Applies to all routes if needed
 */
export const generalRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Max 100 requests per minute
  message: "Too many requests. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  
  skip: (req) => {
    return req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
  },
});

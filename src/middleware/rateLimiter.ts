import type { RequestHandler } from "express";

const noopLimiter: RequestHandler = (_req, _res, next) => next();

// TEMP: Rate limit disabled.
// Previous setting: 10 requests / 15 minutes for submission creation.
export const submissionRateLimiter: RequestHandler = noopLimiter;

// TEMP: Rate limit disabled.
// Previous setting: 50 requests / 15 minutes for file upload endpoints.
export const fileUploadRateLimiter: RequestHandler = noopLimiter;

// TEMP: Rate limit disabled.
// Previous setting: 5 requests / minute for billing sync endpoint.
export const billingSyncRateLimiter: RequestHandler = noopLimiter;

// TEMP: Rate limit disabled.
// Previous setting: 100 requests / minute for general API.
export const generalRateLimiter: RequestHandler = noopLimiter;

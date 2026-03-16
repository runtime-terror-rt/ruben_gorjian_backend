import { ZodError } from "zod";
import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation error", details: err.flatten() });
  }

  if (err instanceof Error) {
    logger.error("Unhandled error", err);
    return res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }

  logger.error("Unhandled non-Error thrown", { err });
  return res.status(500).json({ error: "An internal error occurred. Please try again later." });
}

import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/tokens";
import { prisma } from "../lib/prisma";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token =
    extractBearer(req.headers.authorization) ||
    req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const tokenUser = verifyAccessToken(token);
  if (!tokenUser) {
    return res.status(401).json({ error: "Invalid token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: tokenUser.id },
    select: { id: true, email: true, role: true, isFounder: true, status: true },
  });

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  if (user.status === "BLOCKED") {
    return res.status(403).json({ error: "Account is blocked" });
  }
  if (user.status === "DELETED") {
    return res.status(403).json({ error: "Account is deleted" });
  }

  req.user = user;
  return next();
}

function extractBearer(authHeader?: string) {
  if (!authHeader) return null;
  const [scheme, value] = authHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

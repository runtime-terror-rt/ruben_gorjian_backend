import { Request } from "express";
import { prisma } from "../lib/prisma";

export type AdminRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL";

const METHOD_SET = new Set<AdminRouteMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "ALL"]);

function normalizePath(path: string) {
  const base = path.trim();
  if (!base) return "/";
  const withSlash = base.startsWith("/") ? base : `/${base}`;
  return withSlash.replace(/\/+$|\s+/g, "") || "/";
}

function extractRequestPath(req: Request) {
  const source = req.originalUrl || req.url || "/";
  const rawPath = source.split("?")[0] || "/";
  return normalizePath(rawPath);
}

function pathPatternToRegExp(pathPattern: string) {
  const escaped = pathPattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*")
    .replace(/:[A-Za-z0-9_]+/g, "[^/]+");

  return new RegExp(`^${escaped}/?$`);
}

function hasPathMatch(pathPattern: string, requestPath: string) {
  const normalizedPattern = normalizePath(pathPattern);
  const regex = pathPatternToRegExp(normalizedPattern);
  return regex.test(requestPath);
}

export function normalizeRouteMethod(method: string): AdminRouteMethod {
  const upper = method.toUpperCase() as AdminRouteMethod;
  if (!METHOD_SET.has(upper)) {
    throw new Error(`Unsupported method: ${method}`);
  }
  return upper;
}

export async function hasAdminRoutePermission(req: Request) {
  if (!req.user) return false;
  if (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") return false;

  const requestMethod = req.method.toUpperCase();
  const requestPath = extractRequestPath(req);

  const permissions = await prisma.adminRoutePermission.findMany({
    where: {
      adminUserId: req.user.id,
      active: true,
      OR: [{ method: requestMethod }, { method: "ALL" }],
    },
    select: {
      pathPattern: true,
    },
  });

  if (!permissions.length) {
    return false;
  }

  return permissions.some((permission) => hasPathMatch(permission.pathPattern, requestPath));
}

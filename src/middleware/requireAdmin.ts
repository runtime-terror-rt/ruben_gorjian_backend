import { Request, Response, NextFunction } from "express";
import { hasAdminRoutePermission } from "./adminRoutePermission";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN")) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const allowed = await hasAdminRoutePermission(req);
  if (!allowed) {
    return res.status(403).json({
      error: "You do not have permission to access this route",
    });
  }

  return next();
}

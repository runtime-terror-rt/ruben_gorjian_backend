import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { getUserNotifications, markNotificationRead, markAllNotificationsRead, getUnreadCount } from "./service";
import { z } from "zod";

export const router = Router();

/**
 * GET /api/notifications
 * Get user's notifications with pagination
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = await getUserNotifications(userId, { limit, offset });

    return res.json(result);
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const count = await getUnreadCount(userId);
    
    return res.json({ count });
  } catch (error) {
    console.error("Failed to fetch unread count:", error);
    return res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a notification as read
 */
router.patch("/:id/read", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    const notification = await markNotificationRead(notificationId, userId);

    return res.json({ notification });
  } catch (error: any) {
    console.error("Failed to mark notification as read:", error);
    
    if (error.message === "Notification not found") {
      return res.status(404).json({ error: "Notification not found" });
    }
    
    return res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read
 */
router.post("/mark-all-read", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    await markAllNotificationsRead(userId);
    
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to mark all notifications as read:", error);
    return res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

export { router as notificationsRouter };

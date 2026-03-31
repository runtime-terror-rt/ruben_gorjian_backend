import express from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { OnlinePostController } from "./onlinePost.controller";

const router = express.Router();
const controller = new OnlinePostController();

// Public
router.get("/me", controller.me);
router.post("/users", controller.createUser);
router.get("/status", controller.status);

// Authenticated (CUSTOMER/ADMIN)
router.post("/platform/connect-link", requireAuth, controller.connectLinkForLoggedUser);
router.post("/publish-now",requireAuth, requireAdmin, controller.publishNow);
router.post("/calendar/schedule", requireAuth, controller.schedule);
router.get("/calendar/my", requireAuth, controller.myCalendar);
router.get("/calendar/:id", requireAuth, controller.getScheduledPost);
router.patch("/calendar/:id/reschedule", requireAuth, controller.rescheduleScheduledPost);
router.delete("/calendar/:id", requireAuth, controller.cancelScheduledPost);
router.post("/calendar/:id/retry", requireAuth, controller.retryScheduledPost);
router.get("/platform/my-links", requireAuth, controller.myPlatformLinks);
router.get("/provider/calendar-link", requireAuth, controller.providerCalendarLink);
router.get("/provider/calendar", requireAuth, controller.providerCalendar);

// Admin
router.get("/calendar/admin/client", requireAuth, requireAdmin, controller.clientCalendar);
router.patch("/admin/plan", requireAuth, requireAdmin, controller.updatePlan);

export { router as onlinePostRouter };

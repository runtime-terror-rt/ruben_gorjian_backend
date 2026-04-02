import express from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/requireAuth";
import { requireAdmin } from "../../middleware/requireAdmin";
import { OnlinePostController } from "./onlinePost.controller";

const router = express.Router();
const controller = new OnlinePostController();
const multipartUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 100 * 1024 * 1024,
  },
});

// Public
router.get("/me", controller.me);
router.post("/users", controller.createUser);
router.get("/status", controller.status);

// Authenticated (CUSTOMER/ADMIN)
router.post("/platform/connect-link", requireAuth, controller.connectLinkForLoggedUser);
router.post("/platform/disconnect", requireAuth, controller.disconnectLinkForLoggedUser);
router.post("/publish-now",requireAuth, controller.publishNow);
router.post("/publish-now/form-data", requireAuth, multipartUpload.array("files", 10), controller.publishNowMultipart);
router.post("/calendar/schedule", requireAuth, controller.schedule);
router.get("/calendar/my", requireAuth, controller.myCalendar);
router.get("/calendar/:id", requireAuth, controller.getScheduledPost);
router.patch("/calendar/:id/reschedule", requireAuth, controller.rescheduleScheduledPost);
router.delete("/calendar/:id", requireAuth, controller.cancelScheduledPost);
router.post("/calendar/:id/retry", requireAuth, controller.retryScheduledPost);
router.get("/platform/get-all-performed-links", requireAuth, requireAdmin, controller.getAllPlatformLinks);
<<<<<<< HEAD
=======
router.get("/platform/get-all-posts", requireAuth, requireAdmin, controller.getAllPost);
>>>>>>> b22be671676a534933f746c1b1b2d537c611cb1f
router.get("/platform/my-links", requireAuth, controller.myPlatformLinks);
router.get("/provider/calendar-link", requireAuth, controller.providerCalendarLink);
router.get("/provider/calendar", requireAuth, controller.providerCalendar);

// Admin
router.get("/calendar/admin/client", requireAuth, requireAdmin, controller.clientCalendar);
router.patch("/admin/plan", requireAuth, requireAdmin, controller.updatePlan);

export { router as onlinePostRouter };

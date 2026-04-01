import { Router } from "express";
import { TiktokController } from "./tiktok.controller";
import { requireAuth } from "../../../middleware/requireAuth";
import multer from "multer";

const router = Router();

const tikTokController = new TiktokController();

const multipartUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 100 * 1024 * 1024,
  },
});

router.post(
  "/publish-now/form-data",
  requireAuth,
  multipartUpload.single("file"),
  tikTokController.publishTikTokMultipartByUserNow,
);

router.post("/publish-now", requireAuth, tikTokController.publishNowTikTok);

router.post(
  "/calendar/schedule",
  requireAuth,
  tikTokController.scheduleTikTokPost,
);

export const tiktokRoutes = router;

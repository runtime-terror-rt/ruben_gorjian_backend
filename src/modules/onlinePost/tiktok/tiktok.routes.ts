import { Router } from "express";
import { TiktokController } from "./tiktok.controller";
import { requireAuth } from "../../../middleware/requireAuth";
import { MultipartUpload$ } from "@aws-sdk/client-s3";
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
  "/publish-now",
  requireAuth,
  multipartUpload.array("files", 10),
  tikTokController.publishTikTokMultipartByUserNow,
);

router.post(
  "/calendar/schedule",
  requireAuth,
  tikTokController.scheduleTikTokPost,
);

export const tiktokRoutes = router;

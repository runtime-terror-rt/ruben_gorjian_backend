import { Router } from "express";
import { TiktokController } from "./tiktok.controller";
import { requireAuth } from "../../../middleware/requireAuth";
import multer from "multer";
import { ApiError } from "../../../lib/errors";
import type { Request } from "express";

type MulterFileFilterCallback = (error: Error | null, acceptFile?: boolean) => void;

const router = Router();

const tikTokController = new TiktokController();

const multipartUpload = multer({
  storage: multer.diskStorage({
    destination: "./uploads",
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    },
  }),

  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB
  },

  fileFilter: (_req: Request, file: Express.Multer.File, cb: MulterFileFilterCallback) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new ApiError(400, "Only video files are allowed"));
    }
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

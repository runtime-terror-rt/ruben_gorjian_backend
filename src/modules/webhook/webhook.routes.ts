import { Router } from "express";
import { UploadPostWebhookController } from "./webhook.controller";

const router = Router();

const controller = new UploadPostWebhookController();

router.post("/uploadpost", controller.handleWebhook);

export const webhookRouter = router;

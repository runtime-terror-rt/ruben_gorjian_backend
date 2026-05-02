import { Request, Response, NextFunction } from "express";
import { UploadPostWebhookService } from "./webhook.service";

export class UploadPostWebhookController {
  constructor(
    private readonly webhookService = new UploadPostWebhookService(),
  ) {}

  /**
   * POST /webhooks/uploadpost
   */
  handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const event = req.body;

      // basic guard (service does full validation)
      if (!event) {
        return res.status(400).json({
          success: false,
          message: "Missing webhook payload",
        });
      }

      await this.webhookService.handleWebhook(event);

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      next(error);
    }
  };
}

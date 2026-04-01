import { Request, Response } from "express";
import { TiktokService } from "./tiktok.services";
import { ApiError, handleError } from "../../../lib/errors";

type AuthedRequest = Request & { user?: any };

export class TiktokController {
  constructor(private readonly tiktokService = new TiktokService()) {}

  private parseMultipartPayload(raw: unknown): Record<string, unknown> {
    if (typeof raw !== "string" || !raw.trim()) return {};

    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "Invalid JSON in `data` field");
    }
  }

  publishTikTokMultipartByUserNow = async (
    req: AuthedRequest,
    res: Response,
  ) => {
    try {
      const data = this.parseMultipartPayload(req.body?.data);
      const file = req.file; // single file upload

      if (!file) {
        throw new ApiError(400, "A video file is required");
      }

      return res.json(
        await this.tiktokService.publishTikTokMultipartByUserNow(req.user, {
          username: data.username as string,
          title: data.title as string,
          asyncUpload: data.asyncUpload as boolean,
          file, // pass single file
        }),
      );
    } catch (error) {
      return handleError(error, res);
    }
  };

  publishNowTikTok = async (req: AuthedRequest, res: Response) => {
    try {
      return res.json(
        await this.tiktokService.publishNowTikTok(req.user, {
          username: req.body?.username,
          title: req.body?.title,
          mediaUrl: req.body?.mediaUrl,
          asyncUpload: req.body?.asyncUpload,
        }),
      );
    } catch (error) {
      return handleError(error, res);
    }
  };

  scheduleTikTokPost = async (req: AuthedRequest, res: Response) => {
    try {
      return res.json(
        await this.tiktokService.scheduleTikTokPost(req.user, {
          scheduledAt: req.body?.scheduledAt,
          title: req.body?.title,
          mediaUrl: req.body?.mediaUrl,
          mediaUrls: req.body?.mediaUrls,
        }),
      );
    } catch (error) {
      return handleError(error, res);
    }
  };
}

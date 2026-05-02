


import { SocialPlatform } from "@prisma/client";
import { ApiError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";

type UploadPostWebhookEvent = {
  id: string; // unique event id (for idempotency)
  type:
    | "connect.success"
    | "connect.failed"
    | "post.created"
    | "post.processing"
    | "post.completed"
    | "post.failed"
    | "schedule.executed"
    | "schedule.failed";

  data: {
    username?: string;
    platform?: "facebook" | "instagram" | "tiktok";

    request_id?: string;
    job_id?: string;

    post_url?: string;

    error?: string;
  };

  timestamp: string;
};

class BadRequestException extends ApiError {
  constructor(messageOrDetails: unknown) {
    const message =
      typeof messageOrDetails === "string"
        ? messageOrDetails
        : ((messageOrDetails as any)?.message ?? "Bad Request");
    super(
      400,
      message,
      typeof messageOrDetails === "string" ? undefined : messageOrDetails,
    );
    this.name = "BadRequestException";
  }
  getResponse() {
    return this.details ?? { message: this.message };
  }
}

class ForbiddenException extends ApiError {
  constructor(messageOrDetails: unknown) {
    const message =
      typeof messageOrDetails === "string"
        ? messageOrDetails
        : ((messageOrDetails as any)?.message ?? "Forbidden");
    super(
      403,
      message,
      typeof messageOrDetails === "string" ? undefined : messageOrDetails,
    );
    this.name = "ForbiddenException";
  }
}



export class UploadPostWebhookService {
  constructor(private readonly prismaService = prisma) {}

  // -----------------------------
  // ENTRY POINT
  // -----------------------------
  async handleWebhook(event: UploadPostWebhookEvent) {
    this.validateEvent(event);
    await this.ensureIdempotency(event.id);

    switch (event.type) {
      case "connect.success":
        return this.handleConnectSuccess(event);

      case "connect.failed":
        return this.handleConnectFailed(event);

      case "post.created":
        return this.handlePostCreated(event);

      case "post.processing":
        return this.handlePostProcessing(event);

      case "post.completed":
        return this.handlePostCompleted(event);

      case "post.failed":
        return this.handlePostFailed(event);

      case "schedule.executed":
        return this.handleScheduleExecuted(event);

      case "schedule.failed":
        return this.handleScheduleFailed(event);

      default:
        throw new BadRequestException("Unknown webhook event type");
    }
  }

  // -----------------------------
  // IDEMPOTENCY
  // -----------------------------
  private async ensureIdempotency(eventId: string) {
    const exists = await this.prismaService.webhookEvent.findUnique({
      where: { id: eventId },
    });

    if (exists) {
      throw new BadRequestException("Duplicate webhook event ignored");
    }

    await this.prismaService.webhookEvent.create({
      data: {
        id: eventId,
      },
    });
  }

  // -----------------------------
  // VALIDATION
  // -----------------------------
  private validateEvent(event: UploadPostWebhookEvent) {
    if (!event?.id || !event?.type) {
      throw new BadRequestException("Invalid webhook payload");
    }
  }

    private toPrismaPlatform(
      platform: "facebook" | "instagram" | "tiktok",
    ): SocialPlatform {
      if (platform === "facebook") return SocialPlatform.FACEBOOK;
      if (platform === "instagram") return SocialPlatform.INSTAGRAM;
      return SocialPlatform.TIKTOK;
    }

  // -----------------------------
  // CONNECT FLOW
  // -----------------------------
  private async handleConnectSuccess(event: UploadPostWebhookEvent) {
    const { username, platform } = event.data;

    if (!username || !platform) {
      throw new BadRequestException("Missing connect data");
    }

    await this.prismaService.socialPlatformLink.updateMany({
      where: {
        // optional mapping strategy
        platformUsername: username,
        platform: this.toPrismaPlatform(platform),
      },
      data: {
        externalRef: event.data.request_id ?? null,
        externalProfileUrl: event.data.post_url ?? null,
        linkedAt: new Date(),
      },
    });

    return { success: true };
  }

  private async handleConnectFailed(event: UploadPostWebhookEvent) {
    return {
      success: true,
      message: "Connect failed received",
    };
  }

  // -----------------------------
  // POST FLOW
  // -----------------------------
  private async handlePostCreated(event: UploadPostWebhookEvent) {
    const { job_id, request_id } = event.data;

    await this.prismaService.scheduledPost.updateMany({
      where: {
        OR: [{ externalJobId: job_id }, { externalReqId: request_id }],
      },
      data: {
        status: "PENDING",
      },
    });

    return { success: true };
  }

  private async handlePostProcessing(event: UploadPostWebhookEvent) {
    return { success: true };
  }

  private async handlePostCompleted(event: UploadPostWebhookEvent) {
    const { job_id, request_id, post_url } = event.data;

    await this.prismaService.scheduledPost.updateMany({
      where: {
        OR: [{ externalJobId: job_id }, { externalReqId: request_id }],
      },
      data: {
        status: "POSTED",
        externalPostUrl: post_url ?? null,
      },
    });

    return { success: true };
  }

  private async handlePostFailed(event: UploadPostWebhookEvent) {
    const { job_id, request_id } = event.data;

    await this.prismaService.scheduledPost.updateMany({
      where: {
        OR: [{ externalJobId: job_id }, { externalReqId: request_id }],
      },
      data: {
        status: "FAILED",
      },
    });

    return { success: true };
  }

  // -----------------------------
  // SCHEDULE FLOW
  // -----------------------------
  private async handleScheduleExecuted(event: UploadPostWebhookEvent) {
    const { job_id } = event.data;

    await this.prismaService.scheduledPost.updateMany({
      where: { externalJobId: job_id },
      data: { status: "POSTED" },
    });

    return { success: true };
  }

  private async handleScheduleFailed(event: UploadPostWebhookEvent) {
    const { job_id } = event.data;

    await this.prismaService.scheduledPost.updateMany({
      where: { externalJobId: job_id },
      data: { status: "FAILED" },
    });

    return { success: true };
  }
}

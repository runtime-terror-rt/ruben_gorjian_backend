import { PostStatus, Role, ScheduleType, SessionStatus, SocialPlatform } from "@prisma/client";

export type Actor = {
  id: string;
  role: Role;
};

export type SchedulerView = "day" | "week" | "month" | "list";
export type SchedulerPublishStatus = "completed" | "failed";
export type SchedulerSessionStatusUpdate = "completed" | "failed" | "canceled";
export type SchedulerCalendlySyncStatus = "PENDING" | "SYNCED" | "FAILED";

export type SchedulerCreateInput = {
  userId?: string;
  caption: string;
  hashtags?: string[];
  cta?: string | null;
  shortDescription?: string | null;
  scheduledAt: Date | string;
  platforms?: string[];
  uploadedAssetIds?: string[];
  adminReason?: string | null;
};

export type SchedulerUpdateInput = {
  userId?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string | null;
  shortDescription?: string | null;
  scheduledAt?: Date | string;
  platforms?: string[];
  adminReason?: string | null;
};

export type SchedulerUploadInput = {
  userId?: string;
  files: Array<{
    fileName: string;
    contentType: string;
    fileSize?: number;
  }>;
};

export type SchedulerMultipartUploadInput = {
  userId?: string;
  files: Array<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }>;
};

export type SchedulerListFilters = {
  view: SchedulerView;
  date?: Date | string;
  from?: Date | string;
  to?: Date | string;
  status?: PostStatus[];
  scheduleType?: ScheduleType[];
  sessionStatus?: SessionStatus[];
  calendlySyncStatus?: SchedulerCalendlySyncStatus[];
  failure?: boolean;
  userId?: string;
  userEmail?: string;
  platform?: SocialPlatform[];
  page: number;
  pageSize: number;
};

export type SchedulerClientListFilters = {
  page: number;
  pageSize: number;
  search?: string;
  status?: "ACTIVE" | "BLOCKED" | "DELETED";
};

export type SchedulerPublishStatusInput = {
  userId?: string;
  status: SchedulerPublishStatus;
  failureReason?: string | null;
  adminReason?: string | null;
};

export type SchedulerCreateSessionInput = {
  userId?: string;
  scheduleType: Exclude<ScheduleType, "POSTING">;
  scheduledAt: Date | string;
  sessionTitle?: string | null;
  sessionNotes?: string | null;
  sessionDurationMinutes: number;
  uploadedAssetIds?: string[];
  adminReason?: string | null;
};

export type SchedulerUpdateSessionInput = {
  userId?: string;
  scheduledAt?: Date | string;
  sessionTitle?: string | null;
  sessionNotes?: string | null;
  sessionDurationMinutes?: number;
  uploadedAssetIds?: string[];
  replaceMedia?: boolean;
  adminReason?: string | null;
};

export type SchedulerUpdateSessionStatusInput = {
  userId?: string;
  status: SchedulerSessionStatusUpdate;
  sessionFailureReason?: string | null;
  adminReason?: string | null;
};

export type SchedulerFailureTicketFilters = {
  page: number;
  pageSize: number;
  userId?: string;
  userEmail?: string;
};

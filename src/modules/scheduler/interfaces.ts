import { PostStatus, Role, SocialPlatform } from "@prisma/client";

export type Actor = {
  id: string;
  role: Role;
};

export type SchedulerView = "day" | "week" | "month" | "list";
export type SchedulerPublishStatus = "completed" | "failed";

export type SchedulerCreateInput = {
  userId?: string;
  caption: string;
  hashtags?: string[];
  cta?: string | null;
  shortDescription?: string | null;
  scheduledAt: Date;
  socialAccountIds: string[];
  assetIds?: string[];
  adminReason?: string | null;
};

export type SchedulerUpdateInput = {
  userId?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string | null;
  shortDescription?: string | null;
  scheduledAt?: Date;
  socialAccountIds?: string[];
  assetIds?: string[];
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
  date?: Date;
  from?: Date;
  to?: Date;
  status?: PostStatus[];
  failure?: boolean;
  userId?: string;
  platform?: SocialPlatform[];
  page: number;
  pageSize: number;
};

export type SchedulerPublishStatusInput = {
  userId?: string;
  status: SchedulerPublishStatus;
  failureReason?: string | null;
  adminReason?: string | null;
};

import { PostLimitType, SchedulerRole } from "@prisma/client";

const postLimitTypes = new Set<string>(Object.values(PostLimitType));
const schedulerRoles = new Set<string>(Object.values(SchedulerRole));

export function toPostLimitType(value: string | undefined | null): PostLimitType {
  if (value && postLimitTypes.has(value)) {
    return value as PostLimitType;
  }
  return PostLimitType.NONE;
}

export function toSchedulerRole(value: string | undefined | null): SchedulerRole {
  if (value && schedulerRoles.has(value)) {
    return value as SchedulerRole;
  }
  return SchedulerRole.CLIENT;
}

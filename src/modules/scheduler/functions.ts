import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { Role } from "@prisma/client";
import { isValidTimezone } from "../../lib/validators";
import { Actor, SchedulerListFilters } from "./interfaces";

dayjs.extend(utc);
dayjs.extend(timezone);

const LOCAL_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

export function resolveSchedulerTimezone(timezoneValue?: string | null) {
  if (timezoneValue && isValidTimezone(timezoneValue) && timezoneValue !== "AUTO") {
    return timezoneValue;
  }

  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (detected && isValidTimezone(detected)) {
    return detected;
  }

  return "UTC";
}

export function isValidSchedulerDateTimeInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (LOCAL_DATETIME_PATTERN.test(trimmed)) {
    return true;
  }

  return !Number.isNaN(new Date(trimmed).getTime());
}

export function parseSchedulerDateTimeInput(value: string | Date, timezoneValue?: string | null) {
  if (value instanceof Date) {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Invalid scheduler datetime");
  }

  if (LOCAL_DATETIME_PATTERN.test(trimmed)) {
    const timezone = resolveSchedulerTimezone(timezoneValue);
    return dayjs.tz(trimmed, timezone).toDate();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid scheduler datetime");
  }

  return parsed;
}

export function formatSchedulerDateTime(date: Date | null | undefined, timezoneValue?: string | null) {
  if (!date) {
    return "TBD";
  }

  const timezone = resolveSchedulerTimezone(timezoneValue);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short",
  }).format(date);
}

export function getSchedulerDayRange(date: Date, timezoneValue?: string | null) {
  const timezone = resolveSchedulerTimezone(timezoneValue);
  const localDate = dayjs(date).tz(timezone);

  return {
    start: localDate.startOf("day").toDate(),
    end: localDate.endOf("day").toDate(),
  };
}

export function isAdmin(actor: Actor) {
  return actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
}

export function parseEnumQueryList<T extends string>(
  value: string | undefined,
  enumMap: Record<string, T>,
  fieldName: string
): T[] | undefined {
  if (!value) return undefined;
  const rawValues = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const unknown = rawValues.filter((item) => !enumMap[item]);
  if (unknown.length > 0) {
    throw new Error(`Unsupported ${fieldName} value(s): ${unknown.join(", ")}`);
  }

  return rawValues.map((item) => enumMap[item]);
}

export function parseStringArrayField(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          throw new Error(`${fieldName} must be a string array`);
        }
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      } catch {
        throw new Error(`${fieldName} must be a valid JSON array or comma-separated string`);
      }
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  throw new Error(`${fieldName} must be an array`);
}

export function normalizeDateRange(filters: SchedulerListFilters, timezoneValue?: string | null) {
  const timezone = resolveSchedulerTimezone(timezoneValue);
  const parseValue = (value: string | Date | undefined, boundary: "start" | "end") => {
    if (!value) {
      return null;
    }

    const parsed = parseSchedulerDateTimeInput(value, timezone);
    return boundary === "start"
      ? dayjs(parsed).tz(timezone).startOf("minute").toDate()
      : dayjs(parsed).tz(timezone).endOf("minute").toDate();
  };

  if (filters.from && filters.to) {
    return {
      start: parseValue(filters.from, "start"),
      end: parseValue(filters.to, "end"),
    };
  }

  const anchor = filters.date
    ? dayjs(parseSchedulerDateTimeInput(filters.date, timezone)).tz(timezone)
    : dayjs().tz(timezone);
  switch (filters.view) {
    case "day":
      return {
        start: anchor.startOf("day").toDate(),
        end: anchor.endOf("day").toDate(),
      };
    case "week": {
      const start = anchor.startOf("day").subtract(anchor.day(), "day");
      return {
        start: start.toDate(),
        end: start.add(6, "day").endOf("day").toDate(),
      };
    }
    case "month":
      return {
        start: anchor.startOf("month").toDate(),
        end: anchor.endOf("month").toDate(),
      };
    case "list":
    default:
      return {
        start: parseValue(filters.from, "start"),
        end: parseValue(filters.to, "end"),
      };
  }
}

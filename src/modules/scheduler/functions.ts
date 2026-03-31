import dayjs from "dayjs";
import { Role } from "@prisma/client";
import { Actor, SchedulerListFilters } from "./interfaces";

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

export function normalizeDateRange(filters: SchedulerListFilters) {
  if (filters.from && filters.to) {
    return {
      start: dayjs(filters.from).startOf("minute").toDate(),
      end: dayjs(filters.to).endOf("minute").toDate(),
    };
  }

  const anchor = filters.date ? dayjs(filters.date) : dayjs();
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
        start: filters.from ? dayjs(filters.from).startOf("minute").toDate() : null,
        end: filters.to ? dayjs(filters.to).endOf("minute").toDate() : null,
      };
  }
}

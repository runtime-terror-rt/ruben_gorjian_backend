/**
 * Plan category types for Talexia
 * These represent the different subscription plan categories
 */
export type PlanCategory =
  | "CALENDAR_ONLY"
  | "VISUAL_ADD_ON"
  | "VISUAL_CALENDAR"
  | "FULL_MANAGEMENT"
  | "JEWELRY_CALENDAR_ONLY"
  | "JEWELRY_VISUAL"
  | "JEWELRY_FULL_MANAGEMENT";

/**
 * Plan category constants for type-safe comparisons
 */
export const PlanCategory = {
  CALENDAR_ONLY: "CALENDAR_ONLY" as const,
  VISUAL_ADD_ON: "VISUAL_ADD_ON" as const,
  VISUAL_CALENDAR: "VISUAL_CALENDAR" as const,
  FULL_MANAGEMENT: "FULL_MANAGEMENT" as const,
  JEWELRY_CALENDAR_ONLY: "JEWELRY_CALENDAR_ONLY" as const,
  JEWELRY_VISUAL: "JEWELRY_VISUAL" as const,
  JEWELRY_FULL_MANAGEMENT: "JEWELRY_FULL_MANAGEMENT" as const,
} as const;

/**
 * Check if a string is a valid plan category
 */
export function isValidPlanCategory(category: string): category is PlanCategory {
  return [
    PlanCategory.CALENDAR_ONLY,
    PlanCategory.VISUAL_ADD_ON,
    PlanCategory.VISUAL_CALENDAR,
    PlanCategory.FULL_MANAGEMENT,
    PlanCategory.JEWELRY_CALENDAR_ONLY,
    PlanCategory.JEWELRY_VISUAL,
    PlanCategory.JEWELRY_FULL_MANAGEMENT,
  ].includes(category as PlanCategory);
}



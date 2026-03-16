import { describe, expect, it } from "vitest";
import { contactPayloadSchema } from "../src/modules/contact/routes";

describe("contactPayloadSchema", () => {
  it("accepts a valid payload", () => {
    const result = contactPayloadSchema.safeParse({
      fullName: "Jane Doe",
      businessName: "Acme Co",
      email: "jane@example.com",
      interests: ["calendar", "ai-visuals"],
      postsPerMonth: "20",
      message: "Hello",
      websiteOrHandle: "@acme",
      source: "test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = contactPayloadSchema.safeParse({
      businessName: "Acme Co",
      email: "jane@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid interest values", () => {
    const result = contactPayloadSchema.safeParse({
      fullName: "Jane",
      businessName: "Acme",
      email: "jane@example.com",
      interests: ["calendar", "invalid-option"],
    });
    expect(result.success).toBe(false);
  });
});

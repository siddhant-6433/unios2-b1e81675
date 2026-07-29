import { describe, expect, it } from "vitest";
import { batchEndYear } from "@/pages/IdCardCenter";

describe("batchEndYear", () => {
  it("expands a 2-digit end to the start's century", () => {
    expect(batchEndYear("2026-28")).toBe(2028);
    expect(batchEndYear("2026 – 28")).toBe(2028);
  });
  it("keeps a 4-digit end as-is", () => {
    expect(batchEndYear("2026-2028")).toBe(2028);
  });
  it("returns null without a range", () => {
    expect(batchEndYear("2028")).toBeNull();
    expect(batchEndYear("-")).toBeNull();
  });
});

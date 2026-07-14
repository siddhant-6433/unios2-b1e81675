import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");
const dateRangeFilter = readFileSync("src/components/filters/DateRangeFilter.tsx", "utf8");
const stateFields = readFileSync("src/components/ui/state-fields.tsx", "utf8");
const datePresets = readFileSync("src/lib/datePresets.ts", "utf8");
const appTsx = readFileSync("src/App.tsx", "utf8");

describe("marketing date filter", () => {
  it("exposes all-time, preset, and custom date filters on the marketing page", () => {
    expect(marketingPage).toContain('useState<DatePreset>("all")');
    expect(marketingPage).toContain("<DateRangeFilter");
    expect(datePresets).toContain("All time");
    expect(datePresets).toContain("Today");
    expect(datePresets).toContain("Yesterday");
    expect(datePresets).toContain("This week");
    expect(datePresets).toContain("This month");
    expect(datePresets).toContain("Last 7 days");
    expect(datePresets).toContain("Last 30 days");
    expect(datePresets).toContain("Last 90 days");
    expect(datePresets).toContain("Custom range");
    expect(dateRangeFilter).toContain("<DateRangeField");
    expect(stateFields).toContain('ariaLabel={`${ariaPrefix} start date`}');
    expect(stateFields).toContain('ariaLabel={`${ariaPrefix} end date`}');
  });

  it("applies created_at bounds to both WhatsApp and email campaign queries", () => {
    expect(marketingPage).toContain('whatsappQuery.gte("created_at", dateBounds.from)');
    expect(marketingPage).toContain('emailQuery.gte("created_at", dateBounds.from)');
    expect(marketingPage).toContain('whatsappQuery.lt("created_at", dateBounds.to)');
    expect(marketingPage).toContain('emailQuery.lt("created_at", dateBounds.to)');
    expect(marketingPage).toContain("getEndExclusive");
  });

  it("routes staff users to the marketing dashboard", () => {
    expect(appTsx).toContain('import("./pages/Marketing")');
    expect(appTsx).toContain('path="/marketing"');
  });
});

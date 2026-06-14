import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");
const appTsx = readFileSync("src/App.tsx", "utf8");

describe("marketing date filter", () => {
  it("exposes all-time, preset, and custom date filters on the marketing page", () => {
    expect(marketingPage).toContain('useState<DatePreset>("all")');
    expect(marketingPage).toContain("All time");
    expect(marketingPage).toContain("Last 7 days");
    expect(marketingPage).toContain("Last 30 days");
    expect(marketingPage).toContain("Last 90 days");
    expect(marketingPage).toContain('type="date"');
    expect(marketingPage).toContain("Campaign start date");
    expect(marketingPage).toContain("Campaign end date");
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const applicationsPage = readFileSync("src/pages/Applications.tsx", "utf8");

describe("Applications dashboard loading performance", () => {
  it("renders base application rows before secondary enrichment lookups", () => {
    const baseRender = applicationsPage.indexOf("Render the base application rows before secondary dashboard enrichment");
    const relatedLeadLookups = applicationsPage.indexOf("if (leadIds.length > 0)");
    const feeStatusEnrichment = applicationsPage.indexOf("fetchLeadFeeStatus(");

    expect(baseRender).toBeGreaterThan(-1);
    expect(relatedLeadLookups).toBeGreaterThan(baseRender);
    expect(feeStatusEnrichment).toBeGreaterThan(baseRender);
    expect(applicationsPage).toContain("Math.min(4, feeStatusLeadIds.length)");
    expect(applicationsPage).not.toContain('rpc("lead_fee_status"');
  });
});

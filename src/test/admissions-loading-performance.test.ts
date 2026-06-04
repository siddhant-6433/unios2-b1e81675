import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admissions = readFileSync("src/pages/Admissions.tsx", "utf8");

describe("Admissions CRM loading performance guardrails", () => {
  it("hydrates application progress in bounded batches instead of one large lead_id filter", () => {
    expect(admissions).toContain("APPLICATION_HYDRATE_CHUNK_SIZE = 50");
    expect(admissions).toContain("for (const leadIdBatch of chunkIds(leadIds))");
    expect(admissions).toContain('.in("lead_id", leadIdBatch)');
    expect(admissions).not.toContain('.in("lead_id", leadIds)');
    expect(admissions).toContain("applyApplicationHydration(enriched)");
    expect(admissions).not.toContain("await hydrateApplications(enriched)");
  });

  it("does not let the initial admissions page spinner stay up forever after a fetch failure", () => {
    expect(admissions).toContain("try {");
    expect(admissions).toContain("catch (error)");
    expect(admissions).toContain("finally {");
    expect(admissions).toContain("setHasLoadedOnce(true);");
    expect(admissions).toContain("Admissions CRM could not load");
    expect(admissions).toContain("Retry");
  });

  it("keeps the fix inside client-side RLS-protected queries", () => {
    expect(admissions).not.toMatch(/\brpc\(["'].*applications/i);
    expect(admissions).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(admissions).not.toMatch(/\bGRANT\b/i);
  });
});

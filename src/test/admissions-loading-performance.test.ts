import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admissions = readFileSync("src/pages/Admissions.tsx", "utf8");
const admissionsData = readFileSync("src/hooks/useAdmissionsData.ts", "utf8");
const overviewMigration = readFileSync("supabase/migrations/20260618160000_admissions_overview_and_enrichment.sql", "utf8");

describe("Admissions CRM loading performance guardrails", () => {
  it("hydrates application progress through the admissions overview payload instead of client lead_id fanout", () => {
    expect(admissionsData).toContain('rpc("admissions_overview"');
    expect(overviewMigration).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(overviewMigration).toContain("jsonb_build_object");
    expect(admissions).not.toContain('.in("lead_id", leadIds)');
    expect(admissions).not.toContain("APPLICATION_HYDRATE_CHUNK_SIZE");
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

  it("keeps the fix RLS-preserving", () => {
    expect(overviewMigration).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(overviewMigration).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(admissions).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(admissions).not.toMatch(/\bGRANT\b/i);
  });
});

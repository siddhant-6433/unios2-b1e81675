import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalActionBar = readFileSync("src/components/layout/GlobalActionBar.tsx", "utf8");
const appSidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const headerResponseTime = readFileSync("src/components/layout/HeaderResponseTime.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260618150000_crm_layout_perf_indexes.sql", "utf8");

describe("CRM layout performance guardrails", () => {
  it("does not materialize counsellor lead IDs for repeated layout counts", () => {
    expect(globalActionBar).not.toContain("myLeadIds");
    expect(appSidebar).not.toContain("myLeadIds");
    expect(globalActionBar).not.toContain(".in(\"lead_id\"");
    expect(appSidebar).not.toContain(".in(\"lead_id\"");
  });

  it("uses embedded lead filters so existing RLS still gates scoped counts", () => {
    expect(globalActionBar).toContain("leads!inner(counsellor_id)");
    expect(appSidebar).toContain("leads!inner(counsellor_id)");
    expect(headerResponseTime).toContain("leads!inner(created_at, counsellor_id)");
    expect(headerResponseTime).not.toContain("for (let i = 0; i < leadIds.length");
  });

  it("keeps the CRM performance migration limited to indexes", () => {
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bALTER\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bDROP\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });
});

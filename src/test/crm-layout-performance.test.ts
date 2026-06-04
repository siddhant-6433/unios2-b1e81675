import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalActionBar = readFileSync("src/components/layout/GlobalActionBar.tsx", "utf8");
const appSidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const headerResponseTime = readFileSync("src/components/layout/HeaderResponseTime.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260618150000_crm_layout_perf_indexes.sql", "utf8");
const actionBadgeCounts = readFileSync("supabase/migrations/20260618183000_action_badge_counts.sql", "utf8");

describe("CRM layout performance guardrails", () => {
  it("does not materialize counsellor lead IDs for repeated layout counts", () => {
    expect(globalActionBar).not.toContain("myLeadIds");
    expect(appSidebar).not.toContain("myLeadIds");
    expect(globalActionBar).not.toContain(".in(\"lead_id\"");
    expect(appSidebar).not.toContain(".in(\"lead_id\"");
  });

  it("uses one invoker payload for repeated layout counts so RLS still gates scoped counts", () => {
    expect(globalActionBar).toContain('rpc("action_badge_counts"');
    expect(appSidebar).toContain('rpc("action_badge_counts"');
    expect(actionBadgeCounts).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(actionBadgeCounts).toContain("public.get_user_role(auth.uid())");
    expect(actionBadgeCounts).toContain("role_name = 'counsellor'");
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

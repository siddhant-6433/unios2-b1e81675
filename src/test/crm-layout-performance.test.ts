import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalActionBar = readFileSync("src/components/layout/GlobalActionBar.tsx", "utf8");
const appSidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const appLayout = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
const whatsAppPanel = readFileSync("src/components/layout/WhatsAppPanel.tsx", "utf8");
const headerResponseTime = readFileSync("src/components/layout/HeaderResponseTime.tsx", "utf8");
const useTatDefaults = readFileSync("src/hooks/useTatDefaults.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260618150000_crm_layout_perf_indexes.sql", "utf8");
const actionBadgeCounts = readFileSync("supabase/migrations/20260618183000_action_badge_counts.sql", "utf8");
const fastActionBadgeCounts = readFileSync("supabase/migrations/20260625130000_fast_action_badge_counts.sql", "utf8");
const myTatDefaults = readFileSync("supabase/migrations/20260618195000_my_tat_defaults.sql", "utf8");
const pgStatSnapshots = readFileSync("supabase/migrations/20260618200000_snapshot_and_reset_pg_stat_statements.sql", "utf8");

describe("CRM layout performance guardrails", () => {
  it("does not materialize counsellor lead IDs for repeated layout counts", () => {
    expect(globalActionBar).not.toContain("myLeadIds");
    expect(appSidebar).not.toContain("myLeadIds");
    expect(globalActionBar).not.toContain(".in(\"lead_id\"");
    expect(appSidebar).not.toContain(".in(\"lead_id\"");
    expect(whatsAppPanel).not.toContain(".select(\"id\", { count: \"exact\", head: true })");
    expect(whatsAppPanel).not.toContain(".from(\"leads\").select(\"id\").eq(\"counsellor_id\"");
  });

  it("uses one invoker payload for repeated layout counts so RLS still gates scoped counts", () => {
    expect(globalActionBar).toContain('rpc("action_badge_counts"');
    expect(appSidebar).toContain('rpc("action_badge_counts"');
    expect(appLayout).toContain("deferredShellReady");
    expect(actionBadgeCounts).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(actionBadgeCounts).toContain("public.get_user_role(auth.uid())");
    expect(actionBadgeCounts).toContain("role_name = 'counsellor'");
    expect(headerResponseTime).toContain("leads!inner(created_at, counsellor_id)");
    expect(headerResponseTime).not.toContain("for (let i = 0; i < leadIds.length");
  });

  it("keeps mounted WhatsApp and TAT banners off heavyweight REST view/count paths", () => {
    expect(whatsAppPanel).toContain('rpc("action_badge_counts"');
    expect(useTatDefaults).toContain('rpc("my_tat_defaults"');
    expect(myTatDefaults).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(myTatDefaults).toContain("public.get_user_role(auth.uid())");
    expect(myTatDefaults).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
  });

  it("keeps the CRM performance migration limited to indexes", () => {
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bALTER\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bDROP\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });

  it("keeps action_badge_counts fast without changing the RLS boundary", () => {
    expect(fastActionBadgeCounts).toMatch(/CREATE OR REPLACE FUNCTION public\.action_badge_counts/i);
    expect(fastActionBadgeCounts).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(fastActionBadgeCounts).toContain("GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated");
    expect(fastActionBadgeCounts).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(fastActionBadgeCounts).not.toMatch(/\bALTER\s+POLICY\b/i);
    expect(fastActionBadgeCounts).not.toMatch(/\bDROP\s+POLICY\b/i);
    expect(fastActionBadgeCounts).not.toContain("action_badge_counts_base");
    expect(fastActionBadgeCounts).not.toContain("whatsapp_unreplied_message_count");
    expect(fastActionBadgeCounts).toContain("idx_whatsapp_messages_unread_phone_conversation_created");
    expect(fastActionBadgeCounts).toContain("idx_whatsapp_messages_outbound_phone_conversation_created");
  });

  it("archives pg_stat_statements before the nightly reset", () => {
    expect(pgStatSnapshots).toContain("CREATE TABLE IF NOT EXISTS public.query_performance_snapshots");
    expect(pgStatSnapshots).toContain("ENABLE ROW LEVEL SECURITY");
    expect(pgStatSnapshots).toContain("INSERT INTO public.query_performance_snapshots");
    expect(pgStatSnapshots).toContain("extensions.pg_stat_statements_reset");
    expect(pgStatSnapshots.indexOf("INSERT INTO public.query_performance_snapshots")).toBeLessThan(
      pgStatSnapshots.indexOf("extensions.pg_stat_statements_reset"),
    );
    expect(pgStatSnapshots).toContain("'30 20 * * *'");
    expect(pgStatSnapshots).not.toMatch(/GRANT\s+SELECT/i);
  });
});

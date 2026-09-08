import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const globalActionBar = readFileSync("src/components/layout/GlobalActionBar.tsx", "utf8");
const appSidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const appLayout = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
const whatsAppPanel = readFileSync("src/components/layout/WhatsAppPanel.tsx", "utf8");
const headerResponseTime = readFileSync("src/components/layout/HeaderResponseTime.tsx", "utf8");
const useTatDefaults = readFileSync("src/hooks/useTatDefaults.ts", "utf8");
const actionBadgeCountsHelper = readFileSync("src/lib/actionBadgeCounts.ts", "utf8");
const liveCallBar = readFileSync("src/components/layout/LiveCallBar.tsx", "utf8");
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
    // Banners route through the shared dedup helper, which is the sole caller
    // of the RPC (collapses concurrent bursts to avoid statement timeouts).
    expect(globalActionBar).toContain("fetchActionBadgeCounts(");
    expect(appSidebar).toContain("fetchActionBadgeCounts(");
    expect(actionBadgeCountsHelper).toContain('rpc("action_badge_counts"');
    expect(appLayout).toContain("deferredShellReady");
    expect(actionBadgeCounts).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(actionBadgeCounts).toContain("public.get_user_role(auth.uid())");
    expect(actionBadgeCounts).toContain("role_name = 'counsellor'");
    expect(headerResponseTime).toContain("leads!inner(created_at, counsellor_id)");
    expect(headerResponseTime).not.toContain("for (let i = 0; i < leadIds.length");
  });

  it("keeps mounted WhatsApp and TAT banners off heavyweight REST view/count paths", () => {
    // Header WhatsApp chrome is unread notifications only. The ~1.2s
    // needs-reply aggregate stays on the inbox page, never on layout chrome.
    expect(whatsAppPanel).not.toContain("fetchWhatsAppReplyStateCounts(");
    expect(whatsAppPanel).not.toContain("need reply");
    expect(whatsAppPanel).not.toContain('.from("whatsapp_conversations"');
    expect(appSidebar).not.toContain("fetchWhatsAppReplyStateCounts(");
    expect(actionBadgeCountsHelper).toContain('rpc("whatsapp_reply_state_counts"');
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

  it("restores the action bar for counsellors on every page except the dialer console", () => {
    // Counsellors lost the GlobalActionBar entirely; it now renders for them
    // everywhere except /cloud-dialer (isConsole), where the numbers duplicate
    // as bucket chips. The old blanket `role !== "counsellor"` gate is gone.
    expect(appLayout).not.toContain('role !== "counsellor" && <GlobalActionBar');
    expect(appLayout).toContain('!(role === "counsellor" && isConsole) && <GlobalActionBar');
  });

  it("skips background polling of the expensive aggregates while the tab is hidden", () => {
    // Every open CRM tab polls independently; a backgrounded tab must not keep
    // firing the action-badge aggregate or the live-call poll.
    expect(globalActionBar).toContain('document.visibilityState === "visible"');
    expect(globalActionBar).toContain('addEventListener("visibilitychange"');
    expect(liveCallBar).toContain('document.visibilityState === "visible"');
    expect(liveCallBar).toContain('addEventListener("visibilitychange"');
    expect(appSidebar).toContain('document.visibilityState === "visible"');
    expect(liveCallBar).toContain("LIVE_CALL_IDLE_POLL_MS");
    expect(liveCallBar).toContain("LIVE_CALL_ACTIVE_POLL_MS");
  });

  it("does not subscribe layout chrome to unfiltered hot-table WAL", () => {
    // Delivery-status updates on whatsapp_messages (up to 500/min) plus lead
    // writes used to fan out to every CRM tab and re-run action_badge_counts.
    expect(appSidebar).not.toContain('table: "whatsapp_messages"');
    expect(appSidebar).not.toContain('table: "leads"');
    expect(appSidebar).not.toContain('table: "lead_followups"');
    expect(appSidebar).not.toContain('table: "ai_call_records"');
    expect(whatsAppPanel).not.toContain("wa-conversations-header");
    expect(whatsAppPanel).not.toMatch(/table:\s*"whatsapp_messages"/);
  });

  it("polls the WhatsApp inbox instead of subscribing to every message WAL event", () => {
    const inbox = readFileSync("src/pages/WhatsAppInbox.tsx", "utf8");
    expect(inbox).not.toContain('.channel("whatsapp-inbox")');
    expect(inbox).not.toContain('event: "*"');
    expect(inbox).toContain("tickNew");
    expect(inbox).toContain("tickStatus");
  });

  it("moves the Counsellor Dashboard activity log off client-side row scans", () => {
    const dashboard = readFileSync("src/pages/CounsellorDashboard.tsx", "utf8");
    const activityRpc = readFileSync(
      "supabase/migrations/20260831084853_counsellor_activity_log_rpc.sql", "utf8");
    // No more .limit(500) client scans of lead_activities/call_logs in fetchActivity.
    expect(dashboard).toContain('rpc("get_counsellor_activity_log"');
    expect(dashboard).not.toContain('.from("lead_activities" as any)');
    expect(activityRpc).toMatch(/CREATE OR REPLACE FUNCTION public\.get_counsellor_activity_log/i);
    expect(activityRpc).toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(activityRpc).toContain("TO authenticated");
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

  it("drops whatsapp_messages from Realtime and skips empty cron Edge wakeups", () => {
    const loadRelief = readMigration("reduce_small_compute_load");
    expect(loadRelief).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_messages");
    expect(loadRelief).toContain("wm.status IS DISTINCT FROM l.status");
    expect(loadRelief).toContain("fn_invoke_campaign_dispatcher_if_due");
    expect(loadRelief).toContain("fn_invoke_whatsapp_buffer_if_due");
    expect(loadRelief).toContain("fn_invoke_easebuzz_fast_if_pending");
  });
});

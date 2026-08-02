import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workStateMigration = readFileSync(
  "supabase/migrations/20260802082638_call_list_work_state.sql",
  "utf8",
);
const queueMigration = readFileSync(
  "supabase/migrations/20260802082900_cloud_dialer_campaign_queue.sql",
  "utf8",
);
const overviewMigration = readFileSync(
  "supabase/migrations/20260802085434_call_list_overview.sql",
  "utf8",
);
const floorSchemaMigration = readFileSync(
  "supabase/migrations/20260802100814_call_list_assigned_at_floor_schema.sql",
  "utf8",
);
const floorReadersMigration = readFileSync(
  "supabase/migrations/20260802100855_call_list_assigned_at_floor_readers.sql",
  "utf8",
);
const stampMigration = readFileSync(
  "supabase/migrations/20260802111720_call_list_assigned_at_stamp.sql",
  "utf8",
);
const reentrantMigration = readFileSync(
  "supabase/migrations/20260802111900_call_list_assign_reentrant.sql",
  "utf8",
);
const attributionMigration = readFileSync(
  "supabase/migrations/20260802113502_call_list_count_own_assignee_calls.sql",
  "utf8",
);
const attributionReadersMigration = readFileSync(
  "supabase/migrations/20260802113544_call_list_own_assignee_readers.sql",
  "utf8",
);
const notDialableMigration = readFileSync(
  "supabase/migrations/20260802115927_call_list_not_dialable_and_counsellor_activity.sql",
  "utf8",
);
const dialer = readFileSync("src/pages/CloudDialer.tsx", "utf8");
const progressPanel = readFileSync("src/components/dashboard/CallListProgressPanel.tsx", "utf8");
const dashboard = readFileSync("src/pages/Dashboard.tsx", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const admissions = readFileSync("src/pages/Admissions.tsx", "utf8");
const appLayout = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const server = readFileSync("voice-agent/server.ts", "utf8");

describe("assigned call lists", () => {
  it("gives list members work state so an assigned list is dialable", () => {
    expect(workStateMigration).toContain("ADD COLUMN IF NOT EXISTS assigned_to");
    expect(workStateMigration).toContain("ADD COLUMN IF NOT EXISTS work_status");
    expect(workStateMigration).toContain("CHECK (work_status IN ('pending', 'worked', 'skipped'))");
    expect(workStateMigration).toContain("CHECK (purpose IN ('marketing', 'calling'))");
    expect(workStateMigration).toContain("idx_llm_assigned_pending");
  });

  it("marks a member worked from any calling surface, not just list mode", () => {
    // The write hangs off call_logs, which every dialing path inserts into —
    // list queue, smart queue, and the lead page all count toward progress.
    expect(workStateMigration).toContain("CREATE OR REPLACE FUNCTION public.fn_cleanup_cloud_dialer_pin");
    expect(workStateMigration).toContain("SET work_status = 'worked'");
    expect(workStateMigration).toContain("ll.purpose = 'calling'");
  });

  it("sends one summary notification per counsellor, not one per lead", () => {
    expect(workStateMigration).toContain("current_setting('app.bulk_assign', true) = 'on'");
    expect(workStateMigration).toContain("PERFORM set_config('app.bulk_assign', 'on', true)");
    expect(workStateMigration).toContain("'Priority call list: '");
    expect(workStateMigration).toContain("'/cloud-dialer?list=' || _list_id");
  });

  it("stops silently stealing already-owned leads on re-assignment", () => {
    expect(workStateMigration).toContain("_only_unassigned boolean DEFAULT false");
    expect(workStateMigration).toContain("NOT _only_unassigned OR l.counsellor_id IS NULL");
    expect(leadLists).toContain("_only_unassigned: assignOnlyUnassigned");
  });

  it("replaces the hardcoded zero failed_count with a real one", () => {
    expect(workStateMigration).toContain("GREATEST(COALESCE(e.n, 0) - COALESCE(c.assigned_count, 0), 0)::integer");
  });

  it("tightens lead_lists RLS off USING (true) for writes", () => {
    expect(workStateMigration).toContain('DROP POLICY IF EXISTS "Authenticated users can manage lead_lists"');
    expect(workStateMigration).toContain("can_manage_lead_lists()");
    expect(workStateMigration).toContain('CREATE POLICY "Super admin can delete lead_lists"');
  });

  it("serves the list as a queue in the dialer's own payload shape", () => {
    expect(queueMigration).toContain("CREATE OR REPLACE FUNCTION public.cloud_dialer_campaign_queue");
    expect(queueMigration).toContain("m.work_status = 'pending'");
    expect(queueMigration).toContain("ORDER BY m.sort_order NULLS LAST, m.added_at");
    expect(queueMigration).toContain("'Call List'");
    // Terminal-stage leads must never reach a dialer, list or not.
    expect(queueMigration).toContain("l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')");
  });

  it("restores the Pinned bucket that 'Add to Dialer' writes to", () => {
    expect(queueMigration).toContain("public.cloud_dialer_pins p");
    expect(queueMigration).toContain("0 AS bucket_priority, 'Pinned'::text");
    expect(dialer).toContain('"Pinned":');
  });

  it("folds hot leads into the queue instead of a floating sidebar", () => {
    expect(queueMigration).toContain("'Interested & Hot'::text");
    expect(queueMigration).toContain("l.lead_temperature = 'hot'");
    expect(admissions).toContain('role !== "counsellor" && (');
  });

  it("wires the dialer to list mode, progress, and skip", () => {
    expect(dialer).toContain('queueSource.startsWith("list:")');
    expect(dialer).toContain("useCloudDialerCampaignQueue");
    expect(dialer).toContain("useMyCallLists");
    expect(dialer).toContain('searchParams.get("list")');
    expect(dialer).toContain('skip_call_list_member');
    expect(dialer).toContain("My Call Lists");
  });

  it("keeps inline post-call actions from being raced by auto-next", () => {
    expect(dialer).toContain("const holdCountdown");
    expect(dialer).toContain("holdCountdown(() => setShowPaymentLink(true))");
    expect(dialer).toContain("holdCountdown(() => setShowWhatsApp(true))");
    expect(dialer).toContain("holdCountdown(() => setShowWalkin(true))");
    expect(dialer).toContain("holdCountdown(() => setShowApplyLink(true))");
  });

  it("uses one retry ladder across the client and the voice agent", () => {
    expect(dialer).toContain("const FOLLOWUP_GAPS = [4, 24, 72]");
    expect(server).toContain("const gap = att === 1 ? 4 : att === 2 ? 24 : 72");
  });

  it("gives counsellors one work surface", () => {
    // /fresh-leads and /missed-calls are dialer buckets for counsellors.
    expect(app).toContain('<RedirectRole roles={["counsellor"]} to="/cloud-dialer">');
    expect(appLayout).toContain('role !== "counsellor" && <GlobalActionBar />');
    expect(admissions).toContain('role === "counsellor" ? ["pipeline", "list"]');
  });

  it("gives assigners call outcomes, not just a progress count", () => {
    // The disposition breakdown IS the "call update" a principal is after.
    expect(overviewMigration).toContain("CREATE OR REPLACE FUNCTION public.call_list_overview");
    expect(overviewMigration).toContain("jsonb_object_agg(COALESCE(disposition, 'unrecorded')");
    expect(overviewMigration).toContain("'last_call_at'");
    // Pending members must not contribute a disposition: any call they have
    // predates the assignment and would read as "already handled".
    expect(overviewMigration).toContain("WHERE vm.work_status = 'worked'");
    expect(overviewMigration).toContain("WHERE m.work_status = 'worked'");
    expect(progressPanel).toContain("Assigned call lists");
    expect(progressPanel).toContain("DISPOSITION_STYLE");
    expect(leadLists).toContain("reportDispositionFilter");
  });

  it("never counts a call from a previous cycle", () => {
    // The cycle boundary is stamped on the member row at hand-off...
    expect(floorSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS assigned_at timestamptz");
    expect(stampMigration).toContain("assigned_at = v_now");
    // ...and every reader is floored on it. Without the stamp the floors all
    // fall back to "no floor" via the IS NULL branch, so both halves must ship.
    expect(floorSchemaMigration).toContain(
      "AND (m.assigned_at IS NULL OR COALESCE(NEW.called_at, now()) >= m.assigned_at)");
    expect(floorSchemaMigration).toContain(
      "AND (m.assigned_at IS NULL OR cl.called_at >= m.assigned_at)");
    expect(floorReadersMigration).toContain(
      "AND (vm.assigned_at IS NULL OR cl.called_at >= vm.assigned_at)");
    // The per-lead Calling Report had the same bug: its LATERAL took the newest
    // call whenever it happened, so a months-old disposition could display as
    // the result of a list assigned this morning.
    expect(floorReadersMigration).toContain("AND cl.called_at >= h.created_at");
    expect(floorReadersMigration).toContain("AND acl.created_at >= h.created_at");
    // The list's reported hand-off date is the real assignment, not list creation.
    expect(floorReadersMigration).toContain("max(assigned_at) AS assigned_at");
  });

  it("only counts calls placed by the list's own assignee", () => {
    // Credit follows the caller. A lead in two active lists no longer clears in
    // both when either counsellor dials it.
    expect(attributionMigration).toContain("AND m.assigned_to = v_caller_profile_id");
    expect(attributionMigration).toContain("AND cl.user_id = cp.user_id");
    expect(attributionReadersMigration).toContain("AND cl.user_id = cp.user_id");
    // The per-lead report's human-call branch too. call_logs.user_id is
    // auth.users.id while assigned_to is profiles.id, hence the profile join.
    expect(attributionReadersMigration).toContain("AND cl.user_id = assignee.user_id");
    // The AI-call branch stays: an AI call is never attributable to a counsellor,
    // and that column is a "latest contact" display, not a counted outcome.
    expect(attributionReadersMigration).toContain("FROM public.ai_call_logs acl");
  });

  it("keeps an assigned list completable", () => {
    // The queue excludes no-phone / terminal-stage members, so counting them in
    // the denominator made the list unfinishable. First real assignment showed
    // "0/38 called · 38 left" over a queue of 25.
    expect(notDialableMigration).toContain("CHECK (work_status IN ('pending', 'worked', 'skipped', 'not_dialable'))");
    expect(notDialableMigration).toContain("CREATE OR REPLACE FUNCTION public.mark_call_list_undialable");
    expect(notDialableMigration).toContain("PERFORM public.mark_call_list_undialable(_list_id);");
    // The queue's exclusion rule and the not_dialable rule must stay identical,
    // or members land in neither the queue nor the excluded count.
    expect(notDialableMigration).toContain(
      "(l.phone IS NULL\n            OR l.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold'))");
    // Readers expose the honest denominator.
    expect(notDialableMigration).toContain("'dialable'");
    expect(notDialableMigration).toContain("'not_dialable'");
    expect(dialer).toContain("activeList.dialable");
    expect(progressPanel).toContain("list.dialable ?? list.total");
  });

  it("surfaces counsellor activity in the assign picker", () => {
    // login_disabled=false is a poor proxy for active: several counsellors
    // holding hundreds of leads had not dialled in 6+ weeks, and a test account
    // was selectable. Show the evidence rather than guess who is on leave.
    expect(notDialableMigration).toContain("CREATE OR REPLACE FUNCTION public.assignable_counsellors");
    expect(notDialableMigration).toContain("AS last_call_at");
    expect(notDialableMigration).toContain("AS pending_call_list");
    expect(leadLists).toContain("assignable_counsellors");
    expect(leadLists).toContain("DORMANT_DAYS");
    expect(leadLists).toContain("lastCallLabel");
  });

  it("keeps the assignment RPC callable twice in one transaction", () => {
    // ON COMMIT DROP temp tables survive until commit, so a second call in the
    // same transaction hit "relation _eligible_members already exists".
    expect(reentrantMigration).toContain("DROP TABLE IF EXISTS _eligible_members;");
    expect(reentrantMigration).toContain("DROP TABLE IF EXISTS _assignments;");
  });

  it("scopes the assigner rollup by role", () => {
    expect(overviewMigration).toContain("'super_admin'::public.app_role");
    expect(overviewMigration).toContain("'admission_head'::public.app_role");
    expect(overviewMigration).toContain("'principal'::public.app_role");
    // A counsellor who does not lead a team gets nothing back.
    expect(overviewMigration).toContain("IF NOT (v_is_admin OR v_is_team_leader) THEN");
    expect(overviewMigration).toContain("REVOKE ALL ON FUNCTION public.call_list_overview(boolean) FROM PUBLIC, anon");
  });

  it("puts the rollup on the page assigners actually land on", () => {
    expect(dashboard).toContain("<CallListProgressPanel />");
    // Deep link from a list straight into its per-lead Calling Report.
    expect(progressPanel).toContain("/lists?report=");
    expect(leadLists).toContain('searchParams.get("report")');
  });

  it("lets an assigner create and hand off a call list in one step", () => {
    expect(admissions).toContain("assign_lead_list_round_robin");
    expect(admissions).toContain("Assign as a priority call list");
    expect(admissions).toContain("const canAssignLists");
    // The button used to render for everyone and only fail inside the RPC.
    expect(leadLists).toContain("{canAssignLists && (");
  });
});

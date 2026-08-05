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
const dynamicMigration = readFileSync(
  "supabase/migrations/20260802131616_dynamic_lead_lists.sql",
  "utf8",
);
const includeTerminalMigration = readFileSync(
  "supabase/migrations/20260802131652_call_list_include_terminal.sql",
  "utf8",
);
const dynamicFilters = readFileSync("src/lib/dynamicListFilters.ts", "utf8");
const dialer = readFileSync("src/pages/CloudDialer.tsx", "utf8");
const dialerActionRow = readFileSync("src/components/dialer/DialerActionRow.tsx", "utf8");
const dialerQueuePane = readFileSync("src/components/dialer/DialerQueuePane.tsx", "utf8");
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
    // Every DialerActionRow action opens through one holdCountdown wrapper,
    // so the auto-next timer can't advance the queue under an open dialog.
    expect(dialer).toContain("const holdCountdown");
    expect(dialer).toContain("holdCountdown(() => {");
    expect(dialer).toContain("setShowPaymentLink(true)");
    expect(dialer).toContain("setShowWhatsApp(true)");
    expect(dialer).toContain("setShowWalkin(true)");
    expect(dialer).toContain("setShowApplyLink(true)");
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

  it("keeps dynamic-list membership re-derivable", () => {
    // filters_snapshot is audit metadata with five incompatible shapes and
    // half its filters resolve to per-session id-Sets, so a dynamic list needs
    // its own canonical, column-only vocabulary.
    expect(dynamicMigration).toContain("filter_definition jsonb");
    expect(dynamicMigration).toContain("CHECK (list_type IN ('static', 'dynamic'))");
    // A dynamic list with no filter would silently match every lead.
    expect(dynamicMigration).toContain("lead_lists_dynamic_needs_filter");
    expect(dynamicMigration).toContain("CREATE OR REPLACE FUNCTION public.lead_matches_filter");
    expect(dynamicMigration).toContain("CREATE OR REPLACE FUNCTION public.resolve_dynamic_list_members");
    expect(dynamicMigration).toContain("cron.schedule(");
    expect(dynamicMigration).toContain("refresh-dynamic-lead-lists");
    // Never reuse filters_snapshot as the source of truth.
    expect(dynamicMigration).not.toContain("filters_snapshot->>");
  });

  it("only drops dynamic members that were never called", () => {
    // A worked/skipped member is call history; a filter change must not erase it.
    expect(dynamicMigration).toContain("AND m.work_status = 'pending'");
    expect(dynamicMigration).toContain("NOT public.lead_matches_filter(l, v_list.filter_definition)");
    // New matches auto-assign to whoever already holds the list.
    expect(dynamicMigration).toContain("v_owners[((c.rn - 1) % array_length(v_owners, 1)) + 1]");
    // and only notify when something actually arrived.
    expect(dynamicMigration).toContain("IF v_added > 0 AND v_owners IS NOT NULL THEN");
  });

  it("gates 'make dynamic' on filters that can actually be replayed", () => {
    expect(dynamicFilters).toContain("export function unsupportedDynamicFilters");
    expect(dynamicFilters).toContain("export function toFilterDefinition");
    for (const blocked of ["actionLeadIds", "notCalledIds", "followupLeadIds", "applicationStageFilter"]) {
      expect(dynamicFilters).toContain(blocked);
    }
    expect(admissions).toContain("unsupportedDynamicFilters");
    expect(admissions).toContain("canBeDynamic");
    // The dialog must say WHY, not silently drop the unsupported filters.
    expect(admissions).toContain("dynamicBlockers.join(\", \")");
  });

  it("lets an assignment include cold / not-interested leads", () => {
    expect(includeTerminalMigration).toContain("NOT ll.include_terminal");
    // The queue has to read the same flag or members stay pending but never
    // appear — the unfinishable-list bug again.
    expect(includeTerminalMigration).toContain("cfg.include_terminal");
    expect(includeTerminalMigration).toContain("CREATE OR REPLACE FUNCTION public.preview_call_list_assignment");
    expect(leadLists).toContain("assignIncludeTerminal");
    expect(leadLists).toContain("will be dialable");
  });

  it("names Cloud Dialer in the assignment notification and counts dialable", () => {
    expect(includeTerminalMigration).toContain("Open Cloud Dialer to start");
    expect(includeTerminalMigration).toContain("JOIN public.leads l ON l.id = a.lead_id");
  });

  it("reclaims the dialer's top chrome and frees the post-call actions", () => {
    // The four stacked strips (missed banner, dial card, header, list banner)
    // became one toolbar; the dial pad and incoming lookup share a popover.
    expect(dialer).toContain("Single toolbar");
    expect(dialer).toContain("dialPadOpen");
    // Actions must not be gated on a disposition being chosen.
    expect(dialerActionRow).toContain("before, during and after a call");
    expect(dialer).toContain("<DialerActionRow");
    // Pause is reachable whenever there is a queue, not only mid-session.
    expect(dialer).toContain("const pauseDialer");
    expect(dialer).toContain("onClick={pauseDialer} disabled={queue.length === 0}");
    // History collapsed by default.
    expect(dialer).toContain("Previous calls ({callHistory.length})");
  });

  it("writes dialer-scheduled visits to campus_visits", () => {
    // This wrote to `lead_visits`, which does not exist. The cast to `any` hid
    // it from TypeScript and the error was never read, so the stage still
    // advanced to visit_scheduled — leads looked booked with no visit row in
    // Visit Center, the Visit Check-in bucket, post-visit follow-ups or the
    // funnel. 3 leads were stranded that way.
    expect(dialer).not.toContain('from("lead_visits"');
    expect(dialer).toContain("scheduleCampusVisitFromDialer");
    expect(dialer).toContain('from("campus_visits")');
    // The stage must not advance when the visit write failed.
    expect(dialer).toContain("if (!scheduled) return;");
  });

  it("offers schedule-visit and fee-proposal from the dialer", () => {
    expect(dialerActionRow).toContain("Schedule visit");
    expect(dialerActionRow).toContain("Fee proposal");
    expect(dialer).toContain("ScheduleVisitDialog");
    expect(dialer).toContain("SchoolFeeProposalDialog");
    // Same role gate the lead page uses for proposals.
    expect(dialer).toContain("const canCreateProposal");
  });

  it("shows the call-list dropdown to first-time users, once", () => {
    expect(dialer).toContain("call-list-dropdown-seen-v1:");
    expect(dialer).toContain("Your call lists live here");
    // Only once they have a list, and not while already in one.
    expect(dialer).toContain("myCallLists.length > 0 && !activeListId");
    // Selected list gets a distinct treatment.
    expect(dialer).toContain("border-primary bg-primary/10 ring-1 ring-primary/30");
  });

  it("distinguishes static and dynamic lists visually", () => {
    expect(leadLists).toContain("Dynamic");
    expect(leadLists).toContain("Static");
    expect(leadLists).toContain("describeFilterDefinition");
    expect(leadLists).toContain("resolve_dynamic_list_members");
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

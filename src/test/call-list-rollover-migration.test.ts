import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const migration = readMigration("call_list_rollover");

describe("call list rollover migration", () => {
  it("derives is_active from archived_at instead of tracking two flags", () => {
    // Six existing readers already filter on lead_lists.is_active
    // (my_call_lists, call_list_overview, assignable_counsellors,
    // fn_cleanup_cloud_dialer_pin, the dynamic-refresh cron, LeadLists).
    // The trigger is what lets archiving work without touching any of them.
    expect(migration).toContain("archived_at");
    expect(migration).toContain("NEW.is_active := (NEW.archived_at IS NULL)");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF archived_at ON public.lead_lists");
  });

  it("widens assignment_source rather than leaving the CHECK to reject rollovers", () => {
    // Same drift class as notifications_type_check: a new enum-ish value that
    // isn't in the CHECK rolls back the whole inserting transaction, so the
    // rollover would fail as a unit with no obvious cause.
    expect(migration).toContain("lead_assignment_history_assignment_source_check");
    expect(migration).toContain("'list_followup'");
    expect(migration).toContain("'list_round_robin'");
  });

  it("keeps one definition of the follow-up buckets", () => {
    // The dialog's preview and the button's behaviour must not diverge, so the
    // counts RPC reads the candidates function rather than re-deriving them.
    expect(migration).toContain("call_list_followup_candidates");
    expect(migration).toContain("FROM public.call_list_followup_candidates(_list_id)");
    expect(migration).toContain("'no_answer'");
    expect(migration).toContain("'unrecorded'");
  });

  it("only cools leads that never engaged", () => {
    // Anything from application_in_progress onward means the lead acted, and a
    // broader stage write here would fight recompute_lead_fee_stage and the
    // stage-audit job.
    expect(migration).toContain("stage = 'cold'::public.lead_stage");
    expect(migration).toContain("l.stage IN ('new_lead', 'ai_called', 'counsellor_call')");
  });

  it("parks exhausted leads somewhere a dialer will never pick them up", () => {
    expect(migration).toContain("' - exhausted'");
    expect(migration).toContain("'filter', 'marketing', v_now");
  });

  it("does not redefine assign_lead_list_round_robin", () => {
    // Its body lives only in 20260802115927; 20260802131652 and 20260804141436
    // patch its prosrc in place. A CREATE OR REPLACE here would silently revert
    // both patches (include_terminal support and counsellor self-assign).
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.assign_lead_list_round_robin");
  });

  it("locks the new functions down to authenticated callers", () => {
    for (const fn of [
      "can_manage_lead_list",
      "set_lead_list_archived",
      "call_list_followup_candidates",
      "call_list_followup_counts",
      "build_followup_list",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`);
    }
    expect(migration).toContain("FROM PUBLIC, anon");
  });

  it("is idempotent so a re-run cannot fail the ledger", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS archived_at");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS attempt_count");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_lead_lists_parent");
    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_lead_lists_sync_is_active");
  });
});

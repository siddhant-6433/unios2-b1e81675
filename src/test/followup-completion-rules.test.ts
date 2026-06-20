import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pendingFollowupsPage = readFileSync("src/pages/PendingFollowups.tsx", "utf8");
const leadDetailPage = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const actionCenterView = readFileSync("src/components/admissions/ActionCenterView.tsx", "utf8");
const cloudDialerPage = readFileSync("src/pages/CloudDialer.tsx", "utf8");
const cahetSprintPage = readFileSync("src/pages/CahetSprint.tsx", "utf8");
const callLogPage = readFileSync("src/pages/CallLog.tsx", "utf8");
const callDispositionDialog = readFileSync("src/components/admissions/CallDispositionDialog.tsx", "utf8");
const manualCallCancel = readFileSync("supabase/functions/manual-call-cancel/index.ts", "utf8");
const guardMigration = readFileSync(
  "supabase/migrations/20260620126000_guard_followup_completion_by_disposition.sql",
  "utf8",
);
const cancelledCallLogGuardMigration = readFileSync(
  "supabase/migrations/20260620127000_exclude_cancelled_calls_from_call_logs.sql",
  "utf8",
);

describe("follow-up completion rules", () => {
  it("removes direct completion from Pending Follow-ups call tabs", () => {
    expect(pendingFollowupsPage).not.toContain("handleMarkComplete");
    expect(pendingFollowupsPage).not.toContain("Mark as completed");
    expect(pendingFollowupsPage).not.toContain(">Done</button>");
    expect(pendingFollowupsPage).toContain("openLeadFromQueue");
    expect(pendingFollowupsPage).toContain("CallDispositionDialog");
    expect(pendingFollowupsPage).toContain("startInlineCall");
    expect(pendingFollowupsPage).toContain('title="Call and mark disposition inline"');
    expect(pendingFollowupsPage).toContain("recordCallDisposition");
    expect(pendingFollowupsPage).toContain('loggedFromLabel: "pending follow-ups"');
    expect(pendingFollowupsPage).toContain("Call next follow-up");
    expect(pendingFollowupsPage).toContain("followupQueue");
    expect(pendingFollowupsPage).toContain("ids: filtered.map(f => f.lead_id)");
  });

  it("does not let Lead Detail manually clear existing pending follow-ups while scheduling another one", () => {
    expect(leadDetailPage).not.toContain("Follow-up marked as completed");
    expect(leadDetailPage).not.toContain("onCompleteFollowup={completeFollowup}");
    expect(leadDetailPage).not.toContain("creating a new follow-up implies the previous ones have been acted on");
  });

  it("keeps Lead Detail call-next navigation tied to the Pending Follow-ups queue", () => {
    expect(leadDetailPage).toContain("nextFollowupQueueId");
    expect(leadDetailPage).toContain("navigateWithinFollowupQueue");
    expect(leadDetailPage).toContain('startCall ? "?action=call" : ""');
    expect(leadDetailPage).toContain("Next pending follow-up in this tab");
    expect(leadDetailPage).toContain("navigateWithinFollowupQueue(followupQueue!.index + 1, true)");
  });

  it("keeps legacy Action Center disposition writes on the guarded RPC path", () => {
    expect(actionCenterView).toContain("recordCallDisposition");
    expect(actionCenterView).not.toContain(".update({ status: \"completed\", completed_at: new Date().toISOString() })");
    expect(actionCenterView).not.toContain("Mark pending followups as completed");
  });

  it("guards the disposition RPC so not answered reschedules instead of completing the pending follow-up", () => {
    expect(guardMigration).toContain("CREATE OR REPLACE FUNCTION public.record_disposition_writes");
    expect(guardMigration).toContain("p_disposition = 'not_answered'");
    expect(guardMigration).toContain("v_should_clear_followups := p_disposition <> 'not_answered'");
    expect(guardMigration).toContain("SET scheduled_at = p_followup_at");
    expect(guardMigration).toContain("GET DIAGNOSTICS v_rescheduled_count = ROW_COUNT");
    expect(guardMigration).toContain("DROP TRIGGER IF EXISTS trg_followup_for_manual_no_answer");
    expect(guardMigration).toContain("IF v_should_clear_followups THEN");
    expect(guardMigration).toContain("IF p_followup_at IS NOT NULL AND v_should_clear_followups THEN");
  });

  it("does not treat call cancellation as a disposition", () => {
    expect(manualCallCancel).not.toContain('p_disposition:   "cancelled_by_counsellor"');
    expect(manualCallCancel).not.toContain('disposition: "cancelled_by_counsellor"');
    expect(manualCallCancel).not.toContain('description: "Cloud Call cancelled by counsellor"');
    expect(manualCallCancel).toContain('status: "cancelled_by_counsellor"');
    expect(manualCallCancel).toContain("must not create call_logs or");
  });

  it("guards call_logs so cancelled calls never enter counsellor metrics", () => {
    expect(cancelledCallLogGuardMigration).toContain("DELETE FROM public.call_logs");
    expect(cancelledCallLogGuardMigration).toContain("WHERE disposition IN ('cancelled', 'cancelled_by_counsellor')");
    expect(cancelledCallLogGuardMigration).toContain("IF p_disposition IN ('cancelled', 'cancelled_by_counsellor') THEN");
    expect(cancelledCallLogGuardMigration).toContain("RETURN v_id");
    expect(cancelledCallLogGuardMigration).toContain("CREATE OR REPLACE FUNCTION public.call_log_metrics");
    expect(cancelledCallLogGuardMigration).toContain("cl.disposition NOT IN ('cancelled', 'cancelled_by_counsellor')");
    expect(callLogPage).toContain('.not("disposition", "in", \'("cancelled","cancelled_by_counsellor")\')');
    expect(callLogPage).not.toContain('<option value="cancelled">Cancelled</option>');
    expect(cloudDialerPage).not.toContain('{ value: "cancelled", label: "Cancelled"');
    expect(cloudDialerPage).toContain("handleCancelledCall");
    expect(cloudDialerPage).toContain("No disposition recorded and no call metrics changed.");
    expect(cahetSprintPage).not.toContain('persistDisposition(activeCall.lead, "cancelled"');
    expect(cahetSprintPage).toContain("manual-call-cancel");
  });

  it("defaults not answered follow-up scheduling to a two-hour business callback slot", () => {
    expect(callDispositionDialog).toContain("nextNoAnswerFollowupSlot");
    expect(callDispositionDialog).toContain("Date.now() + 2 * 60 * 60 * 1000");
    expect(callDispositionDialog).toContain("const businessStart = 9 * 60");
    expect(callDispositionDialog).toContain("const businessEnd = 18 * 60");
    expect(callDispositionDialog).toContain('return { date: dateInputValue(tomorrow), time: "09:00" }');
    expect(callDispositionDialog).toContain('if (disposition !== "not_answered") return');
  });

  it("keeps Cloud Dialer from clearing or rescheduling on the first same-day not answered attempt", () => {
    expect(cloudDialerPage).toContain("canClearPendingFollowupsForCurrentLead");
    expect(cloudDialerPage).toContain('if (disposition !== "not_answered") return true');
    expect(cloudDialerPage).toContain(".eq(\"disposition\", \"not_answered\")");
    expect(cloudDialerPage).toContain("return (count || 0) >= 2");
    expect(cloudDialerPage).toContain("allowPostDispositionFollowup");
    expect(cloudDialerPage).toContain("First not answered attempt today. Existing pending follow-up remains open.");
  });

  it("keeps Cloud Dialer direct done actions limited to non-call follow-ups", () => {
    expect(cloudDialerPage).toContain("Mark a non-call follow-up");
    expect(cloudDialerPage).toContain('currentLead.followup_type && currentLead.followup_type !== "call"');
    expect(cloudDialerPage).toContain("completeFollowupAndAdvance");
  });
});

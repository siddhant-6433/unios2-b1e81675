import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260625100000_count_course_payments_for_token_lifecycle.sql",
  "utf8",
);
const applicationsPage = readFileSync("src/pages/Applications.tsx", "utf8");
const tokenFeePanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");

describe("course payments unlock token lifecycle", () => {
  it("counts confirmed course payments toward token completion", () => {
    expect(migration).toContain("WHERE type IN ('token_fee','other') AND status = 'confirmed'");
    expect(migration).toContain("'paid_toward_course',           v_paid_toward_course");
    expect(migration).toContain("'token_complete',               (v_token_required > 0 AND v_paid_toward_course >= v_token_required)");
    expect(migration).toContain("'twenty_five_complete',         (v_post_year_1 > 0 AND v_paid_toward_course >= v_an_threshold)");
  });

  it("keeps application and registration fees separate from course progress", () => {
    expect(migration).toContain("WHERE type = 'application_fee' AND status = 'confirmed'");
    expect(migration).toContain("WHERE type = 'registration_fee' AND status = 'confirmed'");
    expect(migration).toContain("'application_paid',             v_app_paid");
    expect(migration).toContain("'registration_paid',            v_registration_paid");
    expect(migration).not.toContain("WHERE type IN ('application_fee','token_fee','other') AND status = 'confirmed'");
  });

  it("replays lifecycle advancement for existing stale course payments", () => {
    expect(migration).toContain("UPDATE public.lead_payments lp");
    expect(migration).toContain("SET amount = lp.amount");
    expect(migration).toContain("lp.type IN ('token_fee','other')");
    expect(migration).toContain("l.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview','token_paid','pre_admitted')");
  });

  it("uses authoritative token_complete on the applications dashboard", () => {
    expect(applicationsPage).toContain("const leadTokenCompleteMap: Record<string, boolean> = {};");
    expect(applicationsPage).toContain("leadTokenCompleteMap[lid] = !!fs.token_complete;");
    expect(applicationsPage).toContain("has_token_fee_paid: leadTokenFeePaidSet.has(a.lead_id) || !!leadTokenCompleteMap[a.lead_id]");
  });

  it("batches applications dashboard lead-side lifecycle lookups", () => {
    expect(applicationsPage).toContain("const RELATED_QUERY_BATCH_SIZE = 50;");
    expect(applicationsPage).toContain("const batch = leadIds.slice(i, i + RELATED_QUERY_BATCH_SIZE);");
    expect(applicationsPage).toContain(".in(\"lead_id\", batch)");
    expect(applicationsPage).toContain("OFFER_OR_PAYMENT_STAGES.has(leadStageMap[lid])");
  });

  it("shows applicant token progress from course-eligible paid amount", () => {
    expect(tokenFeePanel).toContain("feeStatus.total_paid - feeStatus.application_paid - (feeStatus.registration_paid || 0)");
    expect(tokenFeePanel).toContain("const tokenOutstanding = Math.max(0, feeStatus.token_required - paidTowardCourse);");
    expect(tokenFeePanel).toContain("const loanLetterUnlocked = coursePaid >= loanLetterUnlockAmount;");
  });
});

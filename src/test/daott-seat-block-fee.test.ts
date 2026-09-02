import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260702154500_daott_application_seat_block_pan_an.sql",
  "utf8",
);
const offerDialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");
const offerGenerator = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");
const loanGenerator = readFileSync("supabase/functions/generate-loan-letter/index.ts", "utf8");
const offlineDialog = readFileSync("src/components/finance/OfflinePaymentDialog.tsx", "utf8");
const applicantPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const leadFeeLedger = readFileSync("src/components/finance/LeadFeeLedger.tsx", "utf8");
const provisionStudentFees = readFileSync("supabase/functions/provision-student-fees/index.ts", "utf8");

describe("DAOTT seat-block fee", () => {
  it("revises DAOTT/DOTT Stetho Batch to application + seat-block PAN collection", () => {
    expect(migration).toContain("WHERE code = 'DAOTT-SEAT'");
    expect(migration).toContain("SET amount = 4000");
    expect(migration).toContain("WHERE code = 'DAOTT-TUITION'");
    expect(migration).toContain("SET amount = 26000");
    expect(migration).toContain("'{year_1,fee}'");
    expect(migration).toContain("to_jsonb(40000)");
    expect(migration).toContain("'{total_fee}'");
    expect(migration).toContain("to_jsonb(185000)");
    expect(migration).toContain("Application fee Rs 1,000 + seat block Rs 4,000 unlocks PAN");
    expect(migration).toContain("c.code IN ('DAOTT-GN','OTT-GN')");
  });

  it("keeps PAN amount at 5000 but allows the 4000 seat-block payment", () => {
    expect(migration).toContain("CHECK (type <> 'token_fee' OR amount > 0)");
    expect(migration).toContain("CHECK (token_fee_amount IS NULL OR token_fee_amount >= 5000)");
    expect(migration).toContain("'token_required_amount', 5000");
    expect(migration).toContain("'an_threshold_amount', 15000");
    expect(migration).toContain("'min_token_instalment', 4000");
  });

  it("uses the DAOTT policy PAN amount for offer defaults and PDF fallback", () => {
    expect(migration).toContain("v_min_instalment    numeric := COALESCE((v_policy->>'min_token_instalment')::numeric, 5000)");
    expect(migration).toContain("(v_policy->>'token_required_amount')::numeric");
    expect(migration).toContain("(v_policy->>'an_threshold_amount')::numeric");
    // School-term offers keep the flat ₹5,000 floor; every other lead falls
    // back to the DAOTT policy amount.
    expect(offerDialog).toContain("const tokenFloor = usesSchoolTerms ? 5000 : (policyTokenRequiredAmount || 5000);");
    expect(offerDialog).toContain("const policyTokenRequiredAmount = Number(feePolicy?.token_required_amount || 0);");
    expect(offerDialog).toContain("const nextTokenFloor = feeSnapshot.tokenRequiredAmount || 5000;");
    expect(offerGenerator).toContain("const tokenFloor = policyTokenAmount || 5000;");
    expect(offerGenerator).toContain("const policyTokenAmount = Number(policy?.token_required_amount || 0);");
    expect(offlineDialog).not.toContain("const tokenFloor = 5000;");
  });

  it("credits application fee against the Sem 1 seat-block fee", () => {
    expect(migration).toContain("'seat_block_application_credit'");
    expect(migration).toContain("v_paid_toward_course := v_paid_toward_course + v_seat_block_application_credit;");
    expect(applicantPanel).toContain("Application fee counted toward PAN amount");
    expect(applicantPanel).toContain("Seat block balance payable");
    expect(leadFeeLedger).toContain("SEAT|BLOCK");
    expect(provisionStudentFees).toContain(".eq(\"type\", \"application_fee\")");
    expect(provisionStudentFees).toContain("remainingApplicationCredit");
  });

  it("shows DAOTT seat-block fee heads and application-fee adjustment in the offer letter PDF", () => {
    expect(offerGenerator).toContain("fee_codes:fee_code_id");
    expect(offerGenerator).toContain("applicationFeePaid");
    expect(offerGenerator).toContain("DAOTT-SEAT");
    expect(offerGenerator).toContain("Seat Block");
    expect(offerGenerator).toContain("Waiver/Adjustment");
    expect(offerGenerator).toContain("applicationAdjustment");
    // The period wording now comes from the fee structure's own metadata
    // (D.AOTT's stetho_batch declares period_label "Semester" / labels "Sem N")
    // rather than a hardcoded isDaott flag, so the same row reads "Sem 1 - Seat
    // Block" without the course code being special-cased here.
    expect(offerGenerator).toContain("label: `${labelForOfferTerm(it.term, opts.feeStructureMeta)} - ${daottFeeHeadLabel(it)}`");
  });

  it("unlocks DAOTT loan letters with course-applied paid amount", () => {
    expect(applicantPanel).toContain("const loanLetterUnlockAmount = LOAN_LETTER_UNLOCK_TOKEN_FEE;");
    expect(loanGenerator).toContain("const loanLetterUnlockAmount = LOAN_LETTER_UNLOCK_TOKEN_FEE;");
    expect(loanGenerator).toContain("if (paidTowardCourse < loanLetterUnlockAmount)");
  });
});

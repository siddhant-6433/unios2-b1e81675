import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260627125000_restore_daott_stetho_fee_card.sql",
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
  it("restores DAOTT/DOTT Stetho Batch to the fee card", () => {
    expect(migration).toContain("WHERE code = 'DAOTT-SEAT'");
    expect(migration).toContain("SET amount = 5000");
    expect(migration).toContain("'{year_1,fee}'");
    expect(migration).toContain("to_jsonb(40000)");
    expect(migration).toContain("'{total_fee}'");
    expect(migration).toContain("to_jsonb(185000)");
    expect(migration).toContain("Seat block Rs 5,000 + tuition Rs 25,000");
    expect(migration).toContain("c.code IN ('DAOTT-GN','OTT-GN')");
  });

  it("keeps offer token at 5000 but allows a smaller positive final token payment", () => {
    expect(migration).toContain("CHECK (type <> 'token_fee' OR amount > 0)");
    expect(migration).toContain("CHECK (token_fee_amount IS NULL OR token_fee_amount >= 5000)");
  });

  it("uses the standard 5000 token floor for DAOTT", () => {
    expect(migration).toContain("v_min_instalment := COALESCE((v_policy->>'min_token_instalment')::numeric, 5000)");
    expect(offerDialog).toContain("const tokenFloor = 5000;");
    expect(offerDialog).toContain("const nextTokenFloor = 5000;");
    expect(offerGenerator).toContain("const tokenFloor = 5000;");
    expect(offlineDialog).not.toContain("const tokenFloor = 5000;");
  });

  it("credits application fee against the Sem 1 seat-block fee", () => {
    expect(migration).toContain("'seat_block_application_credit'");
    expect(migration).toContain("v_paid_toward_course := v_paid_toward_course + v_seat_block_application_credit;");
    expect(applicantPanel).toContain("Application fee adjusted against Sem 1 seat block");
    expect(applicantPanel).toContain("Seat block net payable");
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
    expect(offerGenerator).toContain("label: `${labelForOfferTerm(it.term, true)} - ${daottFeeHeadLabel(it)}`");
  });

  it("unlocks DAOTT loan letters with course-applied paid amount", () => {
    expect(applicantPanel).toContain("const loanLetterUnlockAmount = LOAN_LETTER_UNLOCK_TOKEN_FEE;");
    expect(loanGenerator).toContain("const loanLetterUnlockAmount = LOAN_LETTER_UNLOCK_TOKEN_FEE;");
    expect(loanGenerator).toContain("if (paidTowardCourse < loanLetterUnlockAmount)");
  });
});

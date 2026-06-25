import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260625101000_daott_seat_block_fee_4000.sql",
  "utf8",
);
const lifecycleMigration = readFileSync(
  "supabase/migrations/20260625100000_count_course_payments_for_token_lifecycle.sql",
  "utf8",
);
const offerDialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");
const offerGenerator = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");
const loanGenerator = readFileSync("supabase/functions/generate-loan-letter/index.ts", "utf8");
const offlineDialog = readFileSync("src/components/finance/OfflinePaymentDialog.tsx", "utf8");
const applicantPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");

describe("DAOTT seat-block fee", () => {
  it("updates DAOTT/DOTT Stetho Batch seat block from 5000 to 4000", () => {
    expect(migration).toContain("WHERE code = 'DAOTT-SEAT'");
    expect(migration).toContain("SET amount = 4000");
    expect(migration).toContain("'{year_1,fee}'");
    expect(migration).toContain("to_jsonb(39000)");
    expect(migration).toContain("'{total_fee}'");
    expect(migration).toContain("to_jsonb(184000)");
    expect(migration).toContain("Seat block Rs 4,000 + tuition Rs 25,000");
    expect(migration).toContain("c.code IN ('DAOTT-GN','OTT-GN')");
  });

  it("allows 4000 token rows and offer token amounts at the database floor", () => {
    expect(migration).toContain("CHECK (type <> 'token_fee' OR amount >= 4000)");
    expect(migration).toContain("CHECK (token_fee_amount IS NULL OR token_fee_amount >= 4000)");
  });

  it("uses 4000 as the DAOTT token floor without changing the normal 5000 default", () => {
    expect(lifecycleMigration).toContain("c.code IN ('DAOTT-GN','OTT-GN') THEN 4000");
    expect(lifecycleMigration).toContain("COALESCE(v_min_instalment, (v_policy->>'min_token_instalment')::numeric, 5000)");
    expect(offerDialog).toContain("const tokenFloor = isDaottCourseName(courseName) ? 4000 : 5000;");
    expect(offerGenerator).toContain("const tokenFloor = isDaottCourse(course) ? 4000 : 5000;");
    expect(offlineDialog).toContain("setTokenFloor(isDaott ? 4000 : 5000)");
  });

  it("unlocks DAOTT loan letters at 4000 and uses course-eligible paid amount", () => {
    expect(applicantPanel).toContain("const loanLetterUnlockAmount = isDaottCourseName(courseName) ? 4000 : LOAN_LETTER_UNLOCK_TOKEN_FEE;");
    expect(loanGenerator).toContain("const loanLetterUnlockAmount = isDaottCourse((offer as any).courses) ? 4000 : LOAN_LETTER_UNLOCK_TOKEN_FEE;");
    expect(loanGenerator).toContain("if (paidTowardCourse < loanLetterUnlockAmount)");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260625131500_offer_edit_token_fee_and_update_grant.sql", "utf8");

describe("offer edit request token fee approvals", () => {
  it("lets super admins approve/reject offer edit requests from the browser", () => {
    expect(migration).toContain("GRANT UPDATE ON public.offer_letter_edit_requests TO authenticated");
  });

  it("applies approved token-fee changes to the canonical offer row", () => {
    expect(migration).toContain("token_fee_amount = CASE");
    expect(migration).toContain("NEW.proposed_changes ? 'token_fee_amount'");
    expect(migration).toContain("token_fee_user_edited = CASE");
  });

  it("captures token fee as a structured edit request instead of only reason text", () => {
    expect(dialog).toContain("value={editForm.token_fee_amount}");
    expect(dialog).toContain("proposedChanges.token_fee_amount = tokenFeeAmount");
    expect(dialog).toContain("Token Fee Payable");
    expect(dialog).toContain("parseTokenFeeFromEditReason");
  });
});

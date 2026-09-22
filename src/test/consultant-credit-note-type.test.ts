import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260922092931_consultant_credit_note_type.sql",
  "utf8",
);

describe("consultant credit note type", () => {
  it("reclassifies consultant credit notes filed as application_fee", () => {
    expect(migration).toContain("Consultant credit note");
    expect(migration).toContain("SET type = 'other'");
  });

  it("leaves the ledger allocation untouched", () => {
    // The fix is a receipt-type correction only; paid_amount / links must not
    // be rewritten.
    expect(migration).not.toContain("UPDATE public.fee_ledger ");
    expect(migration).not.toContain("INSERT INTO public.fee_ledger_payments");
    expect(migration).not.toContain("DELETE FROM public.fee_ledger_payments");
  });
});

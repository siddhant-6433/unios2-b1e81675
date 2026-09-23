import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260922090325_appfee_link_repair.sql",
  "utf8",
);

describe("application-fee link repair", () => {
  it("moves the receipt link before lowering the source paid_amount", () => {
    // trg_trim_fee_ledger_payment_links_on_unpay deletes links off a head whose
    // paid_amount just dropped. If the link is still on the source when we
    // decrement, it is deleted and the move loses the receipt association.
    const linkIdx = migration.indexOf("UPDATE public.fee_ledger_payments SET fee_ledger_id = v_app_row.id");
    const dropIdx = migration.indexOf("SET paid_amount = GREATEST(paid_amount - v_move, 0)");
    expect(linkIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeLessThan(dropIdx);
  });

  it("relinks heads that have paid_amount but no links", () => {
    expect(migration).toContain("INSERT INTO public.fee_ledger_payments");
    expect(migration).toContain("AS gap");
    expect(migration).toContain("relinked");
  });
});

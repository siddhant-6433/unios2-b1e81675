import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const edgeFn = readFileSync("supabase/functions/provision-student-fees/index.ts", "utf8");
const guard = readMigration("duplicate_payment_application_guard");
const settlementBoundary = readMigration("atomic_fee_settlement_boundary");

describe("edge provisioner delegates payment allocation", () => {
  it("does not pre-credit token payments outside the SQL transaction", () => {
    // SQL's confirmed-payment trigger owns allocation while holding the
    // per-student lock, so provisioning only creates zero-paid ledger rows.
    expect(edgeFn).not.toContain("creditLinks");
    expect(edgeFn).not.toContain('.from("fee_ledger_payments").insert(');
    expect(edgeFn).not.toMatch(/\.eq\("type", "token_fee"\)/);
    expect(edgeFn).toContain('.from("fee_ledger").insert(insertRows)');
  });

  it("keeps waiver sync idempotent when the ledger already exists", () => {
    expect(edgeFn).toContain("async function syncLedgerConcessions");
    expect(edgeFn).toContain("if (newRows.length === 0)");
    expect(edgeFn).toContain("await syncLedgerConcessions(db, studentId)");
    expect(edgeFn).not.toMatch(/if \(newRows\.length === 0\) return 0;/);
  });

  it("uses an atomic SQL settlement boundary for gateway receipts", () => {
    expect(settlementBoundary).toContain("FUNCTION public.create_and_apply_fee_payment");
    expect(settlementBoundary).toContain("FUNCTION public.apply_fee_payment_allocations");
    expect(settlementBoundary).toContain("pg_advisory_xact_lock");
    expect(settlementBoundary).toContain("FOR UPDATE");
    expect(settlementBoundary).toContain("INSERT INTO public.fee_ledger_payments");
    expect(settlementBoundary).toContain("GRANT EXECUTE ON FUNCTION public.create_and_apply_fee_payment");
  });
});

describe("duplicate application guard", () => {
  it("refuses to apply more of a payment than it is worth", () => {
    expect(guard).toContain("tg_guard_payment_over_application");
    expect(guard).toContain("v_applied + NEW.amount > v_payment + 0.009");
    expect(guard).toContain("cannot be spent twice");
    expect(guard).toContain("BEFORE INSERT OR UPDATE OF amount ON public.fee_ledger_payments");
  });

  it("surfaces the two shapes the trigger cannot prevent", () => {
    // Credit with no payment behind it, and one real transaction booked twice.
    expect(guard).toContain("v_unaccounted_ledger_credit");
    expect(guard).toContain("v_duplicate_payments");
    expect(guard).toContain("same_transaction_ref");
    expect(guard).toContain("suspected_same_day_amount");
    expect(guard).not.toMatch(/GRANT SELECT ON public\.v_\w+ TO anon/);
  });

  it("repairs only rows that still match the diagnosis", () => {
    // Financial repair: assert-then-write, never blind overwrite.
    expect(guard).toContain("f27f14f4-fb2c-4014-8d75-0f271f319c94");
    expect(guard).toContain("b5d71162-e74f-4b2a-9ce3-8ca7bb6a441f");
    expect(guard).toContain("7b0e3295-c03e-4d9d-b09e-62e96920f525");
    expect(guard).toContain("changed since diagnosis");
    expect(guard).toContain("SET paid_amount = r.linked");
  });
});

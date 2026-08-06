import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const edgeFn = readFileSync("supabase/functions/provision-student-fees/index.ts", "utf8");
const guard = readFileSync(
  "supabase/migrations/20260806050226_duplicate_payment_application_guard.sql",
  "utf8",
);

describe("edge provisioner writes payment links", () => {
  it("attributes each credit to the payment that funded it", () => {
    // The double-credit that inflated two ledgers was invisible because this
    // path wrote paid_amount with no fee_ledger_payments row behind it.
    expect(edgeFn).toContain("creditLinks");
    expect(edgeFn).toContain("const drawFrom = (");
    expect(edgeFn).toContain('.from("fee_ledger_payments").insert(');
    // Payment ids are needed for attribution, so both queues select id.
    expect(edgeFn).toMatch(/\.select\("id, amount"\)[\s\S]{0,200}"application_fee"/);
    expect(edgeFn).toMatch(/\.select\("id, amount"\)[\s\S]{0,200}"token_fee"/);
  });

  it("drains credit already applied on an earlier run before attributing", () => {
    // Otherwise a partial re-provision would re-attribute the head of the queue
    // and double-count the same token payment in the links.
    expect(edgeFn).toContain("let toDrain = Math.min(alreadyCredited, totalToken);");
  });

  it("never fails provisioning because the link insert failed", () => {
    expect(edgeFn).toContain("link insert failed");
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

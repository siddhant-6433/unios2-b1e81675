import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const transferSql = readMigration("transfer_fee_allocation_moves_payment_links");
const dialog = readFileSync("src/components/finance/TransferFeeDialog.tsx", "utf8");
const applyCredit = readFileSync("src/components/finance/ApplyCreditDialog.tsx", "utf8");

describe("transfer_fee_allocation moves payment links", () => {
  it("relocates fee_ledger_payments off the source head", () => {
    // The Uniform false-paid bug: paid_amount moved but the link row that the
    // Paid breakup reads stayed on Uniform, so it still showed Paid ₹6,000
    // against "No receipt no." and could not be collected again.
    expect(transferSql).toContain("_move_fee_ledger_payment_links");
    expect(transferSql).toContain("SET fee_ledger_id = _to_id");
    expect(transferSql).toContain("DELETE FROM public.fee_ledger_payments WHERE id = v_link.id");
  });

  it("rewrites the payment's allocations so provision cannot put the rupees back", () => {
    expect(transferSql).toContain("_rewrite_payment_allocations_from_links");
    expect(transferSql).toContain("SET allocations = v_alloc");
    expect(transferSql).toContain("applied_to_ledger = (v_linked >= amount - 0.009)");
  });

  it("keeps refunded link remainders so refund items stay valid", () => {
    expect(transferSql).toContain("already on a refund against it");
    expect(transferSql).toContain("fee_refund_items");
  });

  it("does not expose the link movers to the browser role", () => {
    expect(transferSql).toContain(
      "REVOKE ALL ON FUNCTION public._move_fee_ledger_payment_links(uuid, uuid, numeric)",
    );
    expect(transferSql).toContain(
      "REVOKE ALL ON FUNCTION public._rewrite_payment_allocations_from_links(uuid[])",
    );
  });

  it("still grants the public transfer RPC to authenticated cashiers", () => {
    expect(transferSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.transfer_fee_allocation(uuid, uuid, numeric, text) TO authenticated, service_role",
    );
  });

  it("trims leftover payment links when paid_amount falls", () => {
    // Belt and suspenders: even if some other writer drops paid_amount without
    // moving links, the Paid breakup cannot keep showing a ghost payment.
    expect(transferSql).toContain("tg_trim_fee_ledger_payment_links_on_unpay");
    expect(transferSql).toContain("AFTER UPDATE OF paid_amount ON public.fee_ledger");
    expect(transferSql).toContain("v_excess := v_linked - COALESCE(NEW.paid_amount, 0) - v_refunded");
  });

  it("does not auto-apply credit back onto Uniform", () => {
    expect(transferSql).toContain("UPPER(fc.code) IS DISTINCT FROM 'UNIFORM'");
    expect(transferSql).toContain("fl.term NOT ILIKE 'uniform%'");
  });

  it("clears Pawan Yadav's false-paid Uniform head", () => {
    expect(transferSql).toContain("AN-283F4F18");
    expect(transferSql).toContain("Repair: Uniform left false-paid after transfer");
    expect(transferSql).toContain("apply_student_credit");
  });
});

describe("TransferFeeDialog destinations", () => {
  it("only offers heads that still have a due balance", () => {
    // A fully-paid dest overflows to credit; Apply Credit (auto) then lands
    // back on Uniform as the next-earliest unpaid head.
    expect(dialog).toContain("f.id !== fromId && Number(f.balance || 0) > 0");
    expect(dialog).toContain("→ Credit (unallocate)");
  });

  it("still calls transfer_fee_allocation with a required reason", () => {
    expect(dialog).toContain('"transfer_fee_allocation"');
    expect(dialog).toContain("_reason: reason.trim()");
  });

  it("warns when the amount will not fit on the destination", () => {
    expect(dialog).toContain("go to unallocated credit");
  });
});

describe("ApplyCreditDialog auto destination", () => {
  it("tells cashiers that auto skips Uniform", () => {
    expect(applyCredit).toContain("Auto (earliest due, skips Uniform)");
  });
});

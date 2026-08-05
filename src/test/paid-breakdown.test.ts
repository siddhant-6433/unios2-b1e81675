import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const popover = readFileSync("src/components/finance/PaidBreakdownPopover.tsx", "utf8");
const panel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");

describe("paid breakup popover", () => {
  it("reads the payment links for the row, with receipt no, date and PDF", () => {
    expect(popover).toContain('.from("fee_ledger_payments")');
    expect(popover).toContain(".eq(\"fee_ledger_id\", feeLedgerId)");
    // Receipt fields come off lead_payments via the link row.
    for (const field of ["payment_date", "receipt_no", "receipt_url", "payment_mode"]) {
      expect(popover).toContain(field);
    }
  });

  it("declares the gap when the links do not account for paid_amount", () => {
    // fee_ledger.paid_amount is authoritative; link rows can be missing because
    // the edge-function provisioning path credits the ledger without one. The
    // popover must not present a short breakup as if it were complete.
    expect(popover).toContain("const unlinked = Math.round((paidAmount - linked) * 100) / 100;");
    expect(popover).toContain("has no payment record linked to it");
  });

  it("is wired into the shared fee table, so Collect and the profile both get it", () => {
    // CashierConsole renders StudentFeePanel, so one wiring covers both.
    expect(panel).toContain("PaidBreakdownPopover");
    expect(panel).toContain("feeLedgerId={f.id}");
    expect(panel).toContain("paidAmount={Number(f.paid_amount)}");
    // Only on rows that actually have money against them.
    expect(panel).toMatch(/Number\(f\.paid_amount\) > 0 && \(\s*<PaidBreakdownPopover/);
  });
});

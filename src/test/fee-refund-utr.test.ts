import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const refundsPage = readFileSync("src/pages/Refunds.tsx", "utf8");
const webhook = readFileSync("supabase/functions/zoho-books-webhook/index.ts", "utf8");
const zohoSync = readFileSync("supabase/functions/zoho-refund-sync/index.ts", "utf8");

describe("paid refunds show a shareable UTR", () => {
  it("renders the UTR on paid rows even when payment_mode is missing", () => {
    expect(refundsPage).toContain("function refundUtrShareText");
    expect(refundsPage).toContain("UTR {utr}");
    expect(refundsPage).toContain("Copy UTR");
    expect(refundsPage).not.toContain(
      "r.payment_mode && <div>{MODE_LABEL[r.payment_mode] || r.payment_mode}{r.payment_reference ? ` · ${r.payment_reference}` : \"\"}</div>",
    );
  });

  it("copies a candidate-ready proof line with amount, date, and UTR", () => {
    expect(refundsPage).toContain("Refund of ${amount} has been processed");
    expect(refundsPage).toContain("UTR: ${r.payment_reference}");
    expect(refundsPage).toContain("Share this with the candidate as proof the refund was processed.");
  });

  it("prompts staff to add details when a paid refund has no UTR", () => {
    expect(refundsPage).toContain("No UTR — add details to share with the candidate");
  });

  it("stores Zoho's bank reference on the refund, not only zoho_payment_id", () => {
    const refundBranch = webhook.slice(webhook.indexOf("Student fee refunds share"));
    expect(refundBranch).toContain("payment_reference");
    expect(refundBranch).toContain("toBackfill");
    expect(webhook).toContain("function bankTxnRef");
    expect(webhook).toContain("skip Zoho bill reference_number");
  });

  it("pushes UniOs UTR to Zoho and pulls one back on resync / record payment", () => {
    expect(zohoSync).toContain("reference_number: refund.payment_reference || undefined");
    expect(zohoSync).toContain("/vendorpayments/${refund.zoho_payment_id}");
    expect(zohoSync).toContain("if (ref && !refund.payment_reference) patch.payment_reference = ref");
  });
});

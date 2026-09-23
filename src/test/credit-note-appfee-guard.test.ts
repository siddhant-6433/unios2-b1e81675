import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync("src/components/finance/OfflinePaymentDialog.tsx", "utf8");

describe("consultant credit note application-fee guard", () => {
  it("withholds application_fee from the credit-note type options", () => {
    // A consultant credit note is a non-cash settlement, never an
    // application-fee payment. Filing one as application_fee mislabels the
    // receipt and inflates the student's "Application fee paid".
    expect(dialog).toContain('PAY_TYPES.filter(p => p.value !== "application_fee")');
    expect(dialog).toContain("feeTypeOptions");
    expect(dialog).toContain("options={feeTypeOptions.map");
  });

  it("normalises a defaulted application_fee type in credit-note mode", () => {
    // For a lead the dialog defaults type to 'application_fee'; opening the
    // credit-note mode must not leave it selected.
    expect(dialog).toContain('if (isCreditNote && type === "application_fee") setType("other");');
  });

  it("blocks submitting a credit note as an application fee", () => {
    expect(dialog).toContain("A consultant credit note cannot be filed as an Application Fee.");
  });
});

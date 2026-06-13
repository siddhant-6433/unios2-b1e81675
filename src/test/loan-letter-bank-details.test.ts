import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loanLetterFunction = readFileSync("supabase/functions/generate-loan-letter/index.ts", "utf8");
const tokenFeePanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");

describe("education loan letter template", () => {
  it("prints formal bank-letter metadata and remittance details", () => {
    expect(loanLetterFunction).toContain("Letter Date:");
    expect(loanLetterFunction).toContain("Reference No.:");
    expect(loanLetterFunction).toContain("NIMT/EL/");
    expect(loanLetterFunction).toContain("Loan Reference Letter No.");

    expect(loanLetterFunction).toContain("INSTITUTION BANK ACCOUNT DETAILS");
    expect(loanLetterFunction).toContain("bankDetails");
    expect(loanLetterFunction).toContain("NIMT B. SCHOOL'S FOUNDATION");
    expect(loanLetterFunction).toContain("IDFC BANK");
    expect(loanLetterFunction).toContain("10118454426");
    expect(loanLetterFunction).toContain("IDFB0020154");
    expect(loanLetterFunction).toContain("Alpha 1, Greater Noida");
    expect(loanLetterFunction).toContain("on behalf of");
    expect(loanLetterFunction).not.toContain("Offer Reference");
  });

  it("guards the added remittance section with page breaks", () => {
    expect(loanLetterFunction).toContain("function ensureSpace");
    expect(loanLetterFunction).toContain("function newPage");
    expect(loanLetterFunction).toContain("const footerNoteY");
    expect(loanLetterFunction).toContain("Date.now()");
  });

  it("regenerates the latest loan letter instead of linking stale PDFs", () => {
    expect(tokenFeePanel).toContain("View Latest");
    expect(tokenFeePanel).toContain("onClick={generateLoanLetter}");
    expect(tokenFeePanel).not.toContain("href={offer.loan_letter_url}");
  });
});

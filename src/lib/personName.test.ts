import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatPersonName,
  formatPersonNameOrNull,
  isPersonNameField,
} from "./personName";

describe("formatPersonName", () => {
  it("sentence-cases lowercase names, including honorifics", () => {
    expect(formatPersonName("mr. salim ahmad")).toBe("Mr. Salim Ahmad");
    expect(formatPersonName("mrs. nasrina khatoon")).toBe("Mrs. Nasrina Khatoon");
    expect(formatPersonName("ayra")).toBe("Ayra");
  });

  it("sentence-cases ALL CAPS names", () => {
    expect(formatPersonName("AYRA")).toBe("Ayra");
    expect(formatPersonName("MR. SALIM AHMAD")).toBe("Mr. Salim Ahmad");
  });

  it("is idempotent on already-formatted names", () => {
    expect(formatPersonName("Mr. Salim Ahmad")).toBe("Mr. Salim Ahmad");
    expect(formatPersonName("Ayra")).toBe("Ayra");
  });

  it("keeps hyphens and apostrophes as word breaks", () => {
    expect(formatPersonName("mary-jane")).toBe("Mary-Jane");
    expect(formatPersonName("d'souza")).toBe("D'Souza");
  });

  it("collapses extra whitespace and trims", () => {
    expect(formatPersonName("  mr.   salim   ahmad  ")).toBe("Mr. Salim Ahmad");
  });

  it("returns empty for blank input", () => {
    expect(formatPersonName(null)).toBe("");
    expect(formatPersonName(undefined)).toBe("");
    expect(formatPersonName("   ")).toBe("");
    expect(formatPersonNameOrNull("   ")).toBeNull();
    expect(formatPersonNameOrNull("ayra")).toBe("Ayra");
  });

  it("leaves a dash placeholder alone", () => {
    expect(formatPersonName("—")).toBe("—");
    expect(formatPersonName("-")).toBe("-");
  });

  it("recognises person-name fields", () => {
    expect(isPersonNameField("father_name")).toBe(true);
    expect(isPersonNameField("father_phone")).toBe(false);
  });
});

describe("the Deno copy cannot drift from src/lib", () => {
  const CASES = [
    "mr. salim ahmad",
    "MRS. NASRINA KHATOON",
    "AYRA",
    "Ayra",
    "mary-jane o'brien",
    "  spaced   name  ",
    "",
    "—",
  ];

  it("produces identical output", async () => {
    const deno = await import("../../supabase/functions/_shared/personName.ts");
    for (const value of CASES) {
      expect(deno.formatPersonName(value), value).toBe(formatPersonName(value));
    }
    expect(deno.formatPersonNameOrNull(null)).toBeNull();
  });
});

describe("receipts and documents format person names", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("payment receipts sentence-case the payer name", () => {
    const src = read("supabase/functions/generate-payment-receipt/index.ts");
    expect(src).toContain("formatPersonName");
    expect(src).toContain('from "../_shared/personName.ts"');
  });

  it("application-fee receipts sentence-case the applicant name", () => {
    const src = read("supabase/functions/generate-application-fee-receipt/index.ts");
    expect(src).toContain("formatPersonName");
  });

  it("transfer certificates sentence-case pupil and parent names", () => {
    const src = read("supabase/functions/generate-transfer-certificate/index.ts");
    expect(src).toContain("formatPersonName");
  });
});

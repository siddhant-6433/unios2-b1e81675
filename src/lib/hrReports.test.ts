import { describe, it, expect } from "vitest";
import { toCsv, defaultMonthRange, pct } from "./hrReports";

describe("toCsv", () => {
  it("returns an empty string when there are no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("takes the header row from the first object's keys", () => {
    expect(toCsv([{ a: 1, b: "x" }])).toBe("a,b\r\n1,x");
  });

  it("quotes fields containing commas, quotes or newlines and doubles quotes", () => {
    const csv = toCsv([{ name: "Doe, Jane", note: 'He said "hi"', body: "a\nb" }]);
    expect(csv).toBe('name,note,body\r\n"Doe, Jane","He said ""hi""","a\nb"');
  });

  it("renders null and undefined as empty fields, keeps 0", () => {
    expect(toCsv([{ a: null, b: undefined, c: 0 }])).toBe("a,b,c\r\n,,0");
  });

  it("keeps columns aligned to the header even when a later row has extra keys", () => {
    expect(toCsv([{ a: 1 }, { a: 2, b: 3 }])).toBe("a\r\n1\r\n2");
  });

  it("joins multiple rows with CRLF", () => {
    expect(toCsv([{ a: "1" }, { a: "2" }])).toBe("a\r\n1\r\n2");
  });
});

describe("defaultMonthRange", () => {
  it("spans the full calendar month of the given date", () => {
    expect(defaultMonthRange(new Date(2026, 8, 23))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("handles a leap February", () => {
    expect(defaultMonthRange(new Date(2024, 1, 10))).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("handles a 31-day month and January", () => {
    expect(defaultMonthRange(new Date(2026, 0, 1))).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
});

describe("pct", () => {
  it("returns the percentage of the whole, one decimal place", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 4)).toBe(50);
  });

  it("returns 0 when the whole is 0 or a value is non-finite", () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(5, Number.NaN)).toBe(0);
  });
});

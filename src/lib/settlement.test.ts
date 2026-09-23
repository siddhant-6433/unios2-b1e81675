import { describe, it, expect } from "vitest";
import {
  SETTLEMENT_STATUSES,
  SETTLEMENT_LINE_KINDS,
  settlementStatusBadge,
  settlementStatusLabel,
  lineKindLabel,
  earningsOf,
  deductionsOf,
  settlementNet,
  settlementFileName,
  settlementDayLabel,
  buildSettlementPdf,
  formatInr,
  type SettlementLine,
  type SettlementRow,
} from "./settlement";

const line = (
  over: Partial<SettlementLine> = {},
): SettlementLine => ({
  id: "line-1",
  settlement_id: "set-1",
  code: "SALARY_FINAL",
  name: "Salary to last working day",
  kind: "earning",
  amount: 1000,
  detail: null,
  display_order: 10,
  ...over,
});

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  id: "set-1",
  employee_profile_id: "emp-1",
  exit_id: "exit-1",
  status: "draft",
  last_working_day: "2026-09-30",
  gross_earnings: 0,
  total_deductions: 0,
  net_settlement: 0,
  computed_at: "2026-09-23T10:00:00Z",
  finalized_at: null,
  paid_at: null,
  note: null,
  employee_name: "Asha Rao",
  employee_number: "EMP-001",
  job_title: "Teacher",
  exit_type: "resignation",
  ...over,
});

describe("SETTLEMENT_STATUSES", () => {
  it("covers the full lifecycle the DB CHECK allows", () => {
    expect([...SETTLEMENT_STATUSES].sort()).toEqual(
      ["cancelled", "draft", "finalized", "paid"],
    );
  });
});

describe("SETTLEMENT_LINE_KINDS", () => {
  it("lists the two line kinds the DB allows", () => {
    expect([...SETTLEMENT_LINE_KINDS].sort()).toEqual(["deduction", "earning"]);
  });
});

describe("settlementStatusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(settlementStatusBadge("draft")).toContain("bg-pastel-yellow");
    expect(settlementStatusBadge("finalized")).toContain("bg-pastel-blue");
    expect(settlementStatusBadge("paid")).toContain("bg-pastel-green");
    expect(settlementStatusBadge("cancelled")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(settlementStatusBadge("mystery")).toContain("bg-muted");
  });
});

describe("settlementStatusLabel", () => {
  it("capitalises the status for display", () => {
    expect(settlementStatusLabel("finalized")).toBe("Finalized");
    expect(settlementStatusLabel("paid")).toBe("Paid");
    expect(settlementStatusLabel("")).toBe("");
  });
});

describe("lineKindLabel", () => {
  it("labels the two money columns", () => {
    expect(lineKindLabel("earning")).toBe("Earning");
    expect(lineKindLabel("deduction")).toBe("Deduction");
  });

  it("returns an empty label for an unknown kind", () => {
    expect(lineKindLabel("bonus")).toBe("");
  });
});

describe("earningsOf / deductionsOf", () => {
  const lines: SettlementLine[] = [
    line({ id: "a", kind: "earning", amount: 30000 }),
    line({ id: "b", kind: "earning", amount: 12000, code: "LEAVE_ENCASH" }),
    line({ id: "c", kind: "deduction", amount: 2500, code: "NOTICE_RECOVERY" }),
    line({ id: "d", kind: "deduction", amount: 500, code: "ADVANCE_RECOVERY" }),
  ];

  it("sums only the requested kind", () => {
    expect(earningsOf(lines)).toBe(42000);
    expect(deductionsOf(lines)).toBe(3000);
  });

  it("returns 0 for an empty or missing list", () => {
    expect(earningsOf([])).toBe(0);
    expect(deductionsOf(null)).toBe(0);
    expect(earningsOf(undefined)).toBe(0);
  });

  it("coerces numeric-as-string amounts from Postgres", () => {
    expect(earningsOf([line({ amount: "1500.50" })])).toBe(1500.5);
  });

  it("ignores NaN amounts rather than poisoning the total", () => {
    expect(earningsOf([line({ amount: Number.NaN })])).toBe(0);
  });
});

describe("settlementNet", () => {
  it("prefers the stored net snapshot", () => {
    expect(settlementNet(row({ gross_earnings: 42000, total_deductions: 3000, net_settlement: 39000 }))).toBe(39000);
  });

  it("falls back to gross − deductions when the net is missing", () => {
    expect(settlementNet(row({ gross_earnings: 42000, total_deductions: 3000, net_settlement: null }))).toBe(39000);
  });

  it("clamps the fallback at zero, mirroring GREATEST(..., 0)", () => {
    expect(settlementNet(row({ gross_earnings: 1000, total_deductions: 2500, net_settlement: null }))).toBe(0);
  });

  it("coerces string totals and treats null input as zero", () => {
    expect(settlementNet(row({ gross_earnings: "5000.25", total_deductions: "100.25", net_settlement: null }))).toBe(4900);
    expect(settlementNet(null)).toBe(0);
  });
});

describe("formatInr", () => {
  it("groups in the Indian numbering system", () => {
    expect(formatInr(0)).toBe("0");
    expect(formatInr(1500)).toBe("1,500");
    expect(formatInr(1234567)).toBe("12,34,567");
  });

  it("keeps up to two decimals and tolerates string/numeric input", () => {
    expect(formatInr(1500.5)).toBe("1,500.5");
    expect(formatInr("1234.25")).toBe("1,234.25");
    expect(formatInr(null)).toBe("0");
  });
});

describe("settlementDayLabel", () => {
  it("shows a short readable date", () => {
    expect(settlementDayLabel("2026-03-31")).toBe("31 Mar 2026");
  });

  it("falls back to a dash for missing input", () => {
    expect(settlementDayLabel(null)).toBe("—");
    expect(settlementDayLabel("not-a-date")).toBe("—");
  });
});

describe("settlementFileName", () => {
  it("builds a filesystem-safe name from the employee and last working day", () => {
    expect(settlementFileName({ employee_name: "Asha Rao", employee_number: "EMP-001", last_working_day: "2026-09-30" })).toBe(
      "Settlement-Asha-Rao-2026-09-30.pdf",
    );
  });

  it("falls back when identity fields are missing", () => {
    expect(settlementFileName({ employee_name: null, employee_number: null, last_working_day: null })).toBe(
      "Settlement-Settlement-exit.pdf",
    );
  });
});

describe("buildSettlementPdf", () => {
  it("returns a jsPDF document with a save method", () => {
    const doc = buildSettlementPdf(row({ net_settlement: 39000 }), [
      line({ kind: "earning", amount: 42000 }),
      line({ id: "line-2", kind: "deduction", amount: 3000, code: "NOTICE_RECOVERY" }),
    ]);
    expect(typeof doc.save).toBe("function");
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(0);
  });
});

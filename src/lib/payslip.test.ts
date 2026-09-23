import { describe, it, expect } from "vitest";
import {
  netPayLabel,
  earningsOf,
  deductionsOf,
  employerContribOf,
  payslipPeriodLabel,
  payslipFileName,
  buildPayslipPdf,
  type PayslipComponent,
} from "./payslip";

const component = (
  kind: PayslipComponent["kind"],
  amount: number,
  name = "Component",
  order = 1,
): PayslipComponent => ({
  component_code: name.toUpperCase().replace(/\s+/g, "_"),
  component_name: name,
  kind,
  amount,
  display_order: order,
});

const SAMPLE: PayslipComponent[] = [
  component("earning", 30000, "Basic", 1),
  component("earning", 15000, "HRA", 2),
  component("deduction", 3600, "PF employee", 10),
  component("deduction", 200, "Professional tax", 11),
  component("employer_contribution", 3600, "PF employer", 20),
];

describe("netPayLabel", () => {
  it("formats whole rupees with the en-IN grouping and the rupee sign", () => {
    expect(netPayLabel(42500)).toBe("₹42,500");
    expect(netPayLabel(1234567)).toBe("₹12,34,567");
  });

  it("rounds to whole rupees and treats null/undefined as zero", () => {
    expect(netPayLabel(1000.4)).toBe("₹1,000");
    expect(netPayLabel(null)).toBe("₹0");
    expect(netPayLabel(undefined)).toBe("₹0");
  });
});

describe("component totals", () => {
  it("sums only the requested kind", () => {
    expect(earningsOf(SAMPLE)).toBe(45000);
    expect(deductionsOf(SAMPLE)).toBe(3800);
    expect(employerContribOf(SAMPLE)).toBe(3600);
  });

  it("returns 0 for an empty or missing list", () => {
    expect(earningsOf([])).toBe(0);
    expect(deductionsOf(null)).toBe(0);
    expect(employerContribOf(undefined)).toBe(0);
  });

  it("ignores NaN amounts rather than poisoning the total", () => {
    expect(deductionsOf([component("deduction", Number.NaN)])).toBe(0);
  });
});

describe("payslipPeriodLabel", () => {
  it("shows the month of period_start", () => {
    expect(payslipPeriodLabel({ id: "1", period_start: "2026-09-01" })).toBe("September 2026");
  });

  it("suppresses a cycle_name that is just the default month string", () => {
    expect(
      payslipPeriodLabel({ id: "1", period_start: "2026-09-01", cycle_name: "Sep 2026" }),
    ).toBe("September 2026");
  });

  it("appends a genuine run name", () => {
    expect(
      payslipPeriodLabel({ id: "1", period_start: "2026-09-01", cycle_name: "Teaching staff" }),
    ).toBe("September 2026 · Teaching staff");
  });

  it("falls back to the cycle name, then a dash", () => {
    expect(payslipPeriodLabel({ id: "1", cycle_name: "Arrears" })).toBe("Arrears");
    expect(payslipPeriodLabel({ id: "1" })).toBe("—");
  });
});

describe("payslipFileName", () => {
  it("builds a filesystem-safe name from the employee and period", () => {
    expect(payslipFileName({ id: "1", employee_name: "Asha Rao", period_start: "2026-09-01" })).toBe(
      "Payslip-Asha-Rao-2026-09.pdf",
    );
  });

  it("falls back when identity fields are missing", () => {
    expect(payslipFileName({ id: "1" })).toBe("Payslip-Payslip-period.pdf");
  });
});

describe("buildPayslipPdf", () => {
  it("returns a jsPDF document with a save method", () => {
    const doc = buildPayslipPdf({ components: SAMPLE }, { id: "1", employee_name: "Asha Rao", net_pay: 41200 });
    expect(typeof doc.save).toBe("function");
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(0);
  });
});

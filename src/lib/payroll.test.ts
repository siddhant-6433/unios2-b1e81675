import { describe, it, expect } from "vitest";
import {
  computePayroll, payableDays, employedDaysInPeriod, ratesFromConfig,
  type SalaryComponent, type StatutoryRates,
} from "./payroll";

const RATES: StatutoryRates = {
  pf_employee_rate: 12,
  pf_employer_rate: 12,
  pf_wage_ceiling: 15000,
  esi_employee_rate: 0.75,
  esi_employer_rate: 3.25,
  esi_wage_ceiling: 21000,
  pt_monthly: 200,
  lwf_employee: 0,
};

// A conventional structure: Basic 50% of gross, HRA 40% of Basic, fixed conveyance,
// special allowance absorbing the remainder.
const COMPONENTS: SalaryComponent[] = [
  { code: "BASIC",  name: "Basic",       kind: "earning",   calculation: "percent_of", basis_code: "GROSS", prorates: true,  display_order: 10,  value: 50 },
  { code: "HRA",    name: "HRA",         kind: "earning",   calculation: "percent_of", basis_code: "BASIC", prorates: true,  display_order: 20,  value: 40 },
  { code: "CONV",   name: "Conveyance",  kind: "earning",   calculation: "fixed",      basis_code: null,    prorates: true,  display_order: 30,  value: 1600 },
  { code: "SPL",    name: "Special",     kind: "earning",   calculation: "balance",    basis_code: null,    prorates: true,  display_order: 90,  value: 0 },
  { code: "PF_EE",  name: "PF",          kind: "deduction", calculation: "statutory",  basis_code: null,    prorates: false, display_order: 110, value: 0 },
  { code: "ESI_EE", name: "ESI",         kind: "deduction", calculation: "statutory",  basis_code: null,    prorates: false, display_order: 120, value: 0 },
  { code: "PT",     name: "Prof. Tax",   kind: "deduction", calculation: "statutory",  basis_code: null,    prorates: false, display_order: 130, value: 0 },
  { code: "PF_ER",  name: "PF employer", kind: "employer_contribution", calculation: "statutory", basis_code: null, prorates: false, display_order: 210, value: 0 },
];

const run = (over: Partial<Parameters<typeof computePayroll>[0]> = {}) =>
  computePayroll({
    monthlyGross: 20000, totalDays: 30, payableDays: 30,
    components: COMPONENTS, rates: RATES, ...over,
  });

describe("payableDays", () => {
  it("clamps to the period and never goes negative", () => {
    expect(payableDays(30, 30, 0)).toBe(30);
    expect(payableDays(30, 30, 3)).toBe(27);
    // A bad LOP entry must not produce negative pay.
    expect(payableDays(30, 30, 45)).toBe(0);
    // Employed days beyond the period are capped.
    expect(payableDays(30, 40, 0)).toBe(30);
    expect(payableDays(0, 0, 0)).toBe(0);
  });
});

describe("employedDaysInPeriod", () => {
  const start = "2026-04-01", end = "2026-04-30";

  it("counts the whole month for a continuously employed person", () => {
    expect(employedDaysInPeriod(start, end, "2020-01-01", null)).toBe(30);
  });

  it("pro-rates a mid-month joiner inclusively", () => {
    // Joins on the 16th → paid for the 16th through the 30th.
    expect(employedDaysInPeriod(start, end, "2026-04-16", null)).toBe(15);
  });

  it("pro-rates a mid-month leaver inclusively", () => {
    expect(employedDaysInPeriod(start, end, "2020-01-01", "2026-04-10")).toBe(10);
  });

  it("returns 0 when employment does not overlap the period", () => {
    expect(employedDaysInPeriod(start, end, "2026-05-01", null)).toBe(0);
    expect(employedDaysInPeriod(start, end, "2020-01-01", "2026-03-31")).toBe(0);
  });
});

describe("computePayroll — earnings", () => {
  it("splits gross across components and balances to exactly gross", () => {
    const r = run();
    const amt = (c: string) => r.components.find((x) => x.code === c)?.amount;
    expect(amt("BASIC")).toBe(10000);   // 50% of 20000
    expect(amt("HRA")).toBe(4000);      // 40% of Basic
    expect(amt("CONV")).toBe(1600);
    expect(amt("SPL")).toBe(4400);      // remainder
    expect(r.grossEarnings).toBe(20000);
  });

  it("never lets the balance component go negative when the structure over-allocates", () => {
    const r = computePayroll({
      monthlyGross: 1000, totalDays: 30, payableDays: 30,
      components: COMPONENTS, rates: RATES,
    });
    expect(r.components.find((c) => c.code === "SPL")?.amount).toBe(0);
    expect(r.grossEarnings).toBeGreaterThan(0);
  });

  it("pro-rates earnings by payable days", () => {
    const r = run({ payableDays: 15 });
    expect(r.components.find((c) => c.code === "BASIC")?.amount).toBe(5000);
    expect(r.grossEarnings).toBe(10000);
  });

  it("deducts loss of pay from payable days", () => {
    const r = run({ lopDays: 3 });
    expect(r.payableDays).toBe(27);
    expect(r.lopDays).toBe(3);
    expect(r.components.find((c) => c.code === "BASIC")?.amount).toBe(9000);
  });
});

describe("computePayroll — statutory", () => {
  it("charges PF on Basic at 12%", () => {
    const r = run();
    expect(r.components.find((c) => c.code === "PF_EE")?.amount).toBe(1200);
    expect(r.employerCost).toBe(1200); // employer PF
  });

  it("caps PF at the wage ceiling", () => {
    // Gross 60000 → Basic 30000, but PF wage is capped at 15000 → 1800.
    const r = run({ monthlyGross: 60000 });
    expect(r.components.find((c) => c.code === "PF_EE")?.amount).toBe(1800);
  });

  it("applies ESI at or below the ceiling and drops it above", () => {
    const at = run({ monthlyGross: 21000 });
    expect(at.components.find((c) => c.code === "ESI_EE")?.amount).toBe(158); // 0.75% of 21000

    const above = run({ monthlyGross: 21001 });
    expect(above.components.find((c) => c.code === "ESI_EE")).toBeUndefined();
  });

  it("keeps an ESI-eligible employee eligible during an unpaid month", () => {
    // The ceiling is tested against contracted gross, not the pro-rated figure —
    // otherwise heavy LOP would silently drop someone out of ESI.
    const r = run({ monthlyGross: 20000, payableDays: 5 });
    expect(r.components.find((c) => c.code === "ESI_EE")?.amount).toBeGreaterThan(0);
  });

  it("does not pro-rate statutory deductions", () => {
    const r = run({ payableDays: 15 });
    // PF follows the (pro-rated) Basic, but PT is a flat monthly charge.
    expect(r.components.find((c) => c.code === "PT")?.amount).toBe(200);
  });

  it("charges nothing when there are no earnings at all", () => {
    const r = run({ payableDays: 0 });
    expect(r.grossEarnings).toBe(0);
    expect(r.totalDeductions).toBe(0);
    expect(r.netPay).toBe(0);
  });
});

describe("computePayroll — net", () => {
  it("nets earnings less deductions", () => {
    const r = run();
    expect(r.netPay).toBe(r.grossEarnings - r.totalDeductions);
  });

  it("adds adhoc earnings and deductions", () => {
    const r = run({ adhocEarnings: 5000, adhocDeductions: 1000 });
    expect(r.components.find((c) => c.code === "ADHOC_EARN")?.amount).toBe(5000);
    expect(r.components.find((c) => c.code === "ADHOC_DED")?.amount).toBe(1000);
    expect(r.grossEarnings).toBe(25000);
  });

  it("floors net pay at zero rather than showing a negative payslip", () => {
    const r = run({ adhocDeductions: 999999 });
    expect(r.netPay).toBe(0);
  });

  it("keeps the printed lines consistent with the totals", () => {
    // Each component is rounded once; the totals must be the sum of what is printed,
    // not a separately-rounded figure.
    const r = run({ monthlyGross: 23333, payableDays: 17 });
    const sum = (k: string) => r.components.filter((c) => c.kind === k).reduce((a, c) => a + c.amount, 0);
    expect(sum("earning")).toBe(r.grossEarnings);
    expect(sum("deduction")).toBe(r.totalDeductions);
    expect(sum("employer_contribution")).toBe(r.employerCost);
  });
});

describe("ratesFromConfig", () => {
  it("reads config rows and falls back when a key is missing", () => {
    const rates = ratesFromConfig([
      { key: "pf_employee_rate", numeric_value: 10 },
      { key: "esi_wage_ceiling", numeric_value: 25000 },
    ]);
    expect(rates.pf_employee_rate).toBe(10);
    expect(rates.esi_wage_ceiling).toBe(25000);
    expect(rates.pt_monthly).toBe(200);
  });
});

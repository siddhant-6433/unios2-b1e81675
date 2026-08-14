// Payroll calculation.
//
// Pure functions on purpose: this is the money path, and it has to be verifiable
// against the payroll Excel without standing up a database. Nothing here reads or
// writes Supabase — callers hand in the salary, the component definitions and the
// statutory rates, and get back a fully itemised payslip.
//
// Two rules everything below obeys:
//   1. No rate, ceiling or rupee amount is hardcoded. They arrive in `StatutoryRates`,
//      which is loaded from payroll_statutory_config. Statute changes; code should not.
//   2. Rounding happens once, at each component, to whole rupees — the way an Indian
//      payslip is actually printed. Summing unrounded floats and rounding at the end
//      produces totals that disagree with the printed lines by a rupee or two, which
//      is exactly the kind of discrepancy that destroys trust in a new payroll system.

export type ComponentKind = "earning" | "deduction" | "employer_contribution";
export type Calculation = "fixed" | "percent_of" | "balance" | "statutory";

export interface SalaryComponent {
  code: string;
  name: string;
  kind: ComponentKind;
  calculation: Calculation;
  /** For `percent_of`: the code this percentage applies to ("GROSS", "BASIC", …). */
  basis_code?: string | null;
  /** Does this shrink with lost pay days? Statutory deductions generally do not. */
  prorates: boolean;
  display_order: number;
  /** Percentage or rupee amount, depending on `calculation`. From the structure. */
  value: number;
}

export interface StatutoryRates {
  pf_employee_rate: number;
  pf_employer_rate: number;
  pf_wage_ceiling: number;
  esi_employee_rate: number;
  esi_employer_rate: number;
  esi_wage_ceiling: number;
  pt_monthly: number;
  lwf_employee: number;
}

export interface PayrollInput {
  monthlyGross: number;
  totalDays: number;
  payableDays: number;
  lopDays?: number;
  components: SalaryComponent[];
  rates: StatutoryRates;
  adhocEarnings?: number;
  adhocDeductions?: number;
}

export interface ComputedComponent {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: number;
  display_order: number;
}

export interface PayrollResult {
  components: ComputedComponent[];
  grossEarnings: number;
  totalDeductions: number;
  employerCost: number;
  netPay: number;
  payableDays: number;
  lopDays: number;
}

/** Payslips are printed in whole rupees. */
const rupees = (n: number) => Math.round(n);

/**
 * Days actually paid for, given the days employed and any loss of pay.
 * Clamped to [0, totalDays] — a bad LOP entry must not produce negative pay.
 */
export function payableDays(totalDays: number, employedDays: number, lopDays = 0): number {
  if (totalDays <= 0) return 0;
  const employed = Math.min(Math.max(employedDays, 0), totalDays);
  return Math.min(Math.max(employed - Math.max(lopDays, 0), 0), totalDays);
}

/**
 * Compute one employee's payslip for one cycle.
 *
 * Order matters: fixed and percent components resolve first, `balance` mops up the
 * remainder of gross, then statutory deductions apply to the resulting figures.
 */
export function computePayroll(input: PayrollInput): PayrollResult {
  const {
    monthlyGross, totalDays, components, rates,
    adhocEarnings = 0, adhocDeductions = 0,
  } = input;

  const lop = Math.max(input.lopDays ?? 0, 0);
  const paid = payableDays(totalDays, input.payableDays, lop);
  const proration = totalDays > 0 ? paid / totalDays : 0;

  const earnings = components
    .filter((c) => c.kind === "earning")
    .sort((a, b) => a.display_order - b.display_order);

  // Pass 1 — everything except `balance`, at full monthly value.
  const fullValue = new Map<string, number>();
  for (const c of earnings) {
    if (c.calculation === "balance") continue;
    if (c.calculation === "fixed") {
      fullValue.set(c.code, c.value);
    } else if (c.calculation === "percent_of") {
      const basis = c.basis_code === "GROSS" || !c.basis_code
        ? monthlyGross
        : fullValue.get(c.basis_code) ?? 0;
      fullValue.set(c.code, (basis * c.value) / 100);
    }
  }

  // Pass 2 — `balance` absorbs whatever is left, so the earnings always sum to gross.
  // Never negative: an over-specified structure should not invent a deduction.
  const allocated = [...fullValue.values()].reduce((a, b) => a + b, 0);
  for (const c of earnings) {
    if (c.calculation === "balance") {
      fullValue.set(c.code, Math.max(monthlyGross - allocated, 0));
    }
  }

  // Pass 3 — pro-rate and round each earning.
  const computed: ComputedComponent[] = [];
  let grossEarnings = 0;
  for (const c of earnings) {
    const full = fullValue.get(c.code) ?? 0;
    const amount = rupees(c.prorates ? full * proration : full);
    grossEarnings += amount;
    computed.push({ code: c.code, name: c.name, kind: "earning", amount, display_order: c.display_order });
  }

  grossEarnings += rupees(adhocEarnings);
  if (adhocEarnings) {
    computed.push({
      code: "ADHOC_EARN", name: "Other earnings", kind: "earning",
      amount: rupees(adhocEarnings), display_order: 99,
    });
  }

  // Statutory. PF applies to the PF wage (Basic, capped at the ceiling); ESI applies
  // to gross and switches off entirely above its ceiling.
  const basicPaid = computed.find((c) => c.code === "BASIC")?.amount ?? 0;
  const pfWage = Math.min(basicPaid, rates.pf_wage_ceiling);
  // The ceiling test uses the FULL monthly gross, not the pro-rated one: a month of
  // unpaid leave must not accidentally pull someone into ESI.
  const esiApplies = monthlyGross > 0 && monthlyGross <= rates.esi_wage_ceiling;

  const statutoryAmount = (code: string): number => {
    switch (code) {
      case "PF_EE":  return (pfWage * rates.pf_employee_rate) / 100;
      case "PF_ER":  return (pfWage * rates.pf_employer_rate) / 100;
      case "ESI_EE": return esiApplies ? (grossEarnings * rates.esi_employee_rate) / 100 : 0;
      case "ESI_ER": return esiApplies ? (grossEarnings * rates.esi_employer_rate) / 100 : 0;
      case "PT":     return grossEarnings > 0 ? rates.pt_monthly : 0;
      case "LWF_EE": return grossEarnings > 0 ? rates.lwf_employee : 0;
      default:       return 0;
    }
  };

  let totalDeductions = 0;
  let employerCost = 0;

  for (const c of components.filter((x) => x.kind !== "earning").sort((a, b) => a.display_order - b.display_order)) {
    const raw = c.calculation === "statutory"
      ? statutoryAmount(c.code)
      : c.calculation === "percent_of"
        ? (grossEarnings * c.value) / 100
        : c.value;
    const amount = rupees(c.prorates ? raw * proration : raw);
    if (amount === 0) continue;

    if (c.kind === "deduction") totalDeductions += amount;
    else employerCost += amount;

    computed.push({ code: c.code, name: c.name, kind: c.kind, amount, display_order: c.display_order });
  }

  totalDeductions += rupees(adhocDeductions);
  if (adhocDeductions) {
    computed.push({
      code: "ADHOC_DED", name: "Other deductions", kind: "deduction",
      amount: rupees(adhocDeductions), display_order: 199,
    });
  }

  return {
    components: computed.sort((a, b) => a.display_order - b.display_order),
    grossEarnings,
    totalDeductions,
    employerCost,
    // Net pay floors at zero. Deductions exceeding earnings is a data problem, and
    // showing a negative net would read as "the employee owes us this month".
    netPay: Math.max(grossEarnings - totalDeductions, 0),
    payableDays: paid,
    lopDays: lop,
  };
}

/** Turn payroll_statutory_config rows into the shape computePayroll expects. */
export function ratesFromConfig(rows: { key: string; numeric_value: number }[]): StatutoryRates {
  const get = (k: keyof StatutoryRates, fallback: number) =>
    Number(rows.find((r) => r.key === k)?.numeric_value ?? fallback);
  return {
    pf_employee_rate:  get("pf_employee_rate", 12),
    pf_employer_rate:  get("pf_employer_rate", 12),
    pf_wage_ceiling:   get("pf_wage_ceiling", 15000),
    esi_employee_rate: get("esi_employee_rate", 0.75),
    esi_employer_rate: get("esi_employer_rate", 3.25),
    esi_wage_ceiling:  get("esi_wage_ceiling", 21000),
    pt_monthly:        get("pt_monthly", 200),
    lwf_employee:      get("lwf_employee", 0),
  };
}

/**
 * Days a person was employed within a period — the basis for pro-rating a mid-month
 * joiner or leaver. Dates are ISO `YYYY-MM-DD`.
 */
export function employedDaysInPeriod(
  periodStart: string,
  periodEnd: string,
  dateOfJoining?: string | null,
  dateOfExit?: string | null,
): number {
  const start = dateOfJoining && dateOfJoining > periodStart ? dateOfJoining : periodStart;
  const end = dateOfExit && dateOfExit < periodEnd ? dateOfExit : periodEnd;
  if (end < start) return 0;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

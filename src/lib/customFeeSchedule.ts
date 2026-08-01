// Expands a custom fee (meal, transport, ad-hoc) into concrete ledger installments.
// One place owns the batching + due-date convention so the Add-Fee dialog preview,
// the bulk tool, and any test all agree. The Indian academic year runs Apr→Mar and
// school fees are due on the 10th of each period start.

export type FeeFrequency = "one_time" | "monthly" | "quarterly" | "annually";

export interface FeeInstallment {
  term: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
}

export interface ScheduleInput {
  frequency: FeeFrequency;
  /** Base amount the user enters PER MONTH. Batched up for quarterly/annually. */
  monthlyAmount: number;
  /** monthly: calendar month numbers 1-12. quarterly: 1-4. annually: year ordinals (1..). */
  periods: number[];
  /** Calendar year the academic session starts (e.g. 2026 for AY 2026-27). */
  anchorYear: number;
  dueDay?: number; // default 10
}

// Per generated row, given the per-month base and how many months the row bills.
export function perRowAmount(monthlyAmount: number, frequency: FeeFrequency): number {
  switch (frequency) {
    case "quarterly": return monthlyAmount * 3;
    case "annually": return monthlyAmount * 12;
    default: return monthlyAmount; // one_time, monthly
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// Quarter → (start month, whether it rolls into the next calendar year).
// Academic quarters: q1 Apr, q2 Jul, q3 Oct, q4 Jan (next year).
const QUARTER_MONTH: Record<number, { month: number; nextYear: boolean }> = {
  1: { month: 4, nextYear: false },
  2: { month: 7, nextYear: false },
  3: { month: 10, nextYear: false },
  4: { month: 1, nextYear: true },
};

export function buildFeeSchedule(input: ScheduleInput): FeeInstallment[] {
  const dueDay = input.dueDay ?? 10;
  const day = Math.min(Math.max(dueDay, 1), 28); // clamp so make_date-style dates are always valid
  const amt = perRowAmount(input.monthlyAmount, input.frequency);
  const y = input.anchorYear;

  if (input.frequency === "one_time") {
    // A single charge, due at the start of the session (10 Apr) by default.
    return [{ term: "one_time", amount: input.monthlyAmount, due_date: iso(y, 4, day) }];
  }

  if (input.frequency === "quarterly") {
    return input.periods
      .filter((q) => QUARTER_MONTH[q])
      .sort((a, b) => a - b)
      .map((q) => {
        const { month, nextYear } = QUARTER_MONTH[q];
        return { term: `q${q}`, amount: amt, due_date: iso(nextYear ? y + 1 : y, month, day) };
      });
  }

  if (input.frequency === "annually") {
    return input.periods
      .sort((a, b) => a - b)
      .map((n) => ({ term: `year_${n}`, amount: amt, due_date: iso(y + (n - 1), 4, day) }));
  }

  // monthly: calendar months 1-12. Jan/Feb/Mar belong to the next calendar year
  // of the Apr→Mar academic session.
  return input.periods
    .sort((a, b) => a - b)
    .map((m) => {
      const cy = m <= 3 ? y + 1 : y;
      return { term: `m_${cy}_${pad(m)}`, amount: amt, due_date: iso(cy, m, day) };
    });
}

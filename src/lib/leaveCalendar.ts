// Pure month-grid primitives for the leave calendars.
//
// Deliberately free of React and Supabase so the grid maths — week layout, leap
// years, inclusive date spans — can be unit tested without a browser or a
// database. `month` is zero-based to match JavaScript's `Date`, so month 0 is
// January and month 1 is February (the leap-month case depends on that).

export interface CalendarLeave {
  id: string;
  employee_name: string;
  leave_type: string;
  /** Inclusive start day, YYYY-MM-DD. */
  start_date: string;
  /** Inclusive end day, YYYY-MM-DD. */
  end_date: string;
  days: number;
  status: string;
}

export interface MonthBounds {
  /** First day of the month, inclusive, YYYY-MM-DD. */
  from: string;
  /** Last day of the month, inclusive, YYYY-MM-DD. */
  to: string;
}

/** Column headers for a Sunday-first week. */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A local calendar date as YYYY-MM-DD.
 *
 * Built from local date parts — never `toISOString()`, which shifts the day
 * backwards/forwards for anyone east or west of UTC.
 */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when both dates fall on the same local calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** First and last day of `month`, as inclusive ISO dates. */
export function monthBounds(year: number, month: number): MonthBounds {
  return {
    from: isoDate(new Date(year, month, 1)),
    to: isoDate(new Date(year, month + 1, 0)),
  };
}

/**
 * Whole weeks (Sunday-first) covering `month`, padded with the leading/trailing
 * days of the neighbouring months.
 *
 * Every week always has exactly seven dates, so a grid can render without
 * special-casing the first and last row. The returned dates are fresh copies —
 * mutating the cursor here never leaks into the caller.
 */
export function monthMatrix(year: number, month: number): Date[][] {
  const lastOfMonth = new Date(year, month + 1, 0);
  const cursor = new Date(year, month, 1 - new Date(year, month, 1).getDay());

  const weeks: Date[][] = [];
  while (cursor <= lastOfMonth) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Every leave whose inclusive span covers `dateIso`.
 *
 * ISO dates sort lexicographically, so the comparison needs no parsing and a
 * multi-day span matches each of its days, both endpoints included.
 */
export function leavesOnDay(leaves: CalendarLeave[], dateIso: string): CalendarLeave[] {
  return leaves.filter((leave) => leave.start_date <= dateIso && leave.end_date >= dateIso);
}

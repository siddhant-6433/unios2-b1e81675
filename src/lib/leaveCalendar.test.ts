import { describe, it, expect } from "vitest";
import {
  isoDate,
  sameDay,
  monthBounds,
  monthMatrix,
  leavesOnDay,
  type CalendarLeave,
} from "./leaveCalendar";

const leave = (over: Partial<CalendarLeave> = {}): CalendarLeave => ({
  id: "l1",
  employee_name: "Asha",
  leave_type: "casual",
  start_date: "2026-03-30",
  end_date: "2026-04-02",
  days: 4,
  status: "approved",
  ...over,
});

describe("isoDate", () => {
  it("renders a local date as YYYY-MM-DD with zero padding", () => {
    expect(isoDate(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(isoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(isoDate(new Date(2026, 8, 9))).toBe("2026-09-09");
  });

  it("does not shift the day across the UTC boundary", () => {
    // Midnight local is the previous day in UTC for +05:30; a toISOString()
    // implementation would report 2025-12-31 here.
    expect(isoDate(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
  });
});

describe("sameDay", () => {
  it("is true for the same calendar day at different times", () => {
    expect(sameDay(new Date(2026, 8, 23, 0, 1), new Date(2026, 8, 23, 23, 59))).toBe(true);
  });

  it("is false across day, month or year boundaries", () => {
    expect(sameDay(new Date(2026, 8, 23), new Date(2026, 8, 24))).toBe(false);
    expect(sameDay(new Date(2026, 8, 30), new Date(2026, 9, 1))).toBe(false);
    expect(sameDay(new Date(2026, 11, 31), new Date(2027, 0, 1))).toBe(false);
  });
});

describe("monthBounds", () => {
  it("spans the full calendar month", () => {
    expect(monthBounds(2026, 8)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthBounds(2026, 0)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("handles a leap February", () => {
    expect(monthBounds(2024, 1)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("uses 28 days for a non-leap February", () => {
    expect(monthBounds(2026, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("monthMatrix", () => {
  it("returns whole Sunday-first weeks of seven dates", () => {
    const weeks = monthMatrix(2026, 8); // September 2026
    expect(weeks.length).toBeGreaterThanOrEqual(4);
    expect(weeks.length).toBeLessThanOrEqual(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    for (const week of weeks) expect(week[0].getDay()).toBe(0); // Sunday
  });

  it("pads the leading and trailing days of the neighbouring months", () => {
    const { from, to } = monthBounds(2026, 8);
    const flat = monthMatrix(2026, 8).flat();
    expect(isoDate(flat[0]) <= from).toBe(true);
    expect(isoDate(flat[flat.length - 1]) >= to).toBe(true);
  });

  it("advances one calendar day at a time", () => {
    const flat = monthMatrix(2026, 8).flat();
    for (let i = 1; i < flat.length; i += 1) {
      const next = new Date(flat[i - 1]);
      next.setDate(next.getDate() + 1);
      expect(isoDate(next)).toBe(isoDate(flat[i]));
    }
  });

  it("contains every day of the month, boundaries included", () => {
    const flat = monthMatrix(2026, 8).flat().map(isoDate);
    expect(flat).toContain("2026-09-01");
    expect(flat).toContain("2026-09-30");
    expect(flat).toHaveLength(35); // Sep 1 2026 is a Tuesday → 5 weeks
  });

  it("includes 29 February in a leap year", () => {
    const flat = monthMatrix(2024, 1).flat().map(isoDate);
    expect(flat).toContain("2024-02-29");
  });

  it("omits 29 February in a non-leap year", () => {
    const flat = monthMatrix(2026, 1).flat().map(isoDate);
    expect(flat).not.toContain("2026-02-29");
    expect(flat).toContain("2026-02-28");
  });
});

describe("leavesOnDay", () => {
  it("matches a single-day leave only on that day", () => {
    const one = [leave({ id: "single", start_date: "2026-03-30", end_date: "2026-03-30", days: 1 })];
    expect(leavesOnDay(one, "2026-03-30").map((l) => l.id)).toEqual(["single"]);
    expect(leavesOnDay(one, "2026-03-29")).toHaveLength(0);
    expect(leavesOnDay(one, "2026-03-31")).toHaveLength(0);
  });

  it("matches every day of a multi-day span, both endpoints included", () => {
    const span = [leave()]; // 2026-03-30 → 2026-04-02
    expect(leavesOnDay(span, "2026-03-29")).toHaveLength(0);
    expect(leavesOnDay(span, "2026-03-30")).toHaveLength(1);
    expect(leavesOnDay(span, "2026-04-01")).toHaveLength(1);
    expect(leavesOnDay(span, "2026-04-02")).toHaveLength(1);
    expect(leavesOnDay(span, "2026-04-03")).toHaveLength(0);
  });

  it("keeps all leaves that overlap the queried day", () => {
    const overlaps = [
      leave({ id: "a", start_date: "2026-04-01", end_date: "2026-04-05" }),
      leave({ id: "b", start_date: "2026-04-02", end_date: "2026-04-02" }),
      leave({ id: "c", start_date: "2026-03-25", end_date: "2026-03-31" }),
    ];
    expect(leavesOnDay(overlaps, "2026-04-02").map((l) => l.id)).toEqual(["a", "b"]);
    expect(leavesOnDay(overlaps, "2026-03-31").map((l) => l.id)).toEqual(["c"]);
    expect(leavesOnDay(overlaps, "2026-03-15")).toHaveLength(0);
  });

  it("returns an empty list for no leaves", () => {
    expect(leavesOnDay([], "2026-04-02")).toEqual([]);
  });
});

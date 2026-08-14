import { describe, it, expect } from "vitest";
import {
  buildAttendanceMonth,
  formatMinutes,
  timeToMinutes,
  toIsoDate,
  DEFAULT_SHIFT,
  type PunchRow,
} from "./attendanceDay";

// Local-time ISO for a given day/clock, so these assertions don't move with TZ.
const at = (day: number, h: number, m: number) =>
  new Date(2026, 3, day, h, m).toISOString();

const row = (id: string, day: number, inH: number, inM: number, outH?: number, outM?: number): PunchRow => ({
  id,
  date: `2026-04-${String(day).padStart(2, "0")}`,
  punch_in: at(day, inH, inM),
  punch_out: outH === undefined ? null : at(day, outH, outM ?? 0),
});

const build = (punches: PunchRow[], extra: Partial<Parameters<typeof buildAttendanceMonth>[0]> = {}) =>
  buildAttendanceMonth({
    year: 2026,
    month: 3, // April
    punches,
    today: new Date(2026, 4, 15),
    ...extra,
  });

describe("buildAttendanceMonth", () => {
  it("collapses many punch pairs in a day into one row", () => {
    // The screenshot case: one Thursday, many in/out pairs, each rendering 0.0h.
    const punches = [
      row("a", 30, 10, 48, 10, 48),
      row("b", 30, 13, 54, 13, 54),
      row("c", 30, 14, 32, 14, 35),
      row("d", 30, 15, 30, 15, 38),
      row("e", 30, 15, 41, 15, 58),
      row("f", 30, 16, 6, 16, 6),
    ];
    const { days } = build(punches);
    const apr30 = days.filter((d) => d.date === "2026-04-30");

    expect(apr30).toHaveLength(1);
    expect(apr30[0].pairs).toHaveLength(6);
    // 3 + 8 + 17 minutes of actual paired time.
    expect(apr30[0].effectiveMinutes).toBe(28);
    // First in 10:48 → last out 16:06.
    expect(apr30[0].grossMinutes).toBe(318);
  });

  it("always emits every calendar day, punched or not", () => {
    const { days } = build([row("a", 2, 9, 0, 17, 30)]);
    expect(days).toHaveLength(30);
    expect(days[0].date).toBe("2026-04-01");
  });

  it("grades the day against the shift's full and half day hours", () => {
    const full = build([row("a", 2, 9, 0, 17, 30)]).days.find((d) => d.date === "2026-04-02")!;
    const half = build([row("b", 2, 9, 0, 14, 0)]).days.find((d) => d.date === "2026-04-02")!;
    const short = build([row("c", 2, 9, 0, 11, 0)]).days.find((d) => d.date === "2026-04-02")!;

    expect(full.status).toBe("present");
    expect(half.status).toBe("half_day");
    expect(short.status).toBe("absent");
  });

  it("never invents hours for an unclosed punch", () => {
    const day = build([row("a", 2, 9, 0)]).days.find((d) => d.date === "2026-04-02")!;
    expect(day.effectiveMinutes).toBe(0);
    expect(day.status).toBe("no_punch_out");
    expect(day.segments[0].open).toBe(true);
  });

  it("ranks holiday over weekly off over leave over absent", () => {
    const sunday = "2026-04-05"; // a Sunday
    expect(build([]).days.find((d) => d.date === sunday)!.status).toBe("weekly_off");

    const withHoliday = build([], { holidays: [{ holiday_date: sunday, name: "Ram Navami" }] });
    expect(withHoliday.days.find((d) => d.date === sunday)!.status).toBe("holiday");

    const withLeave = build([], {
      leaves: [{ start_date: "2026-04-06", end_date: "2026-04-08", leave_type: "casual", status: "approved" }],
    });
    expect(withLeave.days.find((d) => d.date === "2026-04-07")!.status).toBe("on_leave");
    // A pending request is not time off yet.
    const pending = build([], {
      leaves: [{ start_date: "2026-04-07", end_date: "2026-04-07", leave_type: "casual", status: "pending" }],
    });
    expect(pending.days.find((d) => d.date === "2026-04-07")!.status).toBe("absent");
  });

  it("does not mark days that haven't happened as absent", () => {
    const { days, summary } = buildAttendanceMonth({
      year: 2026, month: 4, punches: [], today: new Date(2026, 4, 15),
    });
    expect(days.find((d) => d.date === "2026-05-20")!.status).toBe("future");
    // Only the 15 elapsed days count, and Sundays among them are offs.
    expect(summary.absent + summary.weeklyOff).toBe(15);
  });

  it("measures lateness against the grace period, not the shift start", () => {
    const onTime = build([row("a", 2, 9, 8, 17, 30)]).days.find((d) => d.date === "2026-04-02")!;
    const late = build([row("b", 2, 9, 40, 17, 30)]).days.find((d) => d.date === "2026-04-02")!;
    expect(onTime.lateMinutes).toBe(0);         // inside the 10-minute grace
    expect(late.lateMinutes).toBe(30);
  });

  it("counts a half day as half a payable day", () => {
    const { summary } = build([
      row("a", 1, 9, 0, 17, 30),
      row("b", 2, 9, 0, 14, 0),
    ]);
    expect(summary.present).toBe(1);
    expect(summary.halfDay).toBe(1);
    expect(summary.payableDays).toBe(summary.present + 0.5 + summary.weeklyOff + summary.onLeave);
  });

  it("stretches the shared bar window to reach punches outside the shift", () => {
    const { windowStartMin, windowEndMin } = build([row("a", 2, 6, 15, 21, 40)]);
    expect(windowStartMin).toBeLessThanOrEqual(timeToMinutes("06:00:00"));
    expect(windowEndMin).toBeGreaterThanOrEqual(timeToMinutes("22:00:00"));
  });

  it("keeps every segment inside the bar", () => {
    const { days } = build([row("a", 2, 9, 0, 17, 30), row("b", 2, 18, 0, 19, 0)]);
    for (const seg of days.find((d) => d.date === "2026-04-02")!.segments) {
      expect(seg.leftPct).toBeGreaterThanOrEqual(0);
      expect(seg.leftPct + seg.widthPct).toBeLessThanOrEqual(100.01);
    }
  });

  it("respects a shift with a different weekly off", () => {
    const friOff = { ...DEFAULT_SHIFT, weekly_offs: [5] };
    const { days } = build([], { shift: friOff });
    expect(days.find((d) => d.date === "2026-04-03")!.status).toBe("weekly_off"); // Friday
    expect(days.find((d) => d.date === "2026-04-05")!.status).toBe("absent");     // Sunday now works
  });
});

describe("helpers", () => {
  it("formats minutes the way a payslip reads", () => {
    expect(formatMinutes(0)).toBe("0h 00m");
    expect(formatMinutes(495)).toBe("8h 15m");
    expect(formatMinutes(60)).toBe("1h 00m");
  });

  it("parses shift times and dates without drifting a day", () => {
    expect(timeToMinutes("09:30:00")).toBe(570);
    expect(toIsoDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

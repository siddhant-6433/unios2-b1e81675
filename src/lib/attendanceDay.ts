// Roll raw punch rows up into one row per calendar day, the way Keka does.
//
// The table stores one row per punch PAIR, so a person who steps out four times
// has five rows for the day and every one of them reads "0.0h". Rendering that
// list directly is what the old view did: thirteen rows for one Thursday, each
// claiming zero hours, with the real total (about six hours) shown nowhere.
//
// A day is the unit people are paid and judged on, so a day is the unit here.
// Effective hours = time actually inside the building (sum of the pairs).
// Gross hours = first in to last out, including the gaps. Keka shows both
// because the difference between them IS the question HR is asking.

export interface PunchRow {
  id: string;
  date: string;                 // yyyy-mm-dd
  punch_in: string | null;
  punch_out: string | null;
}

export interface ShiftConfig {
  start_time: string;           // "09:00:00"
  end_time: string;             // "17:00:00"
  grace_minutes: number;
  break_minutes: number;
  weekly_offs: number[];        // JS getDay(): 0 = Sunday
  full_day_hours: number;
  half_day_hours: number;
}

export const DEFAULT_SHIFT: ShiftConfig = {
  start_time: "09:00:00",
  end_time: "17:00:00",
  grace_minutes: 10,
  break_minutes: 30,
  weekly_offs: [0],
  full_day_hours: 8,
  half_day_hours: 4,
};

export type DayStatus =
  | "present"
  | "half_day"
  | "absent"
  | "weekly_off"
  | "holiday"
  | "on_leave"
  | "no_punch_out"
  | "future";

export interface DaySegment {
  leftPct: number;
  widthPct: number;
  open: boolean;                // punched in, never punched out
}

export interface AttendancePair {
  in: Date | null;
  out: Date | null;
  minutes: number;
}

export interface AttendanceDay {
  date: string;
  weekday: number;
  pairs: AttendancePair[];
  firstIn: Date | null;
  lastOut: Date | null;
  effectiveMinutes: number;
  grossMinutes: number;
  lateMinutes: number;
  status: DayStatus;
  holidayName?: string;
  leaveType?: string;
  segments: DaySegment[];
}

export interface MonthSummary {
  payableDays: number;
  present: number;
  halfDay: number;
  absent: number;
  weeklyOff: number;
  holidays: number;
  onLeave: number;
  avgEffectiveMinutes: number;
}

export interface AttendanceMonth {
  days: AttendanceDay[];
  summary: MonthSummary;
  windowStartMin: number;       // shared x-axis for every bar, so rows compare
  windowEndMin: number;
}

/** "09:30:00" → 570. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutes since local midnight. */
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** yyyy-mm-dd → local Date at midnight (never UTC — that shifts the weekday). */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 495 → "8h 15m". */
export function formatMinutes(mins: number): string {
  if (!mins || mins <= 0) return "0h 00m";
  return `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, "0")}m`;
}

export function formatClock(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export interface BuildOptions {
  year: number;
  month: number;                // 0-indexed, as JS
  punches: PunchRow[];
  shift?: ShiftConfig;
  holidays?: { holiday_date: string; name: string }[];
  leaves?: { start_date: string; end_date: string; leave_type: string; status: string }[];
  today?: Date;
}

export function buildAttendanceMonth(opts: BuildOptions): AttendanceMonth {
  const shift = opts.shift ?? DEFAULT_SHIFT;
  const today = opts.today ?? new Date();
  const todayIso = toIsoDate(today);

  const holidayByDate = new Map((opts.holidays ?? []).map((h) => [h.holiday_date, h.name]));
  const approvedLeave = (opts.leaves ?? []).filter((l) => l.status === "approved");

  // Punches grouped by their own date column rather than by punch_in, so a
  // record corrected by HR stays on the day it belongs to.
  const byDate = new Map<string, PunchRow[]>();
  for (const p of opts.punches) {
    const list = byDate.get(p.date);
    if (list) list.push(p);
    else byDate.set(p.date, [p]);
  }

  const shiftStart = timeToMinutes(shift.start_time);
  const shiftEnd = timeToMinutes(shift.end_time);
  const fullDayMin = shift.full_day_hours * 60;
  const halfDayMin = shift.half_day_hours * 60;

  const daysInMonth = new Date(opts.year, opts.month + 1, 0).getDate();
  const days: AttendanceDay[] = [];

  // The bar's x-axis is shared by every row, so an hour is the same width on
  // each. Start from the shift with an hour of headroom, then stretch for
  // anyone who came early or left late.
  let windowStartMin = Math.max(0, shiftStart - 60);
  let windowEndMin = Math.min(1440, shiftEnd + 60);

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dateObj = new Date(opts.year, opts.month, dayNum);
    const iso = toIsoDate(dateObj);
    const rows = (byDate.get(iso) ?? []).slice();

    const pairs: AttendancePair[] = rows
      .map((r) => {
        const pin = r.punch_in ? new Date(r.punch_in) : null;
        const pout = r.punch_out ? new Date(r.punch_out) : null;
        // An unclosed punch contributes no time. Guessing an end here would
        // quietly invent hours nobody worked.
        const minutes = pin && pout ? Math.max(0, (pout.getTime() - pin.getTime()) / 60_000) : 0;
        return { in: pin, out: pout, minutes };
      })
      .filter((p) => p.in || p.out)
      .sort((a, b) => (a.in?.getTime() ?? 0) - (b.in?.getTime() ?? 0));

    const effectiveMinutes = pairs.reduce((sum, p) => sum + p.minutes, 0);
    const firstIn = pairs.find((p) => p.in)?.in ?? null;
    const lastOut = [...pairs].reverse().find((p) => p.out)?.out ?? null;
    const grossMinutes =
      firstIn && lastOut ? Math.max(0, (lastOut.getTime() - firstIn.getTime()) / 60_000) : 0;

    if (firstIn) windowStartMin = Math.min(windowStartMin, Math.floor(minutesOfDay(firstIn) / 60) * 60);
    if (lastOut) windowEndMin = Math.max(windowEndMin, Math.ceil(minutesOfDay(lastOut) / 60) * 60);

    const weekday = dateObj.getDay();
    const holidayName = holidayByDate.get(iso);
    const leave = approvedLeave.find((l) => iso >= l.start_date && iso <= l.end_date);

    let status: DayStatus;
    if (iso > todayIso) status = "future";
    else if (holidayName) status = "holiday";
    else if (shift.weekly_offs.includes(weekday)) status = "weekly_off";
    else if (leave) status = "on_leave";
    else if (pairs.length === 0) status = "absent";
    else if (!lastOut) status = "no_punch_out";
    else if (effectiveMinutes >= fullDayMin) status = "present";
    else if (effectiveMinutes >= halfDayMin) status = "half_day";
    else status = "absent";

    const isWorkingDay = status !== "holiday" && status !== "weekly_off" && status !== "future";
    const lateMinutes =
      isWorkingDay && firstIn
        ? Math.max(0, minutesOfDay(firstIn) - (shiftStart + shift.grace_minutes))
        : 0;

    days.push({
      date: iso,
      weekday,
      pairs,
      firstIn,
      lastOut,
      effectiveMinutes,
      grossMinutes,
      lateMinutes,
      status,
      holidayName,
      leaveType: leave?.leave_type,
      segments: [],
    });
  }

  // Segments need the final window, so lay them out once it is known.
  const span = Math.max(1, windowEndMin - windowStartMin);
  for (const day of days) {
    day.segments = day.pairs
      .filter((p) => p.in)
      .map((p) => {
        const startMin = minutesOfDay(p.in!);
        // A pair with no punch-out gets a hairline marker, not a bar to nowhere.
        const endMin = p.out ? minutesOfDay(p.out) : startMin + 4;
        const left = ((clamp(startMin, windowStartMin, windowEndMin) - windowStartMin) / span) * 100;
        const right = ((clamp(endMin, windowStartMin, windowEndMin) - windowStartMin) / span) * 100;
        return { leftPct: left, widthPct: Math.max(0.6, right - left), open: !p.out };
      });
  }

  const counted = days.filter((d) => d.status !== "future");
  const present = counted.filter((d) => d.status === "present" || d.status === "no_punch_out").length;
  const halfDay = counted.filter((d) => d.status === "half_day").length;
  const absent = counted.filter((d) => d.status === "absent").length;
  const weeklyOff = counted.filter((d) => d.status === "weekly_off").length;
  const holidays = counted.filter((d) => d.status === "holiday").length;
  const onLeave = counted.filter((d) => d.status === "on_leave").length;
  const worked = counted.filter((d) => d.effectiveMinutes > 0);

  return {
    days,
    windowStartMin,
    windowEndMin,
    summary: {
      // A half day is half a day's pay — the whole reason the tier exists.
      payableDays: present + halfDay * 0.5 + weeklyOff + holidays + onLeave,
      present,
      halfDay,
      absent,
      weeklyOff,
      holidays,
      onLeave,
      avgEffectiveMinutes: worked.length
        ? worked.reduce((s, d) => s + d.effectiveMinutes, 0) / worked.length
        : 0,
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  weekly_off: "Weekly off",
  holiday: "Holiday",
  on_leave: "On leave",
  no_punch_out: "Missing punch out",
  future: "—",
};

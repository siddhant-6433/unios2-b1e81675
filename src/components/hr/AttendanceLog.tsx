// Keka-shaped attendance log: one row per day, a shared timeline bar, effective
// vs gross hours, and a month summary above it.
//
// The bar is the point of the whole screen. Numbers tell you someone worked six
// hours; the bar tells you they worked them in five fragments starting at 10:48,
// which is the thing a manager actually reacts to.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Fingerprint, AlertTriangle, Clock } from "lucide-react";
import {
  buildAttendanceMonth,
  formatMinutes,
  formatClock,
  timeToMinutes,
  DEFAULT_SHIFT,
  STATUS_LABEL,
  type AttendanceDay,
  type DayStatus,
  type PunchRow,
  type ShiftConfig,
} from "@/lib/attendanceDay";

interface Props {
  userId: string;
  /** Needed only to raise a regularisation; omit for a read-only view. */
  employeeProfileId?: string | null;
  canRegularise?: boolean;
}

const MONTH_LABEL = (y: number, m: number) =>
  new Date(y, m, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

const STATUS_STYLE: Record<DayStatus, string> = {
  present: "bg-success/15 text-success",
  half_day: "bg-warning/15 text-warning",
  absent: "bg-destructive/15 text-destructive",
  weekly_off: "bg-muted text-muted-foreground",
  holiday: "bg-primary/10 text-primary",
  on_leave: "bg-primary/10 text-primary",
  no_punch_out: "bg-warning/15 text-warning",
  future: "bg-transparent text-muted-foreground/40",
};

export function AttendanceLog({ userId, employeeProfileId, canRegularise = true }: Props) {
  const { toast } = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [punches, setPunches] = useState<PunchRow[]>([]);
  const [shift, setShift] = useState<ShiftConfig | null>(null);
  const [shiftName, setShiftName] = useState<string>("");
  const [holidays, setHolidays] = useState<{ holiday_date: string; name: string }[]>([]);
  const [leaves, setLeaves] = useState<{ start_date: string; end_date: string; leave_type: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [regularising, setRegularising] = useState<AttendanceDay | null>(null);

  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${new Date(year, month + 1, 0).getDate()}`;

  useEffect(() => { void load(); }, [userId, from]);

  const load = async () => {
    setLoading(true);
    const [att, emp, hol, lv] = await Promise.all([
      supabase.from("employee_attendance")
        .select("id, date, punch_in, punch_out")
        .eq("user_id", userId).gte("date", from).lte("date", to)
        .order("punch_in"),
      supabase.from("employee_profiles")
        .select("work_shift_id, work_shifts(name, start_time, end_time, grace_minutes, break_minutes, weekly_offs, full_day_hours, half_day_hours)")
        .eq("user_id", userId).maybeSingle(),
      supabase.from("holidays").select("holiday_date, name").gte("holiday_date", from).lte("holiday_date", to),
      supabase.from("employee_leave_requests")
        .select("start_date, end_date, leave_type, status")
        .eq("user_id", userId).lte("start_date", to).gte("end_date", from),
    ]);

    setPunches((att.data as PunchRow[]) ?? []);
    const s = (emp.data as { work_shifts?: ShiftConfig & { name: string } } | null)?.work_shifts;
    // No shift assigned yet is the norm for most of the 96 imported employees,
    // so fall back rather than render an empty screen.
    setShift(s ? { ...s, weekly_offs: s.weekly_offs ?? [0] } : DEFAULT_SHIFT);
    setShiftName(s?.name ?? "General (default)");
    setHolidays(hol.data ?? []);
    setLeaves(lv.data ?? []);
    setLoading(false);
  };

  const month_ = useMemo(
    () => buildAttendanceMonth({ year, month, punches, shift: shift ?? DEFAULT_SHIFT, holidays, leaves }),
    [year, month, punches, shift, holidays, leaves],
  );

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setExpanded(null);
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const { summary, days, windowStartMin, windowEndMin } = month_;

  // Hour ticks under the bar, so a segment's position reads as a time.
  const ticks = useMemo(() => {
    const out: { min: number; label: string }[] = [];
    const stepMin = windowEndMin - windowStartMin > 600 ? 180 : 120;
    for (let m = Math.ceil(windowStartMin / stepMin) * stepMin; m < windowEndMin; m += stepMin) {
      const h = Math.floor(m / 60);
      out.push({ min: m, label: `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}` });
    }
    return out;
  }, [windowStartMin, windowEndMin]);

  const pct = (min: number) => ((min - windowStartMin) / Math.max(1, windowEndMin - windowStartMin)) * 100;
  const shiftBand = shift
    ? { left: pct(timeToMinutes(shift.start_time)), width: pct(timeToMinutes(shift.end_time)) - pct(timeToMinutes(shift.start_time)) }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-1">
          <button onClick={() => step(-1)} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-sm font-semibold text-foreground min-w-[9rem] text-center">
            {MONTH_LABEL(year, month)}
          </span>
          <button onClick={() => step(1)} disabled={isCurrentMonth}
            className="rounded-lg p-1.5 hover:bg-muted disabled:opacity-30" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {shiftName}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Payable days" value={summary.payableDays} strong />
        <Stat label="Present" value={summary.present} />
        <Stat label="Half day" value={summary.halfDay} />
        <Stat label="On leave" value={summary.onLeave} />
        <Stat label="Weekly off" value={summary.weeklyOff} />
        <Stat label="Holidays" value={summary.holidays} />
        <Stat label="Absent" value={summary.absent} tone={summary.absent > 0 ? "bad" : undefined} />
      </div>

      {loading ? (
        <div className="rounded-xl border border-border p-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <Th className="w-28">Date</Th>
                <Th>
                  <div className="relative h-4">
                    {ticks.map((t) => (
                      <span key={t.min} className="absolute -translate-x-1/2 text-[9px] text-muted-foreground/70"
                        style={{ left: `${pct(t.min)}%` }}>{t.label}</span>
                    ))}
                  </div>
                </Th>
                <Th className="w-24">Effective</Th>
                <Th className="w-24">Gross</Th>
                <Th className="w-28">Arrival</Th>
                <Th className="w-14">Log</Th>
                <Th className="w-32">Status</Th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const isOpen = expanded === d.date;
                const dim = d.status === "future";
                return [
                  <tr key={d.date}
                    onClick={() => !dim && d.pairs.length > 0 && setExpanded(isOpen ? null : d.date)}
                    className={`border-b border-border/30 ${dim ? "opacity-40" : "hover:bg-muted/20"} ${d.pairs.length ? "cursor-pointer" : ""}`}>
                    <Td>
                      <span className={d.status === "weekly_off" || d.status === "holiday" ? "text-muted-foreground" : "text-foreground"}>
                        {new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
                      </span>
                    </Td>
                    <Td>
                      <div className="relative h-5 rounded bg-muted/50">
                        {shiftBand && (
                          <div className="absolute inset-y-0 rounded bg-foreground/[0.06]"
                            style={{ left: `${shiftBand.left}%`, width: `${shiftBand.width}%` }} />
                        )}
                        {d.segments.map((s, i) => (
                          <div key={i}
                            title={`${formatClock(d.pairs[i]?.in ?? null)} – ${formatClock(d.pairs[i]?.out ?? null)}`}
                            className={`absolute inset-y-1 rounded-sm ${s.open ? "bg-warning" : "bg-success"}`}
                            style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%` }} />
                        ))}
                      </div>
                    </Td>
                    <Td className="font-medium">{d.pairs.length ? formatMinutes(d.effectiveMinutes) : "—"}</Td>
                    <Td className="text-muted-foreground">{d.grossMinutes ? formatMinutes(d.grossMinutes) : "—"}</Td>
                    <Td>
                      {!d.firstIn ? <span className="text-muted-foreground">—</span>
                        : d.lateMinutes > 0
                          ? <span className="text-destructive">Late {formatMinutes(d.lateMinutes)}</span>
                          : <span className="text-success">On time</span>}
                    </Td>
                    <Td className="text-muted-foreground">{d.pairs.length || "—"}</Td>
                    <Td>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[d.status]}`}>
                        {d.holidayName || STATUS_LABEL[d.status]}
                      </span>
                    </Td>
                  </tr>,
                  isOpen && (
                    <tr key={`${d.date}-detail`} className="bg-muted/20">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {d.pairs.map((p, i) => (
                            <span key={i} className="rounded-lg border border-border bg-background px-2 py-1 text-[11px]">
                              {formatClock(p.in)} → {p.out ? formatClock(p.out) : <span className="text-warning">still in</span>}
                              {p.minutes > 0 && <span className="ml-1.5 text-muted-foreground">{formatMinutes(p.minutes)}</span>}
                            </span>
                          ))}
                          {canRegularise && employeeProfileId && (
                            <Button size="sm" variant="outline" className="h-7 text-[11px]"
                              onClick={(e) => { e.stopPropagation(); setRegularising(d); }}>
                              Request correction
                            </Button>
                          )}
                        </div>
                        {d.status === "no_punch_out" && (
                          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            No punch out, so this day counts as zero hours until it is corrected.
                          </p>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
          {days.every((d) => d.pairs.length === 0) && (
            <div className="p-10 text-center">
              <Fingerprint className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No punches recorded this month</p>
            </div>
          )}
        </div>
      )}

      <RegulariseDialog
        day={regularising}
        onClose={() => setRegularising(null)}
        employeeProfileId={employeeProfileId ?? null}
        userId={userId}
        onDone={() => { setRegularising(null); toast({ title: "Correction requested", description: "HR will review it." }); }}
      />
    </div>
  );
}

function RegulariseDialog({
  day, onClose, employeeProfileId, userId, onDone,
}: {
  day: AttendanceDay | null;
  onClose: () => void;
  employeeProfileId: string | null;
  userId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!day) return;
    const hhmm = (d: Date | null) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");
    setInTime(hhmm(day.firstIn));
    setOutTime(hhmm(day.lastOut));
    setReason("");
  }, [day]);

  const submit = async () => {
    if (!day || !employeeProfileId) return;
    setBusy(true);
    const iso = (t: string) => (t ? new Date(`${day.date}T${t}:00`).toISOString() : null);
    const { error } = await supabase.from("attendance_regularisations").insert({
      employee_profile_id: employeeProfileId,
      user_id: userId,
      date: day.date,
      requested_punch_in: iso(inTime),
      requested_punch_out: iso(outTime),
      reason: reason.trim() || null,
      status: "pending",
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not submit", description: error.message, variant: "destructive" });
      return;
    }
    onDone();
  };

  const input = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm";

  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Request correction</DialogTitle></DialogHeader>
        {day && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {new Date(day.date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Punch in</label>
                <input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Punch out</label>
                <input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} className={input} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">Reason</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="Why the recorded times are wrong" className={input} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !reason.trim()}>
                {busy ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const Stat = ({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "bad" }) => (
  <div className={`rounded-xl border p-2.5 ${strong ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={`mt-0.5 text-lg font-bold ${tone === "bad" ? "text-destructive" : "text-foreground"}`}>
      {Number.isInteger(value) ? value : value.toFixed(1)}
    </p>
  </div>
);

const Th = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <th className={`border-b border-border px-3 py-2.5 text-left font-semibold text-muted-foreground ${className}`}>{children}</th>
);
const Td = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <td className={`px-3 py-2 text-foreground ${className}`}>{children}</td>
);

export default AttendanceLog;

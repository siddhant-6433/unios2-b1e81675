// HR team leave calendar — a read-only month view of approved leave.
//
// Reads the `leave_calendar` RPC for exactly the visible month so the client
// never downloads the whole leave history. The RPC already filters to approved
// leave overlapping the range and enforces hr:view / hr:leave_approve, so this
// panel never writes.
//
// `LeaveMonthGrid` is exported because the employee self view renders the same
// grid; keeping one grid means the two calendars cannot drift apart.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  isoDate,
  leavesOnDay,
  monthBounds,
  monthMatrix,
  sameDay,
  WEEKDAY_LABELS,
  type CalendarLeave,
} from "@/lib/leaveCalendar";

interface LeaveCalendarRow {
  request_id: string | null;
  employee_profile_id: string | null;
  employee_name: string | null;
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  status: string | null;
}

const LEAVE_TYPE_STYLES: Record<string, string> = {
  casual: "bg-pastel-blue text-foreground/80",
  sick: "bg-pastel-red text-foreground/80",
  earned: "bg-pastel-green text-foreground/80",
  privilege: "bg-pastel-green text-foreground/80",
  unpaid: "bg-pastel-yellow text-foreground/80",
  lwp: "bg-pastel-orange text-foreground/80",
  maternity: "bg-pastel-pink text-foreground/80",
  paternity: "bg-pastel-purple text-foreground/80",
};

const FALLBACK_STYLES = [
  "bg-pastel-purple text-foreground/80",
  "bg-pastel-mint text-foreground/80",
  "bg-pastel-orange text-foreground/80",
  "bg-pastel-blue text-foreground/80",
];

/** Stable pastel chip class for a leave type, known types first, hash otherwise. */
function leaveTypeStyle(leaveType: string): string {
  const key = leaveType.trim().toLowerCase().split(/[\s/_-]/)[0];
  if (LEAVE_TYPE_STYLES[key]) return LEAVE_TYPE_STYLES[key];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return FALLBACK_STYLES[Math.abs(hash) % FALLBACK_STYLES.length];
}

interface LeaveMonthGridProps {
  year: number;
  /** Zero-based month, matching Date. */
  month: number;
  leaves: CalendarLeave[];
  /** Emphasise chips — used by the self view where every leave is the viewer's. */
  highlight?: boolean;
  /** Chips shown per day before collapsing into "+N more". */
  maxPerDay?: number;
}

/**
 * Sunday-first month grid with one chip per leave. Purely presentational — the
 * caller owns the data and the month.
 */
export function LeaveMonthGrid({ year, month, leaves, highlight = false, maxPerDay = 2 }: LeaveMonthGridProps) {
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);
  const today = new Date();

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
        ))}
      </div>

      <div className="divide-y divide-border">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 divide-x divide-border">
            {week.map((date) => {
              const iso = isoDate(date);
              const inMonth = date.getMonth() === month;
              const isToday = sameDay(date, today);
              const dayLeaves = leavesOnDay(leaves, iso);
              const shown = dayLeaves.slice(0, maxPerDay);
              const hidden = dayLeaves.length - shown.length;

              return (
                <div key={iso} className={`min-h-[94px] p-1.5 ${inMonth ? "bg-card" : "bg-muted/20"}`}>
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] ${
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : inMonth
                            ? "text-foreground"
                            : "text-muted-foreground/50"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {dayLeaves.length > 0 && (
                      <span className="text-[9px] text-muted-foreground">{dayLeaves.length}</span>
                    )}
                  </div>

                  <div className="mt-1 space-y-1">
                    {shown.map((leave) => (
                      <div
                        key={leave.id}
                        title={`${leave.employee_name} · ${leave.leave_type} (${leave.start_date} → ${leave.end_date})`}
                        className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${leaveTypeStyle(leave.leave_type)} ${
                          highlight ? "ring-1 ring-primary/50" : ""
                        }`}
                      >
                        {leave.employee_name}
                      </div>
                    ))}
                    {hidden > 0 && (
                      <div
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={dayLeaves.slice(maxPerDay).map((l) => l.employee_name).join(", ")}
                      >
                        +{hidden} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaveCalendarPanel() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [leaves, setLeaves] = useState<CalendarLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { from, to } = monthBounds(year, month);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcError } = await (supabase as any).rpc("leave_calendar", { _from: from, _to: to });

    if (rpcError) {
      setError(rpcError.message);
      setLeaves([]);
    } else {
      const rows = (data as LeaveCalendarRow[] | null) ?? [];
      setLeaves(
        rows
          .filter((row) => row.start_date && row.end_date)
          .map((row) => ({
            id: row.request_id ?? `${row.employee_profile_id ?? "leave"}-${row.start_date}`,
            employee_name: row.employee_name || "Unknown",
            leave_type: row.leave_type || "Leave",
            start_date: row.start_date as string,
            end_date: row.end_date as string,
            days: row.days ?? 0,
            status: row.status || "approved",
          })),
      );
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => { void load(); }, [load]);

  const shift = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // Legend only lists the leave types actually present this month, so it never
  // shows a colour for leave nobody is on.
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const leave of leaves) {
      const key = leave.leave_type.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, leave.leave_type);
    }
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [leaves]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{monthLabel}</h2>
          <Badge variant="outline" className="text-[11px]">{leaves.length} on leave</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
          >
            Today
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      {loading ? (
        <PageLoader />
      ) : (
        <>
          <LeaveMonthGrid year={year} month={month} leaves={leaves} />

          {leaves.length === 0 ? (
            <p className="text-xs text-muted-foreground">No approved leave falls in this month.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {legend.map(({ key, label }) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`h-2.5 w-2.5 rounded-full ${leaveTypeStyle(key).split(" ")[0]}`} />
                  <span className="capitalize">{label}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default LeaveCalendarPanel;

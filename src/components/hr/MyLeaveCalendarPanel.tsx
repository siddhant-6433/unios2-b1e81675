// Employee self-service leave calendar — the block embedded in My HR.
//
// Resolves the signed-in user's employee record the same implicit way
// MyPerformancePanel does (via employee_profiles.user_id), so MyHr can render
// it without props. Only the person's own *approved* leave is read, and only
// for the current year, so the grid always reflects time off that actually
// happened. Read-only: applying for leave stays in MyHr's own leave tab.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ChevronLeft, ChevronRight, Palmtree } from "lucide-react";
import { LeaveMonthGrid } from "@/components/hr/LeaveCalendarPanel";
import { isoDate, type CalendarLeave } from "@/lib/leaveCalendar";

interface Me {
  id: string;
  display_name: string | null;
}

interface LeaveRow {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
}

const LEAVE_TONE: Record<string, string> = {
  casual: "bg-pastel-blue text-foreground/80",
  sick: "bg-pastel-red text-foreground/80",
  earned: "bg-pastel-green text-foreground/80",
  privilege: "bg-pastel-green text-foreground/80",
  unpaid: "bg-pastel-yellow text-foreground/80",
  lwp: "bg-pastel-orange text-foreground/80",
};

const toneFor = (leaveType: string): string =>
  LEAVE_TONE[leaveType.trim().toLowerCase().split(/[\s/_-]/)[0]] ?? "bg-pastel-purple text-foreground/80";

const fmtDay = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function MyLeaveCalendarPanel() {
  const { user } = useAuth();
  const today = new Date();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [leaves, setLeaves] = useState<CalendarLeave[]>([]);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const { data: profile } = await supabase
      .from("employee_profiles")
      .select("id, display_name")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const mine = (profile as Me) ?? null;
    setMe(mine);

    const { data } = await supabase
      .from("employee_leave_requests")
      .select("id, leave_type, start_date, end_date, days, status")
      .eq("user_id", user.id)
      .eq("status", "approved")
      // Overlap the year rather than start inside it, so a leave spanning
      // New Year still shows on the January grid.
      .gte("end_date", yearStart)
      .lte("start_date", yearEnd)
      .order("start_date");

    const name = mine?.display_name || "You";
    setLeaves(
      ((data as LeaveRow[] | null) ?? [])
        .filter((row) => row.start_date && row.end_date)
        .map((row) => ({
          id: row.id,
          employee_name: name,
          leave_type: row.leave_type,
          start_date: row.start_date,
          end_date: row.end_date,
          days: row.days,
          status: row.status,
        })),
    );
    setLoading(false);
  }, [user?.id, year]);

  useEffect(() => { void load(); }, [load]);

  const todayIso = isoDate(today);
  const upcoming = useMemo(
    () =>
      leaves
        .filter((leave) => leave.end_date >= todayIso)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .slice(0, 6),
    [leaves, todayIso],
  );

  const shift = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  if (loading) return <PageLoader />;

  if (!me) {
    return (
      <div className="rounded-xl bg-card card-shadow px-4 py-12 text-center">
        <p className="text-sm text-foreground">No employee profile linked</p>
        <p className="text-xs text-muted-foreground mt-1">
          Your leave calendar appears once HR links your account to an employee record.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{monthLabel}</h2>
          <Badge variant="outline" className="text-[11px]">{leaves.length} approved this year</Badge>
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

      <LeaveMonthGrid year={year} month={month} leaves={leaves} highlight />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Palmtree className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Upcoming approved leave</h3>
        </div>

        {upcoming.length === 0 ? (
          <div className="rounded-xl bg-card card-shadow px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No upcoming approved leave.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
            {upcoming.map((leave) => (
              <div key={leave.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Badge className={`border-0 text-[10px] capitalize ${toneFor(leave.leave_type)}`}>
                  {leave.leave_type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {fmtDay(leave.start_date)}
                    {leave.start_date !== leave.end_date && ` → ${fmtDay(leave.end_date)}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{leave.days} day{leave.days === 1 ? "" : "s"}</p>
                </div>
                {leave.start_date <= todayIso && leave.end_date >= todayIso && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/40">On leave now</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MyLeaveCalendarPanel;

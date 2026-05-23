/**
 * Visit operations dashboard — surfaced as its own section beneath the
 * Lead Pipeline funnel. Three actionable cards:
 *
 *   1. Scheduled visits   — count of upcoming `campus_visits` in 'scheduled'
 *      status. Subtitle splits today vs. this week so the counsellor knows
 *      what's imminent.
 *   2. Check-in pending   — visits whose `visit_date` has passed but
 *      `status` is still 'scheduled' (visitor likely arrived, no check-in
 *      logged). These are the candidates to chase or mark no-show.
 *   3. Post-visit follow-up — direct count from the existing
 *      `post_visit_pending_followups` view (visit done + no follow-up logged).
 *
 * Clicking a card invokes the host page's action handler so the leads
 * table below filters to the matching cohort. Exception: the Missed
 * Callbacks card opens /missed-calls in a new tab instead — that page
 * has bespoke per-row actions (Cloud Call & Close) that the in-page
 * admissions list can't express.
 */

import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, DoorOpen, ArrowRight, PhoneMissed, CheckCircle2, ClockAlert } from "lucide-react";

export type VisitAction =
  | "missed_callbacks" | "overdue_followups"
  | "scheduled" | "checkin_pending" | "visits_completed";

interface Props {
  counts: {
    /** Overdue lead_followups whose type is a callback (`call`,
     *  `human_callback`, `ai_callback`) — counsellor missed the call. */
    missedCallbacks: number;
    /** Overdue lead_followups whose type is NOT a callback (e.g. `visit`) —
     *  scheduled non-call tasks that slipped. Disjoint from missedCallbacks. */
    overdueFollowups: number;
    scheduled: number;
    scheduledToday: number;
    scheduledThisWeek: number;
    checkinPending: number;
    /** Total completed campus_visits in the last 14 days. */
    visitsCompleted: number;
    /** Of those, how many still need a post-visit follow-up
     *  (rows in `post_visit_pending_followups`). */
    visitsCompletedPendingFollowup: number;
  };
  active: VisitAction | null;
  onClick: (a: VisitAction | null) => void;
}

const tile = (active: boolean, tint: string, ring: string) =>
  `rounded-2xl border transition-all cursor-pointer ${
    active
      ? `${tint} ring-2 ${ring} border-transparent`
      : "border-border/40 bg-card hover:bg-muted/30 hover:border-border"
  }`;

export function VisitActionCenter({ counts, active, onClick }: Props) {
  const cards: Array<{
    key: VisitAction;
    label: string;
    value: number;
    sub: string;
    icon: any;
    iconBg: string;
    iconColor: string;
    tint: string;
    ring: string;
    pulse?: boolean;
    /** If set, the card renders as an <a> opening this URL in a new tab
     *  instead of in-page filtering via onClick. Used for cohorts that
     *  have their own dedicated page with bespoke actions (e.g. Cloud
     *  Call & Close on /missed-calls). */
    href?: string;
  }> = [
    {
      key: "missed_callbacks",
      label: "Missed Callbacks",
      value: counts.missedCallbacks,
      sub: counts.missedCallbacks === 0
        ? "no missed incoming calls"
        : "inbound calls · not picked up · call back",
      icon: PhoneMissed,
      iconBg: "bg-rose-100",
      iconColor: "text-rose-600",
      tint: "bg-rose-50/60",
      ring: "ring-rose-400",
      pulse: counts.missedCallbacks > 0,
      href: "/missed-calls",
    },
    {
      key: "overdue_followups",
      label: "Overdue Follow-ups",
      value: counts.overdueFollowups,
      sub: counts.overdueFollowups === 0
        ? "no overdue tasks"
        : "scheduled tasks + AI calls needing follow-up",
      icon: ClockAlert,
      iconBg: "bg-orange-100",
      iconColor: "text-orange-600",
      tint: "bg-orange-50/60",
      ring: "ring-orange-400",
      pulse: counts.overdueFollowups > 0,
    },
    {
      key: "scheduled",
      label: "Scheduled Visits",
      value: counts.scheduled,
      sub: counts.scheduled === 0
        ? "no upcoming visits"
        : `${counts.scheduledToday} today · ${counts.scheduledThisWeek} this week`,
      icon: CalendarDays,
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      tint: "bg-blue-50/60",
      ring: "ring-blue-400",
    },
    {
      key: "checkin_pending",
      label: "Check-in Pending",
      value: counts.checkinPending,
      sub: counts.checkinPending === 0
        ? "all visits checked in"
        : "visit time passed · mark in / no-show",
      icon: DoorOpen,
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      tint: "bg-amber-50/60",
      ring: "ring-amber-400",
      pulse: counts.checkinPending > 0,
    },
    {
      key: "visits_completed",
      label: "Visits Completed",
      value: counts.visitsCompleted,
      sub: counts.visitsCompleted === 0
        ? "no recent visits"
        : counts.visitsCompletedPendingFollowup > 0
          ? `last 14d · ${counts.visitsCompletedPendingFollowup} need follow-up`
          : "last 14d · all followed up",
      icon: CheckCircle2,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      tint: "bg-emerald-50/60",
      ring: "ring-emerald-400",
      pulse: counts.visitsCompletedPendingFollowup > 0,
    },
  ];

  return (
    <Card className="rounded-2xl border-border/40 shadow-none">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-sm font-semibold text-foreground">Counsellor Action Center</h2>
          <span className="text-xs text-muted-foreground">callbacks · visits · check-ins · follow-ups</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((c) => {
            const Icon = c.icon;
            const isActive = active === c.key;
            const cls = `${tile(isActive, c.tint, c.ring)} ${
              c.pulse && !isActive ? "ring-1 ring-offset-0 ring-rose-200/0 [&_.pulse]:animate-pulse" : ""
            } p-4 text-left block`;
            const body = (
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center shrink-0 ${c.pulse ? "pulse" : ""}`}>
                  <Icon className={`h-[18px] w-[18px] ${c.iconColor}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-2xl font-bold text-foreground leading-none tracking-tight tabular-nums">{c.value}</p>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground" />
                  </div>
                  <p className="text-[11px] font-medium text-foreground/90 mt-1.5">{c.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.sub}</p>
                </div>
              </div>
            );
            if (c.href) {
              return (
                <a
                  key={c.key}
                  href={c.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cls}
                  title="Opens the dedicated Missed Calls page in a new tab — each entry has a Cloud Call & Close action that places the call and clears it from the queue"
                >
                  {body}
                </a>
              );
            }
            return (
              <button
                key={c.key}
                onClick={() => onClick(isActive ? null : c.key)}
                className={cls}
              >
                {body}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

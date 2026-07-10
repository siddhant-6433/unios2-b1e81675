/**
 * Visit-track funnel for the /admissions page — the second pipeline branching
 * off Leads. Same UX as LeadPipeline, but:
 *   • Sourced from campus_visits (via the visit_funnel_leads view), NOT
 *     leads.stage — so a visited lead stays counted no matter where its stage
 *     moves (the spine funnel can't see visits; this one can).
 *   • Lead-centric: one lead per box, at its latest visit state (reschedule →
 *     Scheduled, repeat visits don't double-count).
 *   • Single-hue teal ramp so it reads as a distinct track from the spine's
 *     multi-hue stage colors (design review Dz4).
 *   • Conversion % between boxes is suppressed when the prior box count is
 *     below VISIT_CONV_MIN_DENOMINATOR — at low volume a single lead swings it
 *     wildly and reads as failure (Dz3).
 *   • No-show / cancelled shown as a rose "dropped" chip, not a box (Dz2).
 *   • Empty state with a CTA instead of an all-zeros funnel (Dz2).
 *   • Display + click-to-filter (Dz6): clicking a box filters the lead list to
 *     leads in that visit state.
 */

import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight, CalendarClock, CalendarCheck, MapPin, PhoneCall,
  FileText, GraduationCap, XCircle, CalendarPlus,
} from "lucide-react";
import {
  type VisitFunnelStage,
  VISIT_FUNNEL_ORDER,
  VISIT_FUNNEL_LABEL,
  VISIT_CONV_MIN_DENOMINATOR,
} from "@/lib/leadStages";

// Single-hue teal/emerald ramp (light → dark) — one coherent "visit track".
// Count text stays foreground (#1a1a1a-equivalent) for ≥4.5:1 on every tint.
const META: Record<VisitFunnelStage, {
  label: string; icon: any; iconBg: string; iconColor: string; tint: string; ring: string; bar: string;
}> = {
  scheduled:      { label: VISIT_FUNNEL_LABEL.scheduled,      icon: CalendarClock, iconBg: "bg-teal-50",  iconColor: "text-teal-600", tint: "bg-teal-50/70",  ring: "ring-teal-300",  bar: "bg-teal-300" },
  confirmed:      { label: VISIT_FUNNEL_LABEL.confirmed,      icon: CalendarCheck, iconBg: "bg-teal-100", iconColor: "text-teal-700", tint: "bg-teal-100/70", ring: "ring-teal-400",  bar: "bg-teal-400" },
  completed:      { label: VISIT_FUNNEL_LABEL.completed,      icon: MapPin,        iconBg: "bg-teal-100", iconColor: "text-teal-700", tint: "bg-teal-100/80", ring: "ring-teal-500",  bar: "bg-teal-500" },
  visit_followup: { label: VISIT_FUNNEL_LABEL.visit_followup, icon: PhoneCall,     iconBg: "bg-success/10", iconColor: "text-success", tint: "bg-success/10/70", ring: "ring-emerald-500", bar: "bg-success/50" },
  applied:        { label: VISIT_FUNNEL_LABEL.applied,        icon: FileText,      iconBg: "bg-success/10", iconColor: "text-success", tint: "bg-success/10/80", ring: "ring-emerald-600", bar: "bg-success" },
  admitted:       { label: VISIT_FUNNEL_LABEL.admitted,       icon: GraduationCap, iconBg: "bg-success/15", iconColor: "text-success-foreground", tint: "bg-success/15/80", ring: "ring-emerald-700", bar: "bg-success/90" },
};

const conversionTone = (pct: number | null) => {
  if (pct == null) return "text-muted-foreground bg-muted/40 border-border/40";
  if (pct >= 90)   return "text-success bg-success/5 border-success/20";
  if (pct >= 70)   return "text-warning-foreground bg-warning/5 border-warning/20";
  return "text-destructive bg-destructive/5 border-destructive/20";
};

interface Props {
  /** {funnel_box → count} for the 6 visit boxes (from visit_funnel_leads). */
  counts: Record<VisitFunnelStage, number>;
  /** Leads whose latest visit is no_show / cancelled. */
  leakageCount: number;
  activeBox: VisitFunnelStage | "leakage" | null;
  onBoxClick: (box: VisitFunnelStage | "leakage" | null) => void;
  /** Fired from the empty-state CTA (e.g. open the global lead search / dialer). */
  onScheduleVisit?: () => void;
}

export function VisitPipeline({ counts, leakageCount, activeBox, onBoxClick, onScheduleVisit }: Props) {
  const bucket = VISIT_FUNNEL_ORDER.reduce((acc, b) => { acc[b] = counts[b] || 0; return acc; }, {} as Record<VisitFunnelStage, number>);

  // Cumulative reach = leads at this box OR further along.
  const reached = {} as Record<VisitFunnelStage, number>;
  {
    let cum = 0;
    for (let i = VISIT_FUNNEL_ORDER.length - 1; i >= 0; i--) {
      cum += bucket[VISIT_FUNNEL_ORDER[i]];
      reached[VISIT_FUNNEL_ORDER[i]] = cum;
    }
  }
  const total = reached[VISIT_FUNNEL_ORDER[0]];

  // Empty state — no visits at all (Dz2). An all-zeros funnel reads as broken.
  if (total === 0 && leakageCount === 0) {
    return (
      <Card className="rounded-2xl border-border/40 shadow-none">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">Visit Pipeline</h2>
              <span className="text-xs text-muted-foreground">branches from Leads · campus visits</span>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
              <MapPin className="h-5 w-5 text-teal-600" />
            </div>
            <p className="text-sm font-medium text-foreground">No campus visits scheduled yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">When you schedule a visit from a lead, it shows up here and flows through to admission.</p>
            {onScheduleVisit && (
              <button
                onClick={onScheduleVisit}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition-colors"
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Schedule a visit
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-border/40 shadow-none">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">Visit Pipeline</h2>
            <span className="text-xs text-muted-foreground">
              branches from Leads · {total.toLocaleString("en-IN")} visited · click a stage to filter
            </span>
          </div>
          {leakageCount > 0 && (
            <button
              onClick={() => onBoxClick(activeBox === "leakage" ? null : "leakage")}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                activeBox === "leakage"
                  ? "border-destructive/30 bg-destructive/10 text-destructive ring-2 ring-rose-300"
                  : "border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10"
              }`}
              title="Leads whose latest visit was a no-show or cancellation"
            >
              <XCircle className="h-3.5 w-3.5" />
              {leakageCount.toLocaleString("en-IN")} no-show
            </button>
          )}
        </div>

        <div className="flex items-stretch gap-1.5 overflow-x-auto py-1.5 -my-1.5 px-1 -mx-1">
          {VISIT_FUNNEL_ORDER.map((box, i) => {
            const meta = META[box];
            const Icon = meta.icon;
            const r = reached[box];
            const stuck = bucket[box];
            const prev = i > 0 ? reached[VISIT_FUNNEL_ORDER[i - 1]] : null;
            // Dz3: suppress conversion % when the denominator is too small.
            const conv = prev != null && prev >= VISIT_CONV_MIN_DENOMINATOR
              ? Math.round((r / prev) * 100)
              : null;
            const isActive = activeBox === box;
            const widthBasis = total > 0 ? Math.max(124, (r / total) * 220) : 124;
            const reachPct = total > 0 ? (r / total) * 100 : 0;

            return (
              <Fragment key={box}>
                {i > 0 && (
                  <div className="flex flex-col items-center justify-center shrink-0 self-center">
                    <div className={`text-[10px] font-semibold rounded-md border px-1.5 py-0.5 leading-tight ${conversionTone(conv)}`}>
                      {conv != null ? `${conv}%` : "—"}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5" />
                  </div>
                )}
                <button
                  onClick={() => onBoxClick(isActive ? null : box)}
                  className={`group relative rounded-xl border transition-all text-left p-3 shrink-0 overflow-hidden ${
                    isActive
                      ? `${meta.tint} ring-2 ${meta.ring} border-transparent`
                      : "border-border/50 bg-card hover:bg-muted/30 hover:border-border"
                  }`}
                  style={{ flex: `0 0 ${widthBasis}px`, width: widthBasis }}
                  title={`${stuck.toLocaleString("en-IN")} currently at ${meta.label} · ${r.toLocaleString("en-IN")} reached this stage or beyond`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                    <div className={`w-6 h-6 rounded-lg ${meta.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-3 w-3 ${meta.iconColor}`} />
                    </div>
                    <p className="whitespace-nowrap text-xl font-bold text-foreground leading-none tracking-tight tabular-nums">{stuck.toLocaleString("en-IN")}</p>
                  </div>
                  <p className="text-[11px] font-medium text-foreground/80 truncate">{meta.label}</p>
                  <div className="mt-2 h-1 rounded-full bg-muted/60 overflow-hidden">
                    <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${reachPct}%` }} />
                  </div>
                  <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground/70">{r.toLocaleString("en-IN")}</span> reached
                  </p>
                </button>
              </Fragment>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

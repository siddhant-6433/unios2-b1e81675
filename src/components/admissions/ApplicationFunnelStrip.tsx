/**
 * Compact Application Pipeline funnel — the same mutually-exclusive,
 * furthest-stage-reached model used on /applications, packaged as a reusable
 * strip so surfaces like the academic-partner portal can show the counsellor
 * funnel scoped to their own candidates.
 *
 *   • Each candidate lands in EXACTLY ONE bucket (furthest stage reached) so
 *     the counts never overlap.
 *   • Big number per box = currently-stuck-here count (matches the click
 *     filter).
 *   • Box width is proportional to cumulative reach so the funnel narrows
 *     left-to-right.
 *   • Conversion % on each arrow, colored ≥90 green, ≥70 amber, <70 rose.
 */

import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight, Clock, CheckCircle, CreditCard, ClipboardCheck,
  Gift, Wallet, UserCheck, GraduationCap,
} from "lucide-react";
import {
  APPLICATION_FUNNEL_ORDER,
  applicationFunnelStageOf,
  type ApplicationFunnelInput,
  type ApplicationFunnelStage,
} from "@/lib/applicationFunnel";

const FUNNEL_META: Record<ApplicationFunnelStage, {
  label: string; icon: any;
  iconBg: string; iconColor: string; tint: string; ring: string; bar: string;
}> = {
  in_progress:  { label: "In Progress",   icon: Clock,          iconBg: "bg-warning/10",   iconColor: "text-warning-foreground",   tint: "bg-warning/5/60",   ring: "ring-amber-400",   bar: "bg-warning/40" },
  submitted:    { label: "Submitted",     icon: CheckCircle,    iconBg: "bg-primary/10",  iconColor: "text-primary",  tint: "bg-primary/5/60",  ring: "ring-violet-400",  bar: "bg-primary/40" },
  paid:         { label: "Paid",          icon: CreditCard,     iconBg: "bg-success/10", iconColor: "text-success", tint: "bg-success/5/60", ring: "ring-emerald-400", bar: "bg-success/50" },
  approved:     { label: "Pending Offer", icon: ClipboardCheck, iconBg: "bg-warning/10",  iconColor: "text-warning-foreground",  tint: "bg-warning/5/60",  ring: "ring-orange-400",  bar: "bg-warning/50" },
  offer_sent:   { label: "Offer Sent",    icon: Gift,           iconBg: "bg-teal-100",    iconColor: "text-teal-600",    tint: "bg-teal-50/60",    ring: "ring-teal-400",    bar: "bg-teal-400" },
  token_paid:   { label: "Token Paid",    icon: Wallet,         iconBg: "bg-cyan-100",    iconColor: "text-cyan-600",    tint: "bg-cyan-50/60",    ring: "ring-cyan-400",    bar: "bg-cyan-400" },
  pre_admitted: { label: "Pre-Admitted",  icon: UserCheck,      iconBg: "bg-primary/10",  iconColor: "text-primary",  tint: "bg-primary/5/60",  ring: "ring-indigo-400",  bar: "bg-primary/40" },
  admitted:     { label: "Admitted",      icon: GraduationCap,  iconBg: "bg-success/10",   iconColor: "text-success",   tint: "bg-success/5/60",   ring: "ring-green-400",   bar: "bg-success/50" },
};

const conversionTone = (pct: number | null) => {
  if (pct == null) return "text-muted-foreground bg-muted/40 border-border/40";
  if (pct >= 90)   return "text-success bg-success/5 border-success/20";
  if (pct >= 70)   return "text-warning-foreground bg-warning/5 border-warning/20";
  return "text-destructive bg-destructive/5 border-destructive/20";
};

interface Props {
  /** Application-like rows already scoped to the surface (e.g. a partner's
   *  own candidates). Each is bucketed into exactly one funnel stage. */
  items: ApplicationFunnelInput[];
  /** Currently-active funnel filter, or null for no filter. */
  activeStage: ApplicationFunnelStage | null;
  /** Click handler — pass the stage to toggle, or null to clear. */
  onStageClick: (stage: ApplicationFunnelStage | null) => void;
}

export function ApplicationFunnelStrip({ items, activeStage, onStageClick }: Props) {
  const total = items.length;

  const stageBucket: Record<ApplicationFunnelStage, number> = {
    in_progress: 0, submitted: 0, paid: 0, approved: 0,
    offer_sent: 0, token_paid: 0, pre_admitted: 0, admitted: 0,
  };
  for (const item of items) stageBucket[applicationFunnelStageOf(item)]++;

  const stageReached: Record<ApplicationFunnelStage, number> = {} as Record<ApplicationFunnelStage, number>;
  let cum = total;
  for (const stage of APPLICATION_FUNNEL_ORDER) {
    stageReached[stage] = cum;
    cum -= stageBucket[stage];
  }

  return (
    <Card className="rounded-2xl border-border/40 shadow-none">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-sm font-semibold text-foreground">Application Pipeline</h2>
          <span className="text-xs text-muted-foreground">{total} total · big number = currently at stage · click to filter</span>
        </div>

        <div className="flex items-stretch gap-1.5 overflow-x-auto py-1.5 -my-1.5 px-1 -mx-1">
          {APPLICATION_FUNNEL_ORDER.map((stage, i) => {
            const meta = FUNNEL_META[stage];
            const Icon = meta.icon;
            const reached = stageReached[stage];
            const stuck = stageBucket[stage];
            const prevReached = i > 0 ? stageReached[APPLICATION_FUNNEL_ORDER[i - 1]] : null;
            const conversion = prevReached != null && prevReached > 0
              ? Math.round((reached / prevReached) * 100)
              : null;
            const isActive = activeStage === stage;
            const widthBasis = total > 0 ? Math.max(124, (reached / total) * 220) : 124;
            const reachPct = total > 0 ? (reached / total) * 100 : 0;

            return (
              <Fragment key={stage}>
                {i > 0 && (
                  <div className="flex flex-col items-center justify-center shrink-0 self-center">
                    <div className={`text-[10px] font-semibold rounded-md border px-1.5 py-0.5 leading-tight ${conversionTone(conversion)}`}>
                      {conversion != null ? `${conversion}%` : "—"}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onStageClick(isActive ? null : stage)}
                  className={`group relative rounded-xl border transition-all text-left p-3 shrink-0 overflow-hidden ${
                    isActive
                      ? `${meta.tint} ring-2 ${meta.ring} border-transparent`
                      : "border-border/50 bg-card hover:bg-muted/30 hover:border-border"
                  }`}
                  style={{ flex: `0 0 ${widthBasis}px`, width: widthBasis }}
                  title={`${stuck} currently at ${meta.label} · ${reached} reached this stage or beyond`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                    <div className={`w-6 h-6 rounded-lg ${meta.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-3 w-3 ${meta.iconColor}`} />
                    </div>
                    <p className="whitespace-nowrap text-xl font-bold text-foreground leading-none tracking-tight tabular-nums">{stuck}</p>
                  </div>
                  <p className="text-[11px] font-medium text-foreground/80 truncate">{meta.label}</p>
                  <div className="mt-2 h-1 rounded-full bg-muted/60 overflow-hidden">
                    <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${reachPct}%` }} />
                  </div>
                  <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground/70">{reached}</span> reached
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

/**
 * Lead-pipeline funnel for the /admissions page — same UX as the
 * Application Pipeline on /applications:
 *   • Each lead lands in EXACTLY ONE funnel bucket (the furthest stage
 *     reached) so the counts never overlap.
 *   • Big number in each box = stuck-here bucket count (matches what you
 *     get when you click the box).
 *   • Box width is proportional to cumulative reach so the funnel narrows
 *     left-to-right.
 *   • Conversion % on each arrow, colored ≥90 green, ≥70 amber, <70 rose.
 *   • Concise "hot leads" + leakage pills below the funnel.
 *
 * Visits do NOT live on the funnel — they're surfaced separately by
 * VisitActionCenter as their own operational dashboard.
 */

import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight, Users, Phone, Flame, FileText, ClipboardCheck, Gift,
  GraduationCap, AlertCircle, XCircle,
} from "lucide-react";
// Stage model is canonical in src/lib/leadStages.ts — do not redefine here.
import {
  type LeadFunnelStage,
  LEAD_FUNNEL_ORDER,
  STAGE_TO_BUCKET,
  FUNNEL_LEAKAGE_STAGES as LEAKAGE_STAGES,
  type FunnelLeakageStage as LeakageStage,
  FUNNEL_LEAKAGE_LABEL as LEAKAGE_LABEL,
  leadStagesForBucket,
} from "@/lib/leadStages";

export type { LeadFunnelStage };
export { leadStagesForBucket };

const META: Record<LeadFunnelStage, {
  label: string; icon: any;
  iconBg: string; iconColor: string; tint: string; ring: string; bar: string;
}> = {
  untouched: { label: "Untouched", icon: Users,           iconBg: "bg-slate-100",   iconColor: "text-slate-600",   tint: "bg-slate-50/60",   ring: "ring-slate-400",   bar: "bg-slate-400" },
  contacted: { label: "Contacted", icon: Phone,           iconBg: "bg-info/10",    iconColor: "text-info-foreground",    tint: "bg-info/5/60",    ring: "ring-blue-400",    bar: "bg-info/40" },
  hot:       { label: "Hot",       icon: Flame,           iconBg: "bg-warning/10",   iconColor: "text-warning-foreground",   tint: "bg-warning/5/60",   ring: "ring-amber-400",   bar: "bg-warning/40" },
  applied:   { label: "Applied",   icon: FileText,        iconBg: "bg-primary/10",  iconColor: "text-primary",  tint: "bg-primary/5/60",  ring: "ring-violet-400",  bar: "bg-primary/40" },
  approved:  { label: "Pending Offer", icon: ClipboardCheck, iconBg: "bg-warning/10", iconColor: "text-warning-foreground", tint: "bg-warning/5/60", ring: "ring-orange-400", bar: "bg-warning/50" },
  offered:   { label: "Offered",   icon: Gift,            iconBg: "bg-teal-100",    iconColor: "text-teal-600",    tint: "bg-teal-50/60",    ring: "ring-teal-400",    bar: "bg-teal-400" },
  admitted:  { label: "Admitted",  icon: GraduationCap,   iconBg: "bg-success/10",   iconColor: "text-success",   tint: "bg-success/5/60",   ring: "ring-green-400",   bar: "bg-success/50" },
};

const conversionTone = (pct: number | null) => {
  if (pct == null) return "text-muted-foreground bg-muted/40 border-border/40";
  if (pct >= 90)   return "text-success bg-success/5 border-success/20";
  if (pct >= 70)   return "text-warning-foreground bg-warning/5 border-warning/20";
  return "text-destructive bg-destructive/5 border-destructive/20";
};

interface Props {
  /** Raw {lead_stage → count} map across the whole org (or scoped if you pass
   *  scoped data). */
  stageCounts: Record<string, number>;
  /** Leads in `counsellor_call` / `ai_called` whose latest call disposition
   *  is 'interested' — promoted out of Contacted into Hot so the funnel
   *  reflects the strongest signal of intent. */
  extraHot?: number;
  /** Currently-active funnel filter, or null for no filter. */
  activeStage: LeadFunnelStage | "leakage" | null;
  /** Click handler — pass the bucket key or null to clear. */
  onStageClick: (stage: LeadFunnelStage | "leakage" | null) => void;
  /** Split of new_lead rows by counsellor assignment. */
  newLeadAssignmentCounts?: {
    assigned: number;
    unassigned: number;
    unassigned_ai_called?: number;
    unassigned_not_ai_called?: number;
  };
  /** Active assigned/unassigned untouched filter, or null for no split filter. */
  activeNewLeadAssignment?: "assigned" | "unassigned" | null;
  /** Click handler for the assigned/unassigned untouched split. */
  onNewLeadAssignmentClick?: (assignment: "assigned" | "unassigned" | null) => void;
}

export function LeadPipeline({
  stageCounts,
  extraHot = 0,
  activeStage,
  onStageClick,
  newLeadAssignmentCounts,
  activeNewLeadAssignment = null,
  onNewLeadAssignmentClick,
}: Props) {
  // Bucket counts by collapsing raw lead_stage rows into the 7 funnel keys.
  const bucket: Record<LeadFunnelStage, number> = {
    untouched: 0, contacted: 0, hot: 0, applied: 0, approved: 0, offered: 0, admitted: 0,
  };
  for (const [stage, count] of Object.entries(stageCounts)) {
    const b = STAGE_TO_BUCKET[stage];
    if (b) bucket[b] += count;
  }
  // Promote 'interested via call disposition' leads out of Contacted into
  // Hot so the funnel reflects the stronger intent signal.
  const promoted = Math.min(extraHot, bucket.contacted);
  bucket.contacted -= promoted;
  bucket.hot       += promoted;

  // Cumulative reach = leads who landed at this stage OR a later one.
  // Iterating backwards keeps the running sum O(n).
  const reached: Record<LeadFunnelStage, number> = {} as any;
  {
    let cum = 0;
    for (let i = LEAD_FUNNEL_ORDER.length - 1; i >= 0; i--) {
      cum += bucket[LEAD_FUNNEL_ORDER[i]];
      reached[LEAD_FUNNEL_ORDER[i]] = cum;
    }
  }
  const total = reached.untouched; // = sum of all funnel buckets

  // Leakage chip aggregates not-interested / DNC / rejected / ineligible / deferred.
  const leakageByStage: Record<string, number> = {};
  let leakageTotal = 0;
  for (const s of LEAKAGE_STAGES) {
    const c = stageCounts[s] || 0;
    if (c > 0) leakageByStage[s] = c;
    leakageTotal += c;
  }
  const hotCount = bucket.hot;
  const untouchedSplit = newLeadAssignmentCounts ?? {
    assigned: bucket.untouched,
    unassigned: 0,
    unassigned_ai_called: 0,
    unassigned_not_ai_called: 0,
  };

  return (
    <Card className="rounded-2xl border-border/40 shadow-none">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-foreground">Lead Pipeline</h2>
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString("en-IN")} leads in funnel · click a stage to filter
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {hotCount > 0 && (
              <button
                onClick={() => onStageClick(activeStage === "hot" ? null : "hot")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                  activeStage === "hot"
                    ? "border-warning/30 bg-warning/10 text-warning-foreground ring-2 ring-amber-300"
                    : "border-warning/30 bg-warning/5 text-warning-foreground hover:bg-warning/10"
                }`}
                title="High-intent leads — counsellor-flagged"
              >
                <Flame className="h-3.5 w-3.5" />
                {hotCount.toLocaleString("en-IN")} hot
              </button>
            )}
            {leakageTotal > 0 && (
              <button
                onClick={() => onStageClick(activeStage === "leakage" ? null : "leakage")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                  activeStage === "leakage"
                    ? "border-destructive/30 bg-destructive/10 text-destructive ring-2 ring-rose-300"
                    : "border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10"
                }`}
                title={Object.entries(leakageByStage)
                  .map(([s, c]) => `${c} ${LEAKAGE_LABEL[s as LeakageStage]}`)
                  .join(" · ")}
              >
                <XCircle className="h-3.5 w-3.5" />
                {leakageTotal.toLocaleString("en-IN")} dropped
              </button>
            )}
          </div>
        </div>

        {/* py-1.5 -my-1.5 so the ring-2 on active boxes isn't cropped by the
            scroll container's enforced overflow-y clip. */}
        <div className="flex items-stretch gap-1.5 overflow-x-auto py-1.5 -my-1.5 px-1 -mx-1">
          {LEAD_FUNNEL_ORDER.map((stage, i) => {
            const meta = META[stage];
            const Icon = meta.icon;
            const r = reached[stage];
            const stuck = bucket[stage];
            const prev = i > 0 ? reached[LEAD_FUNNEL_ORDER[i - 1]] : null;
            const conv = prev != null && prev > 0 ? Math.round((r / prev) * 100) : null;
            const isActive = activeStage === stage;
            const widthBasis = total > 0 ? Math.max(124, (r / total) * 220) : 124;
            const untouchedWidth = Math.max(widthBasis + 112, 246);
            const reachPct = total > 0 ? (r / total) * 100 : 0;

            return (
              <Fragment key={stage}>
                {i > 0 && (
                  <div className="flex flex-col items-center justify-center shrink-0 self-center">
                    <div className={`text-[10px] font-semibold rounded-md border px-1.5 py-0.5 leading-tight ${conversionTone(conv)}`}>
                      {conv != null ? `${conv}%` : "—"}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5" />
                  </div>
                )}
                {stage === "untouched" ? (
                  <div
                    className="grid grid-cols-2 gap-1.5 shrink-0"
                    style={{ flex: `0 0 ${untouchedWidth}px`, width: untouchedWidth }}
                  >
                    {([
                      {
                        key: "unassigned" as const,
                        label: "Unassigned",
                        count: untouchedSplit.unassigned,
                        title: "new leads not assigned to a counsellor",
                        detail: `${(untouchedSplit.unassigned_ai_called ?? 0).toLocaleString("en-IN")} AI called / ${(untouchedSplit.unassigned_not_ai_called ?? 0).toLocaleString("en-IN")} not called`,
                      },
                      {
                        key: "assigned" as const,
                        label: "Assigned",
                        count: untouchedSplit.assigned,
                        title: "new leads assigned to counsellors",
                        detail: `${stuck.toLocaleString("en-IN")} total untouched`,
                      },
                    ]).map((part) => {
                      const partActive = activeNewLeadAssignment === part.key;
                      return (
                        <button
                          key={part.key}
                          onClick={() => onNewLeadAssignmentClick?.(partActive ? null : part.key)}
                          className={`group relative rounded-xl border transition-all text-left p-3 min-w-0 overflow-hidden ${
                            partActive
                              ? `${meta.tint} ring-2 ${meta.ring} border-transparent`
                              : "border-border/50 bg-card hover:bg-muted/30 hover:border-border"
                          }`}
                          title={`${part.count.toLocaleString("en-IN")} ${part.title}`}
                        >
                          <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                            <div className={`w-6 h-6 rounded-lg ${meta.iconBg} flex items-center justify-center shrink-0`}>
                              <Icon className={`h-3 w-3 ${meta.iconColor}`} />
                            </div>
                            <p className="whitespace-nowrap text-xl font-bold text-foreground leading-none tracking-tight tabular-nums">
                              {part.count.toLocaleString("en-IN")}
                            </p>
                          </div>
                          <p className="text-[11px] font-medium text-foreground/80 truncate">{part.label} untouched</p>
                          <div className="mt-2 h-1 rounded-full bg-muted/60 overflow-hidden">
                            <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${reachPct}%` }} />
                          </div>
                          <p className="mt-1.5 text-[10px] text-muted-foreground truncate">{part.detail}</p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    onClick={() => onStageClick(isActive ? null : stage)}
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
                )}
              </Fragment>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

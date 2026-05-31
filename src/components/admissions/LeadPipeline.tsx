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
  contacted: { label: "Contacted", icon: Phone,           iconBg: "bg-blue-100",    iconColor: "text-blue-600",    tint: "bg-blue-50/60",    ring: "ring-blue-400",    bar: "bg-blue-400" },
  hot:       { label: "Hot",       icon: Flame,           iconBg: "bg-amber-100",   iconColor: "text-amber-600",   tint: "bg-amber-50/60",   ring: "ring-amber-400",   bar: "bg-amber-400" },
  applied:   { label: "Applied",   icon: FileText,        iconBg: "bg-violet-100",  iconColor: "text-violet-600",  tint: "bg-violet-50/60",  ring: "ring-violet-400",  bar: "bg-violet-400" },
  approved:  { label: "Pending Offer", icon: ClipboardCheck, iconBg: "bg-orange-100", iconColor: "text-orange-600", tint: "bg-orange-50/60", ring: "ring-orange-400", bar: "bg-orange-400" },
  offered:   { label: "Offered",   icon: Gift,            iconBg: "bg-teal-100",    iconColor: "text-teal-600",    tint: "bg-teal-50/60",    ring: "ring-teal-400",    bar: "bg-teal-400" },
  admitted:  { label: "Admitted",  icon: GraduationCap,   iconBg: "bg-green-100",   iconColor: "text-green-600",   tint: "bg-green-50/60",   ring: "ring-green-400",   bar: "bg-green-400" },
};

const conversionTone = (pct: number | null) => {
  if (pct == null) return "text-muted-foreground bg-muted/40 border-border/40";
  if (pct >= 90)   return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (pct >= 70)   return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
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
}

export function LeadPipeline({ stageCounts, extraHot = 0, activeStage, onStageClick }: Props) {
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
                    ? "border-amber-400 bg-amber-100 text-amber-800 ring-2 ring-amber-300"
                    : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
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
                    ? "border-rose-400 bg-rose-100 text-rose-800 ring-2 ring-rose-300"
                    : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
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
            const widthBasis = total > 0 ? Math.max(96, (r / total) * 220) : 96;
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
                <button
                  onClick={() => onStageClick(isActive ? null : stage)}
                  className={`group relative rounded-xl border transition-all text-left p-3 shrink-0 ${
                    isActive
                      ? `${meta.tint} ring-2 ${meta.ring} border-transparent`
                      : "border-border/50 bg-card hover:bg-muted/30 hover:border-border"
                  }`}
                  style={{ flex: `1 1 ${widthBasis}px`, minWidth: 96 }}
                  title={`${stuck.toLocaleString("en-IN")} currently at ${meta.label} · ${r.toLocaleString("en-IN")} reached this stage or beyond`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-7 h-7 rounded-lg ${meta.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-3.5 w-3.5 ${meta.iconColor}`} />
                    </div>
                    <p className="text-2xl font-bold text-foreground leading-none tracking-tight">{stuck.toLocaleString("en-IN")}</p>
                  </div>
                  <p className="text-[11px] font-medium text-foreground/80 truncate">{meta.label}</p>
                  <div className="mt-2 h-1 rounded-full bg-muted/60 overflow-hidden">
                    <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${reachPct}%` }} />
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
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

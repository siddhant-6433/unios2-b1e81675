import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Calendar, TrendingUp, Users, Phone, FileText, GraduationCap,
} from "lucide-react";
import {
  startOfDay, endOfDay, startOfYesterday, endOfYesterday,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths,
} from "date-fns";

type DatePreset =
  | "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | "custom";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  this_month: "This Month",
  last_month: "Last Month",
  all: "All Time",
  custom: "Custom",
};

function dateRangeFor(preset: DatePreset, customStart?: string, customEnd?: string): [Date | null, Date | null] {
  const now = new Date();
  switch (preset) {
    case "today":      return [startOfDay(now), endOfDay(now)];
    case "yesterday":  return [startOfYesterday(), endOfYesterday()];
    case "this_week":  return [startOfWeek(now, { weekStartsOn: 1 }), endOfWeek(now, { weekStartsOn: 1 })];
    case "this_month": return [startOfMonth(now), endOfMonth(now)];
    case "last_month": { const lm = subMonths(now, 1); return [startOfMonth(lm), endOfMonth(lm)]; }
    case "custom":     return [
      customStart ? startOfDay(new Date(customStart)) : null,
      customEnd   ? endOfDay(new Date(customEnd))     : null,
    ];
    case "all":
    default:           return [null, null];
  }
}

interface LeadRow {
  source: string | null;
  stage: string;
  created_at: string;
}

// Friendly labels for the source values stored in DB
const SOURCE_LABELS: Record<string, string> = {
  collegehai: "CollegeHai",
  collegedunia: "CollegeDunia",
  justdial: "JustDial",
  salahlo: "Salahlo",
  website: "Website",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  mirai_website: "Mirai Website",
  other: "Other",
  consultant: "Consultant",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  reference: "Reference",
};
const labelFor = (s: string | null) => s ? (SOURCE_LABELS[s] || s) : "Unknown";

// Stage groupings — drives the funnel columns
const ENGAGED_STAGES = new Set([
  "ai_called", "counsellor_call", "application_in_progress", "application_fee_paid",
  "application_submitted", "visit_scheduled", "interview", "offer_sent",
  "token_paid", "pre_admitted", "admitted",
]);
const APP_STARTED_STAGES = new Set([
  "application_in_progress", "application_fee_paid", "application_submitted",
  "visit_scheduled", "interview", "offer_sent", "token_paid", "pre_admitted", "admitted",
]);
const APP_SUBMITTED_STAGES = new Set([
  "application_submitted", "visit_scheduled", "interview", "offer_sent",
  "token_paid", "pre_admitted", "admitted",
]);
const ADMITTED_STAGES = new Set(["admitted"]);

interface SourceMetrics {
  source: string | null;
  label: string;
  total: number;
  engaged: number;
  appStarted: number;
  submitted: number;
  admitted: number;
}

// Stage groupings as comma-separated lists for the Admissions URL stage filter,
// which accepts a comma-joined list of stages (see Admissions.tsx:486).
const ENGAGED_STAGES_PARAM   = Array.from(ENGAGED_STAGES).join(",");
const APP_STARTED_STAGES_PARAM = Array.from(APP_STARTED_STAGES).join(",");
const APP_SUBMITTED_PARAM    = Array.from(APP_SUBMITTED_STAGES).join(",");
const ADMITTED_PARAM         = Array.from(ADMITTED_STAGES).join(",");

function buildLeadListUrl(opts: {
  source: string | null;
  stages?: string;
  fromDate: Date | null;
  toDate: Date | null;
}): string {
  const p = new URLSearchParams();
  if (opts.source) p.set("source", opts.source);
  if (opts.stages) p.set("stage", opts.stages);
  if (opts.fromDate) p.set("from", opts.fromDate.toISOString().slice(0, 10));
  if (opts.toDate)   p.set("to",   opts.toDate.toISOString().slice(0, 10));
  return `/admissions?${p.toString()}`;
}

function pctClass(pct: number, kind: "engaged" | "submitted" | "admitted"): string {
  // Kind-aware thresholds — admission rates are naturally lower than engagement.
  const thresholds = kind === "admitted"
    ? { good: 5, warn: 1 }
    : kind === "submitted"
    ? { good: 15, warn: 5 }
    : { good: 50, warn: 25 };
  if (pct >= thresholds.good) return "text-emerald-700 bg-emerald-50";
  if (pct >= thresholds.warn) return "text-amber-700 bg-amber-50";
  return "text-rose-700 bg-rose-50";
}

export default function PublisherAnalytics() {
  const { role, roleLoaded } = useAuth();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortBy, setSortBy] = useState<"total" | "engaged_pct" | "submitted_pct" | "admitted_pct">("total");

  // Fetch leads on mount — paginate to bypass Supabase's default 1000 cap.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const PAGE = 1000;
      let all: LeadRow[] = [];
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("leads")
          .select("source, stage, created_at")
          .order("created_at", { ascending: false })
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) break;
        all = all.concat((data || []) as LeadRow[]);
        if ((data || []).length < PAGE) break;
        page++;
      }
      setLeads(all);
      setLoading(false);
    })();
  }, []);

  // Apply the date filter.
  const dateScopedLeads = useMemo(() => {
    const [start, end] = dateRangeFor(datePreset, customStart, customEnd);
    if (!start && !end) return leads;
    return leads.filter(l => {
      const t = new Date(l.created_at).getTime();
      if (start && t < start.getTime()) return false;
      if (end   && t > end.getTime())   return false;
      return true;
    });
  }, [leads, datePreset, customStart, customEnd]);

  // Aggregate by source.
  const metrics: SourceMetrics[] = useMemo(() => {
    const bySource = new Map<string | null, SourceMetrics>();
    for (const l of dateScopedLeads) {
      const key = l.source || null;
      let m = bySource.get(key);
      if (!m) {
        m = { source: key, label: labelFor(key), total: 0, engaged: 0, appStarted: 0, submitted: 0, admitted: 0 };
        bySource.set(key, m);
      }
      m.total++;
      if (ENGAGED_STAGES.has(l.stage))      m.engaged++;
      if (APP_STARTED_STAGES.has(l.stage))  m.appStarted++;
      if (APP_SUBMITTED_STAGES.has(l.stage)) m.submitted++;
      if (ADMITTED_STAGES.has(l.stage))     m.admitted++;
    }
    const out = Array.from(bySource.values());
    out.sort((a, b) => {
      const aPct = (n: number) => a.total > 0 ? n / a.total : 0;
      const bPct = (n: number) => b.total > 0 ? n / b.total : 0;
      switch (sortBy) {
        case "engaged_pct":   return bPct(b.engaged) - aPct(a.engaged);
        case "submitted_pct": return bPct(b.submitted) - aPct(a.submitted);
        case "admitted_pct":  return bPct(b.admitted) - aPct(a.admitted);
        default:              return b.total - a.total;
      }
    });
    return out;
  }, [dateScopedLeads, sortBy]);

  // Overall summary across all sources for the picked date range.
  const summary = useMemo(() => {
    const totals = metrics.reduce(
      (acc, m) => ({
        total: acc.total + m.total,
        engaged: acc.engaged + m.engaged,
        submitted: acc.submitted + m.submitted,
        admitted: acc.admitted + m.admitted,
      }),
      { total: 0, engaged: 0, submitted: 0, admitted: 0 },
    );
    return totals;
  }, [metrics]);

  if (!roleLoaded) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (role !== "super_admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-5 p-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Publisher Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Lead intake and conversion by source. Compare publishers side-by-side and spot which channels are pulling weight.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <select
              value={datePreset}
              onChange={e => setDatePreset(e.target.value as DatePreset)}
              className="rounded-xl border border-input bg-card pl-8 pr-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              {(Object.entries(DATE_PRESET_LABELS) as [DatePreset, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          {datePreset === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} max={customEnd || undefined}
                onChange={e => setCustomStart(e.target.value)}
                className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={customEnd} min={customStart || undefined}
                onChange={e => setCustomEnd(e.target.value)}
                className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm" />
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Leads"    value={summary.total}     Icon={Users}        iconBg="bg-blue-100"     iconColor="text-blue-600" />
        <SummaryCard label="Engaged"        value={summary.engaged}   Icon={Phone}        iconBg="bg-violet-100"   iconColor="text-violet-600"
          sub={summary.total ? `${Math.round((summary.engaged / summary.total) * 100)}% of leads` : undefined} />
        <SummaryCard label="Submitted Apps" value={summary.submitted} Icon={FileText}     iconBg="bg-amber-100"    iconColor="text-amber-600"
          sub={summary.total ? `${Math.round((summary.submitted / summary.total) * 100)}% of leads` : undefined} />
        <SummaryCard label="Admitted"       value={summary.admitted}  Icon={GraduationCap} iconBg="bg-emerald-100"  iconColor="text-emerald-600"
          sub={summary.total ? `${Math.round((summary.admitted / summary.total) * 100)}% of leads` : undefined} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : metrics.length === 0 ? (
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-12 text-center text-muted-foreground text-sm">
            No leads in the selected date range.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide">
                    <Th label="Source" sortable={false} />
                    <Th label="Total Leads" active={sortBy === "total"} onClick={() => setSortBy("total")} />
                    <Th label="Engaged %"   active={sortBy === "engaged_pct"}   onClick={() => setSortBy("engaged_pct")} />
                    <Th label="App Started" sortable={false} />
                    <Th label="Submitted %" active={sortBy === "submitted_pct"} onClick={() => setSortBy("submitted_pct")} />
                    <Th label="Admitted %"  active={sortBy === "admitted_pct"}  onClick={() => setSortBy("admitted_pct")} />
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(m => {
                    const engagedPct   = m.total > 0 ? Math.round((m.engaged   / m.total) * 100) : 0;
                    const submittedPct = m.total > 0 ? Math.round((m.submitted / m.total) * 100) : 0;
                    const admittedPct  = m.total > 0 ? Math.round((m.admitted  / m.total) * 100) : 0;
                    const [fromDate, toDate] = dateRangeFor(datePreset, customStart, customEnd);
                    const baseLink = (stages?: string) =>
                      buildLeadListUrl({ source: m.source, stages, fromDate, toDate });
                    const linkCls = "underline decoration-dotted underline-offset-2 hover:text-primary";
                    return (
                      <tr key={m.source ?? "_unknown"} className="border-b border-border/60 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">
                          <a href={baseLink()} target="_blank" rel="noreferrer" className={linkCls} title={`See all ${m.label} leads`}>
                            {m.label}
                          </a>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          <a href={baseLink()} target="_blank" rel="noreferrer" className={`text-foreground ${linkCls}`}>
                            {m.total.toLocaleString("en-IN")}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <a href={baseLink(ENGAGED_STAGES_PARAM)} target="_blank" rel="noreferrer"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums hover:opacity-80 ${pctClass(engagedPct, "engaged")}`}>
                            {m.engaged.toLocaleString("en-IN")} · {engagedPct}%
                          </a>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          <a href={baseLink(APP_STARTED_STAGES_PARAM)} target="_blank" rel="noreferrer" className={`text-muted-foreground ${linkCls}`}>
                            {m.appStarted.toLocaleString("en-IN")}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <a href={baseLink(APP_SUBMITTED_PARAM)} target="_blank" rel="noreferrer"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums hover:opacity-80 ${pctClass(submittedPct, "submitted")}`}>
                            {m.submitted.toLocaleString("en-IN")} · {submittedPct}%
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <a href={baseLink(ADMITTED_PARAM)} target="_blank" rel="noreferrer"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums hover:opacity-80 ${pctClass(admittedPct, "admitted")}`}>
                            {m.admitted.toLocaleString("en-IN")} · {admittedPct}%
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-border/60 bg-muted/20 flex items-center gap-2 text-[11px] text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              <span>Engaged = lead reached counsellor / AI call or beyond. Submitted = application submitted or beyond. Admitted = final stage.</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, Icon, iconBg, iconColor }: {
  label: string;
  value: number;
  sub?: string;
  Icon: any;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
          <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          </div>
        </div>
        <p className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString("en-IN")}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Th({ label, sortable = true, active = false, onClick }: {
  label: string;
  sortable?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      className={`px-4 py-2.5 text-left font-semibold text-muted-foreground select-none ${sortable ? "cursor-pointer hover:text-foreground" : ""} ${active ? "text-foreground" : ""}`}
    >
      {label}{sortable && active ? " ↓" : ""}
    </th>
  );
}

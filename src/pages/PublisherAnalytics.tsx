import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, TrendingUp, Users, Phone, FileText, GraduationCap, BarChart3,
} from "lucide-react";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { getDatePresetRange, type DatePreset } from "@/lib/datePresets";

function dateRangeFor(preset: DatePreset, fromDate?: string, toDate?: string): [Date | null, Date | null] {
  const range = preset === "custom" ? { from: fromDate || "", to: toDate || "" } : getDatePresetRange(preset);
  return [
    range.from ? new Date(`${range.from}T00:00:00`) : null,
    range.to ? new Date(`${range.to}T23:59:59.999`) : null,
  ];
}

interface LeadRow {
  id: string;
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

const FLOW_WINDOWS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_7", label: "Last 7 days" },
] as const;

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
const APP_FEE_PAID_STAGES = new Set([
  "application_fee_paid", "application_submitted", "visit_scheduled", "interview",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
]);
const TOKEN_PAID_STAGES = new Set([
  "token_paid", "pre_admitted", "admitted",
]);
const ADMITTED_STAGES = new Set(["admitted"]);
const NOT_INTERESTED_STAGES = new Set(["not_interested"]);

interface SourceMetrics {
  source: string | null;
  label: string;
  total: number;
  notInterested: number;
  engaged: number;
  appStarted: number;
  submitted: number;
  appFeePaid: number;
  tokenPaid: number;
  admitted: number;
}

// Stage groupings as comma-separated lists for the Admissions URL stage filter,
// which accepts a comma-joined list of stages (see Admissions.tsx:486).
const ENGAGED_STAGES_PARAM   = Array.from(ENGAGED_STAGES).join(",");
const APP_STARTED_STAGES_PARAM = Array.from(APP_STARTED_STAGES).join(",");
const APP_SUBMITTED_PARAM    = Array.from(APP_SUBMITTED_STAGES).join(",");
const APP_FEE_PAID_PARAM     = Array.from(APP_FEE_PAID_STAGES).join(",");
const TOKEN_PAID_PARAM       = Array.from(TOKEN_PAID_STAGES).join(",");
const ADMITTED_PARAM         = Array.from(ADMITTED_STAGES).join(",");
const NOT_INTERESTED_PARAM   = Array.from(NOT_INTERESTED_STAGES).join(",");

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

// "Not interested" is a loss metric — higher is worse, so colors invert.
function notInterestedClass(pct: number): string {
  if (pct >= 30) return "text-destructive bg-destructive/5";
  if (pct >= 10) return "text-warning-foreground bg-warning/5";
  return "text-muted-foreground bg-muted/40";
}

function pctClass(pct: number, kind: "engaged" | "submitted" | "admitted"): string {
  // Kind-aware thresholds — admission rates are naturally lower than engagement.
  const thresholds = kind === "admitted"
    ? { good: 5, warn: 1 }
    : kind === "submitted"
    ? { good: 15, warn: 5 }
    : { good: 50, warn: 25 };
  if (pct >= thresholds.good) return "text-success bg-success/5";
  if (pct >= thresholds.warn) return "text-warning-foreground bg-warning/5";
  return "text-destructive bg-destructive/5";
}

export default function PublisherAnalytics() {
  const { role, roleLoaded } = useAuth();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const initialMonthRange = getDatePresetRange("this_month");
  const [fromDate, setFromDate] = useState(initialMonthRange.from);
  const [toDate, setToDate] = useState(initialMonthRange.to);
  const [sortBy, setSortBy] = useState<"total" | "not_interested_pct" | "engaged_pct" | "submitted_pct" | "admitted_pct">("total");

  // Fetch leads on mount — paginate to bypass Supabase's default 1000 cap.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const PAGE = 1000;
      let all: LeadRow[] = [];
      let cursor: { created_at: string; id: string } | null = null;
      while (true) {
        let query = supabase
          .from("leads")
          .select("id, source, stage, created_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(PAGE);
        if (cursor) {
          query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
        }
        const { data, error } = await query;
        if (error) break;
        const fetched = (data || []) as LeadRow[];
        all = all.concat(fetched);
        const last = fetched[fetched.length - 1];
        if (!last || fetched.length < PAGE) break;
        cursor = { created_at: last.created_at, id: last.id };
      }
      setLeads(all);
      setLoading(false);
    })();
  }, []);

  // Apply the date filter.
  const dateScopedLeads = useMemo(() => {
    const [start, end] = dateRangeFor(datePreset, fromDate, toDate);
    if (!start && !end) return leads;
    return leads.filter(l => {
      const t = new Date(l.created_at).getTime();
      if (start && t < start.getTime()) return false;
      if (end   && t > end.getTime())   return false;
      return true;
    });
  }, [leads, datePreset, fromDate, toDate]);

  const dailyFlow = useMemo(() => {
    return FLOW_WINDOWS.map((window) => {
      const [start, end] = dateRangeFor(window.key);
      const sourceCounts = new Map<string | null, number>();
      for (const lead of leads) {
        const t = new Date(lead.created_at).getTime();
        if (start && t < start.getTime()) continue;
        if (end && t > end.getTime()) continue;
        sourceCounts.set(lead.source || null, (sourceCounts.get(lead.source || null) || 0) + 1);
      }
      const sources = Array.from(sourceCounts.entries())
        .map(([source, count]) => ({ source, label: labelFor(source), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return {
        ...window,
        total: sources.reduce((sum, source) => sum + source.count, 0),
        sources,
      };
    });
  }, [leads]);

  // Aggregate by source.
  const metrics: SourceMetrics[] = useMemo(() => {
    const bySource = new Map<string | null, SourceMetrics>();
    for (const l of dateScopedLeads) {
      const key = l.source || null;
      let m = bySource.get(key);
      if (!m) {
        m = { source: key, label: labelFor(key), total: 0, notInterested: 0, engaged: 0, appStarted: 0, submitted: 0, appFeePaid: 0, tokenPaid: 0, admitted: 0 };
        bySource.set(key, m);
      }
      m.total++;
      if (NOT_INTERESTED_STAGES.has(l.stage)) m.notInterested++;
      if (ENGAGED_STAGES.has(l.stage))      m.engaged++;
      if (APP_STARTED_STAGES.has(l.stage))  m.appStarted++;
      if (APP_SUBMITTED_STAGES.has(l.stage)) m.submitted++;
      if (APP_FEE_PAID_STAGES.has(l.stage)) m.appFeePaid++;
      if (TOKEN_PAID_STAGES.has(l.stage))   m.tokenPaid++;
      if (ADMITTED_STAGES.has(l.stage))     m.admitted++;
    }
    const out = Array.from(bySource.values());
    out.sort((a, b) => {
      const aPct = (n: number) => a.total > 0 ? n / a.total : 0;
      const bPct = (n: number) => b.total > 0 ? n / b.total : 0;
      switch (sortBy) {
        case "not_interested_pct": return bPct(b.notInterested) - aPct(a.notInterested);
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
        notInterested: acc.notInterested + m.notInterested,
        engaged: acc.engaged + m.engaged,
        submitted: acc.submitted + m.submitted,
        admitted: acc.admitted + m.admitted,
      }),
      { total: 0, notInterested: 0, engaged: 0, submitted: 0, admitted: 0 },
    );
    return totals;
  }, [metrics]);

  if (!roleLoaded) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
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
          <DateRangeFilter
            preset={datePreset}
            fromDate={fromDate}
            toDate={toDate}
            onPresetChange={setDatePreset}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-input bg-card px-3 py-2"
            ariaPrefix="Publisher analytics"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Leads"    value={summary.total}     Icon={Users}        iconBg="bg-info/10"     iconColor="text-info-foreground" />
        <SummaryCard label="Engaged"        value={summary.engaged}   Icon={Phone}        iconBg="bg-primary/10"   iconColor="text-primary"
          sub={summary.total ? `${Math.round((summary.engaged / summary.total) * 100)}% of leads` : undefined} />
        <SummaryCard label="Submitted Apps" value={summary.submitted} Icon={FileText}     iconBg="bg-warning/10"    iconColor="text-warning-foreground"
          sub={summary.total ? `${Math.round((summary.submitted / summary.total) * 100)}% of leads` : undefined} />
        <SummaryCard label="Admitted"       value={summary.admitted}  Icon={GraduationCap} iconBg="bg-success/10"  iconColor="text-success"
          sub={summary.total ? `${Math.round((summary.admitted / summary.total) * 100)}% of leads` : undefined} />
      </div>

      <Card className="border-border/60 shadow-none">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Daily Lead Flow by Source</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {dailyFlow.map((window) => (
              <div key={window.key} className="rounded-lg border border-border/60 bg-background p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{window.label}</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">{window.total}</p>
                </div>
                {window.sources.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leads</p>
                ) : (
                  <div className="space-y-1.5">
                    {window.sources.slice(0, 6).map((source) => (
                      <div key={source.source ?? "_unknown"} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground" title={source.label}>{source.label}</span>
                        <span className="font-semibold tabular-nums text-foreground">{source.count}</span>
                      </div>
                    ))}
                    {window.sources.length > 6 && (
                      <p className="text-[11px] text-muted-foreground">+{window.sources.length - 6} more sources</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
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
                    <Th label="Not Interested %" active={sortBy === "not_interested_pct"} onClick={() => setSortBy("not_interested_pct")} />
                    <Th label="Engaged %"   active={sortBy === "engaged_pct"}   onClick={() => setSortBy("engaged_pct")} />
                    <Th label="App Started" sortable={false} />
                    <Th label="Submitted %" active={sortBy === "submitted_pct"} onClick={() => setSortBy("submitted_pct")} />
                    <Th label="App Fee Paid" sortable={false} />
                    <Th label="Token Paid"   sortable={false} />
                    <Th label="Admitted %"  active={sortBy === "admitted_pct"}  onClick={() => setSortBy("admitted_pct")} />
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(m => {
                    const notInterestedPct = m.total > 0 ? Math.round((m.notInterested / m.total) * 100) : 0;
                    const engagedPct   = m.total > 0 ? Math.round((m.engaged   / m.total) * 100) : 0;
                    const submittedPct = m.total > 0 ? Math.round((m.submitted / m.total) * 100) : 0;
                    const admittedPct  = m.total > 0 ? Math.round((m.admitted  / m.total) * 100) : 0;
                    const [fromDateForLink, toDateForLink] = dateRangeFor(datePreset, fromDate, toDate);
                    const baseLink = (stages?: string) =>
                      buildLeadListUrl({ source: m.source, stages, fromDate: fromDateForLink, toDate: toDateForLink });
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
                          <a href={baseLink(NOT_INTERESTED_PARAM)} target="_blank" rel="noreferrer"
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums hover:opacity-80 ${notInterestedClass(notInterestedPct)}`}>
                            {m.notInterested.toLocaleString("en-IN")} · {notInterestedPct}%
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
                        <td className="px-4 py-3 tabular-nums">
                          <a href={baseLink(APP_FEE_PAID_PARAM)} target="_blank" rel="noreferrer" className={`text-muted-foreground ${linkCls}`}>
                            {m.appFeePaid.toLocaleString("en-IN")}
                          </a>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          <a href={baseLink(TOKEN_PAID_PARAM)} target="_blank" rel="noreferrer" className={`text-muted-foreground ${linkCls}`}>
                            {m.tokenPaid.toLocaleString("en-IN")}
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
              <span>Not Interested = lead marked dead (by AI call or counsellor). Engaged = lead reached counsellor / AI call or beyond. Submitted = application submitted or beyond. Admitted = final stage.</span>
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

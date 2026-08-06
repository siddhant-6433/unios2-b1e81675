import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, MessageSquare, ShieldAlert, Phone, FileText, ArrowUp, ArrowDown, ChevronRight, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types from fn_whatsapp_health_dashboard ─────────────────────────────────

type Overall = {
  window_days: number;
  since: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  read_pct: number | null;
  failed_pct: number | null;
  distinct_phones: number;
  distinct_templates: number;
};

type TemplateRow = {
  template_key: string;
  total: number;
  read: number;
  delivered: number;
  sent: number;
  failed: number;
  read_pct: number | null;
  failed_pct: number | null;
};

type PhoneRow = {
  phone_number_id: string;
  total: number;
  failed: number;
  read: number;
  failed_pct: number | null;
  read_pct: number | null;
};

type ErrorRow = {
  meta_code: string | null;
  meta_message: string | null;
  template_key: string;
  phone_number_id: string;
  failures: number;
};

type DailyRow = { day: string; total: number; read: number; failed: number };

type RecentRow = {
  created_at: string;
  template_key: string | null;
  phone_number_id: string | null;
  phone_masked: string;
  meta_code: string | null;
  meta_message: string | null;
  lead_id: string | null;
};

type Dashboard = {
  overall: Overall;
  templates: TemplateRow[];
  phones: PhoneRow[];
  errors: ErrorRow[];
  daily: DailyRow[];
  recent: RecentRow[];
};

// Meta error codes that indicate spam/quality penalties. Highlighted so the
// triage user can find them at a glance.
const SPAM_CODES = new Set(["131048", "131049", "131026"]);

const META_CODE_HINTS: Record<string, string> = {
  "131048": "Spam-rate limit hit — Meta has throttled this number.",
  "131049": "24h window expired or user blocked / declined messages.",
  "131026": "Undeliverable (often a quality-rating throttle).",
  "1009": "Recipient blocked the number or invalid phone.",
  "100": "Invalid recipient.",
  "470": "Re-engagement window expired.",
};

const WINDOW_OPTIONS = [7, 14, 30];

// IST midnight boundaries — the daily series is bucketed by Asia/Kolkata day,
// so the presets line up with the bars users see in the chart.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istMidnight = (daysOffsetFromToday: number): Date => {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUtcMs = Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate() + daysOffsetFromToday
  ) - IST_OFFSET_MS;
  return new Date(istMidnightUtcMs);
};

const formatLocalInput = (d: Date): string => {
  // Format for <input type="date"> as IST calendar day.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
};

type RangeMode =
  | { kind: "days"; days: number }
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "custom"; from: string; to: string }; // YYYY-MM-DD strings (IST calendar days)

const modeKey = (m: RangeMode): string => {
  switch (m.kind) {
    case "days": return `d:${m.days}`;
    case "today": return "today";
    case "yesterday": return "yesterday";
    case "custom": return `c:${m.from}:${m.to}`;
  }
};

type TemplateSortKey = "template_key" | "total" | "read" | "read_pct" | "failed" | "failed_pct";
type PhoneSortKey = "phone_number_id" | "total" | "read_pct" | "failed" | "failed_pct";
type SortDir = "asc" | "desc";

const cmp = (a: unknown, b: unknown, dir: SortDir): number => {
  if (a == null && b == null) return 0;
  if (a == null) return dir === "asc" ? 1 : -1;
  if (b == null) return dir === "asc" ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return dir === "asc" ? a - b : b - a;
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
};

const todayIstStr = () => formatLocalInput(istMidnight(0));

const WhatsAppHealth = () => {
  const [range, setRange] = useState<RangeMode>({ kind: "days", days: 14 });
  const [customDraft, setCustomDraft] = useState<{ from: string; to: string }>(() => ({
    from: formatLocalInput(istMidnight(-6)),
    to: todayIstStr(),
  }));
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tplSort, setTplSort] = useState<{ key: TemplateSortKey; dir: SortDir }>({ key: "failed_pct", dir: "desc" });
  const [phoneSort, setPhoneSort] = useState<{ key: PhoneSortKey; dir: SortDir }>({ key: "failed_pct", dir: "desc" });
  const [expandedTpl, setExpandedTpl] = useState<Set<string>>(new Set());

  const toggleTplSort = (key: TemplateSortKey) =>
    setTplSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "template_key" ? "asc" : "desc" }));
  const togglePhoneSort = (key: PhoneSortKey) =>
    setPhoneSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "phone_number_id" ? "asc" : "desc" }));
  const toggleTplExpand = (key: string) =>
    setExpandedTpl((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const load = async (mode: RangeMode) => {
    setLoading(true);
    setError(null);

    let rpcArgs: Record<string, unknown>;
    if (mode.kind === "days") {
      rpcArgs = { p_days: mode.days };
    } else if (mode.kind === "today") {
      rpcArgs = {
        p_days: 1,
        p_from: istMidnight(0).toISOString(),
        p_to: istMidnight(1).toISOString(),
      };
    } else if (mode.kind === "yesterday") {
      rpcArgs = {
        p_days: 1,
        p_from: istMidnight(-1).toISOString(),
        p_to: istMidnight(0).toISOString(),
      };
    } else {
      // custom — interpret from/to as IST calendar days, exclusive on `to`.
      const fromIst = new Date(`${mode.from}T00:00:00+05:30`);
      const toIst = new Date(`${mode.to}T00:00:00+05:30`);
      // Include the `to` day fully by advancing one day.
      const toExclusive = new Date(toIst.getTime() + 24 * 60 * 60 * 1000);
      rpcArgs = {
        p_days: 1,
        p_from: fromIst.toISOString(),
        p_to: toExclusive.toISOString(),
      };
    }

    const { data: rpc, error: rpcErr } = await supabase.rpc(
      "fn_whatsapp_health_dashboard",
      rpcArgs
    );
    if (rpcErr) {
      setError(rpcErr.message);
      setLoading(false);
      return;
    }
    setData(rpc as unknown as Dashboard);
    setLoading(false);
  };

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey(range)]);

  const maxDailyTotal = useMemo(() => {
    if (!data?.daily?.length) return 1;
    return Math.max(1, ...data.daily.map((d) => d.total));
  }, [data?.daily]);

  const sortedTemplates = useMemo(() => {
    if (!data?.templates) return [];
    return [...data.templates].sort((a, b) => cmp(a[tplSort.key], b[tplSort.key], tplSort.dir));
  }, [data?.templates, tplSort]);

  const sortedPhones = useMemo(() => {
    if (!data?.phones) return [];
    return [...data.phones].sort((a, b) => cmp(a[phoneSort.key], b[phoneSort.key], phoneSort.dir));
  }, [data?.phones, phoneSort]);

  // Group Meta errors by template_key so each template row can expand to show
  // its own error breakdown — fastest path from "this template fails" to "why".
  const errorsByTemplate = useMemo(() => {
    const map = new Map<string, ErrorRow[]>();
    if (!data?.errors) return map;
    for (const e of data.errors) {
      const arr = map.get(e.template_key) || [];
      arr.push(e);
      map.set(e.template_key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.failures - a.failures);
    return map;
  }, [data?.errors]);

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-warning-foreground" />
            WhatsApp Health & Spam Triage
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregated send health, Meta error codes, and per-number / per-template breakdown.
            Use the failed-% column and the Meta error codes to identify which templates are
            being rate-limited or reported as spam.
          </p>
        </div>
        <div className="flex items-center gap-2 relative">
          <div className="flex flex-wrap rounded-xl border border-input bg-card p-0.5">
            <RangeButton
              active={range.kind === "today"}
              onClick={() => { setShowCustom(false); setRange({ kind: "today" }); }}
            >Today</RangeButton>
            <RangeButton
              active={range.kind === "yesterday"}
              onClick={() => { setShowCustom(false); setRange({ kind: "yesterday" }); }}
            >Yesterday</RangeButton>
            {WINDOW_OPTIONS.map((d) => (
              <RangeButton
                key={d}
                active={range.kind === "days" && range.days === d}
                onClick={() => { setShowCustom(false); setRange({ kind: "days", days: d }); }}
              >Last {d}d</RangeButton>
            ))}
            <RangeButton
              active={range.kind === "custom"}
              onClick={() => setShowCustom((s) => !s)}
            >
              Custom{range.kind === "custom" ? `: ${range.from} → ${range.to}` : "…"}
            </RangeButton>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(range)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          {showCustom && (
            <div className="absolute right-0 top-full mt-2 z-20 bg-card border border-border rounded-xl shadow-lg p-3 w-72">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">Custom range (IST)</p>
              <div className="space-y-2">
                <label className="block text-[11px] text-muted-foreground">
                  From
                  <input
                    type="date"
                    value={customDraft.from}
                    max={customDraft.to}
                    onChange={(e) => setCustomDraft((d) => ({ ...d, from: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                </label>
                <label className="block text-[11px] text-muted-foreground">
                  To
                  <input
                    type="date"
                    value={customDraft.to}
                    min={customDraft.from}
                    max={todayIstStr()}
                    onChange={(e) => setCustomDraft((d) => ({ ...d, to: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowCustom(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!customDraft.from || !customDraft.to || customDraft.from > customDraft.to}
                  onClick={() => {
                    setRange({ kind: "custom", from: customDraft.from, to: customDraft.to });
                    setShowCustom(false);
                  }}
                >Apply</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Failed to load dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">
                You need super_admin or admission_head role to view this dashboard.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <ButtonOrb state="connecting" />
          Loading…
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard
              label="Outbound sent"
              value={data.overall.total.toLocaleString()}
              hint={`${data.overall.distinct_templates} templates, ${data.overall.distinct_phones} numbers`}
            />
            <SummaryCard
              label="Read"
              value={data.overall.read.toLocaleString()}
              hint={data.overall.read_pct != null ? `${data.overall.read_pct}% read rate` : "—"}
              tone={
                data.overall.read_pct != null && data.overall.read_pct < 20 ? "warn" : "ok"
              }
            />
            <SummaryCard
              label="Delivered"
              value={data.overall.delivered.toLocaleString()}
            />
            <SummaryCard
              label="Failed"
              value={data.overall.failed.toLocaleString()}
              hint={
                data.overall.failed_pct != null ? `${data.overall.failed_pct}% failure rate` : "—"
              }
              tone={
                data.overall.failed_pct != null && data.overall.failed_pct > 5 ? "bad" : "ok"
              }
            />
            <SummaryCard
              label="Spam-code hits"
              value={data.errors
                .filter((e) => e.meta_code && SPAM_CODES.has(e.meta_code))
                .reduce((acc, e) => acc + e.failures, 0)
                .toLocaleString()}
              hint="Meta codes 131048 / 131049 / 131026"
              tone={
                data.errors.some((e) => e.meta_code && SPAM_CODES.has(e.meta_code))
                  ? "bad"
                  : "ok"
              }
            />
          </div>

          {/* Daily bar chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                Daily outbound volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.daily.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4">No outbound sends in window.</p>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-end gap-1 h-32">
                    {data.daily.map((d) => {
                      const totalH = (d.total / maxDailyTotal) * 100;
                      const failedH =
                        d.total > 0 ? (d.failed / d.total) * totalH : 0;
                      return (
                        <div
                          key={d.day}
                          className="flex-1 min-w-[8px] flex flex-col-reverse"
                          title={`${d.day}: ${d.total} sent, ${d.failed} failed, ${d.read} read`}
                        >
                          <div
                            className="bg-success/50 rounded-t-sm"
                            style={{ height: `${totalH - failedH}%` }}
                          />
                          {failedH > 0 && (
                            <div
                              className="bg-destructive/50"
                              style={{ height: `${failedH}%` }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground pt-1">
                    <span>{data.daily[0]?.day}</span>
                    <span>{data.daily[data.daily.length - 1]?.day}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-success/50 rounded-sm" /> Sent</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-destructive/50 rounded-sm" /> Failed</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per template */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Per-template health
                <span className="text-xs font-normal text-muted-foreground">
                  Click a column to sort. Click a row to see its Meta error codes.
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <SortableTh align="left" active={tplSort.key === "template_key"} dir={tplSort.dir} onClick={() => toggleTplSort("template_key")}>Template</SortableTh>
                      <SortableTh align="right" active={tplSort.key === "total"} dir={tplSort.dir} onClick={() => toggleTplSort("total")}>Total</SortableTh>
                      <SortableTh align="right" active={tplSort.key === "read"} dir={tplSort.dir} onClick={() => toggleTplSort("read")}>Read</SortableTh>
                      <SortableTh align="right" active={tplSort.key === "read_pct"} dir={tplSort.dir} onClick={() => toggleTplSort("read_pct")}>Read %</SortableTh>
                      <SortableTh align="right" active={tplSort.key === "failed"} dir={tplSort.dir} onClick={() => toggleTplSort("failed")}>Failed</SortableTh>
                      <SortableTh align="right" active={tplSort.key === "failed_pct"} dir={tplSort.dir} onClick={() => toggleTplSort("failed_pct")}>Failed %</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTemplates.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No sends in window.</td></tr>
                    )}
                    {sortedTemplates.map((t) => {
                      const tplErrors = errorsByTemplate.get(t.template_key) || [];
                      const canExpand = tplErrors.length > 0;
                      const isExpanded = expandedTpl.has(t.template_key);
                      return (
                        <Fragment key={t.template_key}>
                          <tr
                            className={`border-t border-border ${canExpand ? "cursor-pointer hover:bg-muted/30" : ""}`}
                            onClick={canExpand ? () => toggleTplExpand(t.template_key) : undefined}
                          >
                            <td className="px-3 py-2 font-mono text-foreground">
                              <div className="flex items-center gap-1">
                                {canExpand ? (
                                  isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                ) : (
                                  <span className="w-3" />
                                )}
                                <span>{t.template_key}</span>
                              </div>
                            </td>
                            <td className="text-right px-3 py-2">{t.total.toLocaleString()}</td>
                            <td className="text-right px-3 py-2">{t.read.toLocaleString()}</td>
                            <td className="text-right px-3 py-2">{t.read_pct ?? "—"}</td>
                            <td className="text-right px-3 py-2">{t.failed.toLocaleString()}</td>
                            <td className={`text-right px-3 py-2 font-semibold ${
                              (t.failed_pct ?? 0) > 10
                                ? "text-destructive"
                                : (t.failed_pct ?? 0) > 5
                                ? "text-warning-foreground"
                                : "text-muted-foreground"
                            }`}>
                              {t.failed_pct ?? "—"}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-muted/20 border-t border-border">
                              <td colSpan={6} className="px-3 py-3">
                                <div className="text-[11px] text-muted-foreground mb-2">
                                  Meta errors for <span className="font-mono">{t.template_key}</span> ({tplErrors.length} {tplErrors.length === 1 ? "code" : "codes"})
                                </div>
                                <div className="space-y-1.5">
                                  {tplErrors.map((e, i) => {
                                    const isSpam = e.meta_code && SPAM_CODES.has(e.meta_code);
                                    return (
                                      <div key={i} className="flex items-start gap-2 text-[11px]">
                                        <Badge variant={isSpam ? "destructive" : "outline"} className="font-mono text-[10px] shrink-0">
                                          {e.meta_code || "—"}
                                        </Badge>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-foreground truncate" title={e.meta_message || ""}>
                                            {e.meta_message || "—"}
                                          </div>
                                          {e.meta_code && META_CODE_HINTS[e.meta_code] && (
                                            <div className="text-[10px] text-warning-foreground dark:text-warning mt-0.5">
                                              {META_CODE_HINTS[e.meta_code]}
                                            </div>
                                          )}
                                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                            number: {e.phone_number_id}
                                          </div>
                                        </div>
                                        <div className="font-semibold shrink-0">{e.failures.toLocaleString()}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Per Meta phone number */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                Per Meta phone number
                <span className="text-xs font-normal text-muted-foreground">
                  Helps isolate which number is under Meta quality penalty
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <SortableTh align="left" active={phoneSort.key === "phone_number_id"} dir={phoneSort.dir} onClick={() => togglePhoneSort("phone_number_id")}>Business phone number ID</SortableTh>
                      <SortableTh align="right" active={phoneSort.key === "total"} dir={phoneSort.dir} onClick={() => togglePhoneSort("total")}>Total</SortableTh>
                      <SortableTh align="right" active={phoneSort.key === "read_pct"} dir={phoneSort.dir} onClick={() => togglePhoneSort("read_pct")}>Read %</SortableTh>
                      <SortableTh align="right" active={phoneSort.key === "failed"} dir={phoneSort.dir} onClick={() => togglePhoneSort("failed")}>Failed</SortableTh>
                      <SortableTh align="right" active={phoneSort.key === "failed_pct"} dir={phoneSort.dir} onClick={() => togglePhoneSort("failed_pct")}>Failed %</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPhones.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No sends in window.</td></tr>
                    )}
                    {sortedPhones.map((p) => (
                      <tr key={p.phone_number_id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">{p.phone_number_id}</td>
                        <td className="text-right px-3 py-2">{p.total.toLocaleString()}</td>
                        <td className="text-right px-3 py-2">{p.read_pct ?? "—"}</td>
                        <td className="text-right px-3 py-2">{p.failed.toLocaleString()}</td>
                        <td className={`text-right px-3 py-2 font-semibold ${
                          (p.failed_pct ?? 0) > 10
                            ? "text-destructive"
                            : (p.failed_pct ?? 0) > 5
                            ? "text-warning-foreground"
                            : "text-muted-foreground"
                        }`}>
                          {p.failed_pct ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Meta error codes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                Meta error codes
                <span className="text-xs font-normal text-muted-foreground">
                  Rows with codes 131048 / 131049 / 131026 are spam-rating signals
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Code</th>
                      <th className="text-left px-3 py-2 font-medium">Template</th>
                      <th className="text-left px-3 py-2 font-medium">Number ID</th>
                      <th className="text-left px-3 py-2 font-medium">Meta message</th>
                      <th className="text-right px-3 py-2 font-medium">Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted-foreground py-6">
                        No failed messages with Meta error info in window. Either nothing
                        failed, or the failures predate the status_error column rollout.
                      </td></tr>
                    )}
                    {data.errors.map((e, i) => {
                      const isSpam = e.meta_code && SPAM_CODES.has(e.meta_code);
                      return (
                        <tr key={i} className={`border-t border-border ${isSpam ? "bg-destructive/5/40 dark:bg-destructive/90/20" : ""}`}>
                          <td className="px-3 py-2">
                            {e.meta_code ? (
                              <Badge variant={isSpam ? "destructive" : "outline"} className="font-mono text-[10px]">
                                {e.meta_code}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono">{e.template_key}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{e.phone_number_id}</td>
                          <td className="px-3 py-2 text-muted-foreground max-w-md">
                            <div className="truncate" title={e.meta_message || ""}>
                              {e.meta_message || "—"}
                            </div>
                            {e.meta_code && META_CODE_HINTS[e.meta_code] && (
                              <div className="text-[10px] text-warning-foreground dark:text-warning mt-0.5">
                                {META_CODE_HINTS[e.meta_code]}
                              </div>
                            )}
                          </td>
                          <td className="text-right px-3 py-2 font-semibold">{e.failures.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Recent failures */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recent failures (last 50)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">When</th>
                      <th className="text-left px-3 py-2 font-medium">Template</th>
                      <th className="text-left px-3 py-2 font-medium">Phone</th>
                      <th className="text-left px-3 py-2 font-medium">Code</th>
                      <th className="text-left px-3 py-2 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No failures in window.</td></tr>
                    )}
                    {data.recent.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-3 py-2 font-mono">{r.template_key || "—"}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{r.phone_masked}</td>
                        <td className="px-3 py-2">
                          {r.meta_code ? (
                            <Badge variant={SPAM_CODES.has(r.meta_code) ? "destructive" : "outline"} className="font-mono text-[10px]">
                              {r.meta_code}
                            </Badge>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-md">
                          <div className="truncate" title={r.meta_message || ""}>
                            {r.meta_message || "—"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

const RangeButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    {children}
  </button>
);

const SortableTh = ({
  children,
  align,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) => {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-foreground" : ""}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span>{children}</span>
        {active ? <Icon className="h-3 w-3" /> : <span className="w-3" />}
      </span>
    </th>
  );
};

const SummaryCard = ({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "bad";
}) => {
  const toneClass =
    tone === "bad"
      ? "text-destructive dark:text-destructive/80"
      : tone === "warn"
      ? "text-warning-foreground dark:text-warning"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
};

export default WhatsAppHealth;

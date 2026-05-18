import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle, RefreshCw, MessageSquare, ShieldAlert, Phone, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const WhatsAppHealth = () => {
  const [windowDays, setWindowDays] = useState<number>(14);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (days: number) => {
    setLoading(true);
    setError(null);
    const { data: rpc, error: rpcErr } = await supabase.rpc(
      "fn_whatsapp_health_dashboard",
      { p_days: days }
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
    load(windowDays);
  }, [windowDays]);

  const maxDailyTotal = useMemo(() => {
    if (!data?.daily?.length) return 1;
    return Math.max(1, ...data.daily.map((d) => d.total));
  }, [data?.daily]);

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-amber-600" />
            WhatsApp Health & Spam Triage
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregated send health, Meta error codes, and per-number / per-template breakdown.
            Use the failed-% column and the Meta error codes to identify which templates are
            being rate-limited or reported as spam.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-input bg-card p-0.5">
            {WINDOW_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  windowDays === d
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Last {d} days
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(windowDays)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
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
          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
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
                            className="bg-emerald-500 rounded-t-sm"
                            style={{ height: `${totalH - failedH}%` }}
                          />
                          {failedH > 0 && (
                            <div
                              className="bg-red-500"
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
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" /> Sent</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-sm" /> Failed</span>
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
                  Sorted by failure rate — highest spam risk on top
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Template</th>
                      <th className="text-right px-3 py-2 font-medium">Total</th>
                      <th className="text-right px-3 py-2 font-medium">Read</th>
                      <th className="text-right px-3 py-2 font-medium">Read %</th>
                      <th className="text-right px-3 py-2 font-medium">Failed</th>
                      <th className="text-right px-3 py-2 font-medium">Failed %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.templates.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No sends in window.</td></tr>
                    )}
                    {data.templates.map((t) => (
                      <tr key={t.template_key} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">{t.template_key}</td>
                        <td className="text-right px-3 py-2">{t.total.toLocaleString()}</td>
                        <td className="text-right px-3 py-2">{t.read.toLocaleString()}</td>
                        <td className="text-right px-3 py-2">{t.read_pct ?? "—"}</td>
                        <td className="text-right px-3 py-2">{t.failed.toLocaleString()}</td>
                        <td className={`text-right px-3 py-2 font-semibold ${
                          (t.failed_pct ?? 0) > 10
                            ? "text-red-600"
                            : (t.failed_pct ?? 0) > 5
                            ? "text-amber-600"
                            : "text-muted-foreground"
                        }`}>
                          {t.failed_pct ?? "—"}
                        </td>
                      </tr>
                    ))}
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
                      <th className="text-left px-3 py-2 font-medium">Business phone number ID</th>
                      <th className="text-right px-3 py-2 font-medium">Total</th>
                      <th className="text-right px-3 py-2 font-medium">Read %</th>
                      <th className="text-right px-3 py-2 font-medium">Failed</th>
                      <th className="text-right px-3 py-2 font-medium">Failed %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.phones.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No sends in window.</td></tr>
                    )}
                    {data.phones.map((p) => (
                      <tr key={p.phone_number_id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-foreground">{p.phone_number_id}</td>
                        <td className="text-right px-3 py-2">{p.total.toLocaleString()}</td>
                        <td className="text-right px-3 py-2">{p.read_pct ?? "—"}</td>
                        <td className="text-right px-3 py-2">{p.failed.toLocaleString()}</td>
                        <td className={`text-right px-3 py-2 font-semibold ${
                          (p.failed_pct ?? 0) > 10
                            ? "text-red-600"
                            : (p.failed_pct ?? 0) > 5
                            ? "text-amber-600"
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
                <AlertTriangle className="h-4 w-4 text-amber-600" />
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
                        <tr key={i} className={`border-t border-border ${isSpam ? "bg-red-50/40 dark:bg-red-950/20" : ""}`}>
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
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
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
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
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

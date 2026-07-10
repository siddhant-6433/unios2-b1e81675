import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Search, Loader2, CheckCircle, Play, AlertCircle, ChevronLeft, ChevronRight, Calendar, PhoneIncoming, PhoneOutgoing, Phone,
} from "lucide-react";
import { AiCallQueueStatus } from "@/components/admissions/AiCallQueueStatus";
import { VoiceQualityDashboard } from "@/components/admissions/VoiceQualityDashboard";
import { CallQualityRating, CallQualityMetricsChip } from "@/components/admissions/CallQualityRating";

interface AiCallRecord {
  id: string;
  lead_id: string;
  status: string;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  conversion_probability: number | null;
  disposition: string | null;
  created_at: string;
  quality_score: number | null;
  quality_notes: string | null;
  quality_metrics: Record<string, any> | null;
  call_type?: string | null;
  lead_name?: string;
  lead_phone?: string;
  counsellor_name?: string;
  retry_count?: number;
  followup_status?: string;
  followup_date?: string;
  followup_counsellor?: string;
}

interface AiCallCursor {
  created_at: string;
  id: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-success/10 text-success",
  initiated: "bg-info/10 text-info-foreground",
  in_progress: "bg-warning/10 text-warning-foreground",
  failed: "bg-destructive/10 text-destructive",
  no_answer: "bg-muted text-muted-foreground",
};

type DateFilter = "today" | "yesterday" | "this_week" | "all" | "custom";

function getDateRange(filter: DateFilter, customFrom?: string, customTo?: string): { from: string | null; to: string | null } {
  const now = new Date();
  // IST offset
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const istDate = ist.toISOString().slice(0, 10);

  switch (filter) {
    case "today": {
      return { from: `${istDate}T00:00:00+05:30`, to: `${istDate}T23:59:59+05:30` };
    }
    case "yesterday": {
      const y = new Date(ist.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { from: `${y}T00:00:00+05:30`, to: `${y}T23:59:59+05:30` };
    }
    case "this_week": {
      const day = ist.getUTCDay();
      const mon = new Date(ist.getTime() - ((day === 0 ? 6 : day - 1) * 24 * 60 * 60 * 1000));
      return { from: `${mon.toISOString().slice(0, 10)}T00:00:00+05:30`, to: `${istDate}T23:59:59+05:30` };
    }
    case "custom": {
      return {
        from: customFrom ? `${customFrom}T00:00:00+05:30` : null,
        to: customTo ? `${customTo}T23:59:59+05:30` : null,
      };
    }
    default:
      return { from: null, to: null };
  }
}

const PAGE_SIZE = 50;

const AiCallLog = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<AiCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(0);
  const pageCursorsRef = useRef<Record<number, AiCallCursor>>({});
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, completed: 0, withRecording: 0, highConv: 0, inbound: 0 });
  const [activeStatFilter, setActiveStatFilter] = useState<"total" | "completed" | "withRecording" | "highConv" | "inbound" | null>(null);
  const [callTypeFilter, setCallTypeFilter] = useState<"all" | "ai" | "inbound" | "manual">("all");

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const { from: dateFrom, to: dateTo } = getDateRange(dateFilter, customFrom, customTo);
    const pageCursor = page > 0 ? pageCursorsRef.current[page] : null;
    if (page > 0 && !pageCursor) {
      setPage(0);
      setLoading(false);
      return;
    }

    if (page === 0) {
      const { data: statsData, error: statsError } = await supabase.rpc("ai_call_log_stats" as any, {
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });
      if (!statsError && statsData) {
        const nextStats = {
          total: Number((statsData as any).total ?? 0),
          completed: Number((statsData as any).completed ?? 0),
          withRecording: Number((statsData as any).withRecording ?? 0),
          highConv: Number((statsData as any).highConv ?? 0),
          inbound: Number((statsData as any).inbound ?? 0),
        };
        setTotalCount(nextStats.total);
        setStats(nextStats);
      } else if (statsError) {
        console.warn("[AiCallLog] stats skipped", statsError.message);
      }
    }

    // Fetch page data with joins. Same exclusion as countQuery so the list
    // matches the stats above.
    let query = supabase
      .from("ai_call_records" as any)
      .select(`
        id, lead_id, status, duration_seconds, recording_url, summary,
        conversion_probability, disposition, created_at,
        quality_score, quality_notes, quality_metrics, call_type,
        leads:lead_id(name, phone, counsellor_id,
          profiles:counsellor_id(display_name)
        )
      `)
      .neq("status", "counsellor_no_answer")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);
    if (pageCursor) {
      query = query.or(`created_at.lt.${pageCursor.created_at},and(created_at.eq.${pageCursor.created_at},id.lt.${pageCursor.id})`);
    }

    // Call type filter
    if (callTypeFilter === "ai") query = (query as any).or("call_type.eq.ai,call_type.is.null");
    if (callTypeFilter === "inbound") query = query.eq("call_type", "inbound");
    if (callTypeFilter === "manual") query = query.eq("call_type", "manual");

    // Stat card filters — server-side for accurate full-dataset results
    if (activeStatFilter === "completed") query = query.eq("status", "completed");
    if (activeStatFilter === "withRecording") query = (query as any).not("recording_url", "is", null);
    if (activeStatFilter === "highConv") query = query.gte("conversion_probability", 60);
    if (activeStatFilter === "inbound") query = query.eq("call_type", "inbound");

    const { data } = await query;

    if (data) {
      const fetchedRows = data as any[];
      const pageRows = fetchedRows.slice(0, PAGE_SIZE);
      const hasNext = fetchedRows.length > PAGE_SIZE;
      setHasNextPage(hasNext);
      const last = pageRows[pageRows.length - 1];
      if (last) {
        pageCursorsRef.current[page + 1] = { created_at: last.created_at, id: last.id };
      } else {
        delete pageCursorsRef.current[page + 1];
      }
      // Batch-fetch retry counts and followup info for all lead_ids in this page
      const leadIds = [...new Set(pageRows.map((r: any) => r.lead_id).filter(Boolean))];
      const [retryRes, followupRes] = await Promise.all([
        // Count total AI calls per lead
        supabase.from("ai_call_records" as any)
          .select("lead_id")
          .in("lead_id", leadIds),
        // Latest followup per lead
        supabase.from("lead_followups" as any)
          .select("lead_id, scheduled_at, status, type, notes")
          .in("lead_id", leadIds)
          .order("scheduled_at", { ascending: false }),
      ]);

      // Build retry count map
      const retryCounts: Record<string, number> = {};
      (retryRes.data || []).forEach((r: any) => {
        retryCounts[r.lead_id] = (retryCounts[r.lead_id] || 0) + 1;
      });

      // Build followup map (latest per lead)
      const followupMap: Record<string, any> = {};
      (followupRes.data || []).forEach((f: any) => {
        if (!followupMap[f.lead_id]) followupMap[f.lead_id] = f;
      });

      let mapped = pageRows.map((r: any) => {
        const fu = followupMap[r.lead_id];
        return {
          ...r,
          lead_name: r.leads?.name || "Unknown",
          lead_phone: r.leads?.phone || "",
          counsellor_name: r.leads?.profiles?.display_name || "Unassigned",
          retry_count: retryCounts[r.lead_id] || 1,
          followup_status: fu?.status || null,
          followup_date: fu?.scheduled_at || null,
          followup_counsellor: r.leads?.profiles?.display_name || null,
        };
      });

      // Client-side search filter (across joined fields)
      if (search) {
        const q = search.toLowerCase();
        mapped = mapped.filter((r) =>
          (r.lead_name || "").toLowerCase().includes(q) ||
          (r.lead_phone || "").includes(q) ||
          (r.summary || "").toLowerCase().includes(q) ||
          (r.disposition || "").toLowerCase().includes(q)
        );
      }

      setRecords(mapped);
    }
    setLoading(false);
  }, [dateFilter, customFrom, customTo, page, search, activeStatFilter, callTypeFilter]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
    pageCursorsRef.current = {};
    setHasNextPage(false);
  }, [dateFilter, customFrom, customTo, search, activeStatFilter, callTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fmtDuration = (s: number | null) => {
    if (!s) return "—";
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  };

  const dateButtons: { key: DateFilter; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "this_week", label: "This Week" },
    { key: "all", label: "All Time" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI Call Log</h1>
        <p className="text-sm text-muted-foreground mt-1">All AI-initiated calls with recordings and assessments</p>
      </div>

      {/* Quality dashboard — 7-day rolling stats */}
      <VoiceQualityDashboard />

      {/* Live queue status — auto-refreshes every 20s */}
      <AiCallQueueStatus />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {([
          { key: "total" as const, label: "Total Calls", value: stats.total, icon: Bot, bg: "bg-pastel-blue" },
          { key: "completed" as const, label: "Completed", value: stats.completed, icon: CheckCircle, bg: "bg-pastel-green" },
          { key: "inbound" as const, label: "Inbound (Website)", value: stats.inbound, icon: PhoneIncoming, bg: "bg-pastel-purple" },
          { key: "withRecording" as const, label: "With Recording", value: stats.withRecording, icon: Play, bg: "bg-pastel-orange" },
          { key: "highConv" as const, label: "High Conversion", value: stats.highConv, icon: AlertCircle, bg: "bg-destructive/10" },
        ]).map((s, i) => {
          const isActive = s.key === "total" ? activeStatFilter === null : activeStatFilter === s.key;
          const handleClick = () => {
            if (s.key === "total") { setActiveStatFilter(null); return; }
            setActiveStatFilter(activeStatFilter === s.key ? null : s.key);
          };
          return (
            <Card
              key={s.label}
              onClick={handleClick}
              className={`border-border/60 shadow-none cursor-pointer transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1 animate-rs-slide-up ${isActive ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100"}`}
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
            >
              <CardContent className="p-4">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} mb-2`}>
                  <s.icon className="h-4 w-4 text-foreground/70" />
                </div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5">{loading ? "—" : s.value.toLocaleString()}</p>
                {isActive && s.key !== "total" && (
                  <p className="text-[10px] text-primary font-medium mt-1">Filtered — click to clear</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Call type filter */}
        <div className="flex items-center gap-1 rounded-xl border border-input bg-card p-0.5">
          {([
            { key: "all" as const, label: "All Types" },
            { key: "ai" as const, label: "AI Outbound", icon: Bot },
            { key: "inbound" as const, label: "Inbound", icon: PhoneIncoming },
            { key: "manual" as const, label: "Manual", icon: Phone },
          ]).map((t) => (
            <button key={t.key} onClick={() => setCallTypeFilter(t.key)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                callTypeFilter === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}>
              {t.icon && <t.icon className="h-3 w-3" />}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {dateButtons.map((b) => (
            <button key={b.key} onClick={() => setDateFilter(b.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                dateFilter === b.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-input bg-card text-muted-foreground hover:bg-muted"
              }`}>
              {b.label}
            </button>
          ))}
        </div>

        {dateFilter === "custom" && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg border border-input bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-input bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </div>
        )}

        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search name, phone, summary..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-x-auto">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Type</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Direction</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Conversion</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Quality</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Retries</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Follow-up</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date & Time</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Recording</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const probColor = (r.conversion_probability || 0) >= 60 ? "bg-success/10 text-success"
                    : (r.conversion_probability || 0) >= 40 ? "bg-warning/10 text-warning-foreground"
                    : r.conversion_probability ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground";

                  return (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/admissions/${r.lead_id}`)}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground">{r.lead_name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.call_type === "inbound"
                          ? <Badge className="text-[9px] border-0 bg-primary/10 text-primary gap-0.5"><PhoneIncoming className="h-2.5 w-2.5" />Inbound</Badge>
                          : r.call_type === "manual"
                          ? <Badge className="text-[9px] border-0 bg-cyan-100 text-cyan-700 gap-0.5"><Phone className="h-2.5 w-2.5" />Manual</Badge>
                          : <Badge className="text-[9px] border-0 bg-warning/10 text-warning-foreground gap-0.5"><Bot className="h-2.5 w-2.5" />AI</Badge>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.call_type === "inbound"
                          ? <Badge className="text-[9px] border-0 bg-primary/10 text-primary gap-0.5"><PhoneIncoming className="h-2.5 w-2.5" />Inbound</Badge>
                          : <Badge className="text-[9px] border-0 bg-sky-100 text-sky-700 gap-0.5"><PhoneOutgoing className="h-2.5 w-2.5" />Outbound</Badge>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge className={`text-[10px] border-0 ${STATUS_COLORS[r.status] || "bg-muted"}`}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                        {fmtDuration(r.duration_seconds)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.conversion_probability ? (
                          <Badge className={`text-[10px] border-0 ${probColor}`}>{r.conversion_probability}%</Badge>
                        ) : <span className="text-[10px] text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[250px]">
                        <p className="line-clamp-2">{r.summary || "—"}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1">
                          <CallQualityRating
                            callLogId={r.id}
                            initialScore={r.quality_score}
                            initialNotes={r.quality_notes}
                            compact
                          />
                          <CallQualityMetricsChip metrics={r.quality_metrics} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs font-medium ${(r.retry_count || 1) > 1 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                          {r.retry_count || 1}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.followup_status ? (
                          <div>
                            <Badge className={`text-[10px] border-0 ${
                              r.followup_status === "pending" ? "bg-warning/10 text-warning-foreground"
                              : r.followup_status === "completed" ? "bg-success/10 text-success"
                              : "bg-muted text-muted-foreground"
                            }`}>
                              {r.followup_status}
                            </Badge>
                            {r.followup_date && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {new Date(r.followup_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
                              </div>
                            )}
                          </div>
                        ) : <span className="text-[10px] text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.counsellor_name}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        <div>{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</div>
                        <div className="text-[10px]">{new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.recording_url ? (
                          <a href={r.recording_url} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                            <Play className="h-3 w-3" /> Play
                          </a>
                        ) : <span className="text-[10px] text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr><td colSpan={13} className="px-4 py-12 text-center text-muted-foreground">
                    <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No AI call records found</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {(totalPages > 1 || hasNextPage) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()} calls
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="rounded-lg border border-input bg-card p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <button onClick={() => setPage(page + 1)} disabled={!hasNextPage}
              className="rounded-lg border border-input bg-card p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiCallLog;

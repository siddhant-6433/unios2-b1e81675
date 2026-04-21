import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Search, Loader2, CheckCircle, Play, AlertCircle, ChevronLeft, ChevronRight, Calendar,
} from "lucide-react";

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
  lead_name?: string;
  lead_phone?: string;
  counsellor_name?: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  initiated: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
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
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, completed: 0, withRecording: 0, highConv: 0 });

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const { from: dateFrom, to: dateTo } = getDateRange(dateFilter, customFrom, customTo);

    // Build query for count + stats
    let countQuery = supabase
      .from("ai_call_records" as any)
      .select("id, status, recording_url, conversion_probability", { count: "exact", head: false });

    if (dateFrom) countQuery = countQuery.gte("created_at", dateFrom);
    if (dateTo) countQuery = countQuery.lte("created_at", dateTo);
    if (search) {
      // For search, we need to join with leads — skip count optimization, filter client-side
    }

    const { data: countData, count } = await countQuery;
    const allForStats = countData || [];
    setTotalCount(count || allForStats.length);
    setStats({
      total: count || allForStats.length,
      completed: allForStats.filter((r: any) => r.status === "completed").length,
      withRecording: allForStats.filter((r: any) => r.recording_url).length,
      highConv: allForStats.filter((r: any) => (r.conversion_probability || 0) >= 70).length,
    });

    // Fetch page data with joins
    let query = supabase
      .from("ai_call_records" as any)
      .select(`
        id, lead_id, status, duration_seconds, recording_url, summary,
        conversion_probability, disposition, created_at,
        leads:lead_id(name, phone, counsellor_id,
          profiles:counsellor_id(display_name)
        )
      `)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const { data } = await query;

    if (data) {
      let mapped = (data as any[]).map((r: any) => ({
        ...r,
        lead_name: r.leads?.name || "Unknown",
        lead_phone: r.leads?.phone || "",
        counsellor_name: r.leads?.profiles?.display_name || "Unassigned",
      }));

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
  }, [dateFilter, customFrom, customTo, page, search]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [dateFilter, customFrom, customTo, search]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total AI Calls", value: stats.total, icon: Bot, bg: "bg-pastel-blue" },
          { label: "Completed", value: stats.completed, icon: CheckCircle, bg: "bg-pastel-green" },
          { label: "With Recording", value: stats.withRecording, icon: Play, bg: "bg-pastel-purple" },
          { label: "High Conversion", value: stats.highConv, icon: AlertCircle, bg: "bg-pastel-orange" },
        ].map((s) => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} mb-2`}>
                <s.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-2xl font-bold text-foreground">{loading ? "—" : s.value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
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
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Conversion</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Summary</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date & Time</th>
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Recording</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const probColor = (r.conversion_probability || 0) >= 70 ? "bg-emerald-100 text-emerald-700"
                    : (r.conversion_probability || 0) >= 40 ? "bg-amber-100 text-amber-700"
                    : r.conversion_probability ? "bg-red-100 text-red-700"
                    : "bg-muted text-muted-foreground";

                  return (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/admissions/${r.lead_id}`)}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground">{r.lead_name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
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
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[300px]">
                        <p className="line-clamp-2">{r.summary || "—"}</p>
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
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()} calls
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="rounded-lg border border-input bg-card p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 4) {
                pageNum = i;
              } else if (page > totalPages - 5) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    page === pageNum
                      ? "bg-primary text-primary-foreground"
                      : "border border-input bg-card text-muted-foreground hover:bg-muted"
                  }`}>
                  {pageNum + 1}
                </button>
              );
            })}
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
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

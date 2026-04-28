import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Phone, Clock, Search, Loader2, ExternalLink,
  CheckCircle, XCircle, AlertCircle, Play, PhoneCall, Calendar,
} from "lucide-react";

const DISPOSITION_COLORS: Record<string, string> = {
  interested: "bg-emerald-100 text-emerald-700",
  not_interested: "bg-red-100 text-red-700",
  not_answered: "bg-amber-100 text-amber-700",
  no_answer: "bg-amber-100 text-amber-700",
  "no-answer": "bg-amber-100 text-amber-700",
  voicemail: "bg-indigo-100 text-indigo-700",
  call_back: "bg-blue-100 text-blue-700",
  callback: "bg-blue-100 text-blue-700",
  busy: "bg-orange-100 text-orange-700",
  cancelled: "bg-slate-100 text-slate-600",
  timeout: "bg-amber-100 text-amber-600",
  failed: "bg-red-100 text-red-600",
  completed: "bg-green-100 text-green-700",
  wrong_number: "bg-pink-100 text-pink-700",
  do_not_contact: "bg-red-200 text-red-800",
  ineligible: "bg-gray-100 text-gray-600",
};

type DatePreset = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "all" | "custom";

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const todayStr = fmt(today);
  switch (preset) {
    case "today": return { from: todayStr, to: todayStr };
    case "yesterday": { const y = new Date(today); y.setDate(y.getDate() - 1); return { from: fmt(y), to: fmt(y) }; }
    case "this_week": { const d = new Date(today); const day = d.getDay(); d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); return { from: fmt(d), to: todayStr }; }
    case "last_week": { const end = new Date(today); const day = end.getDay(); end.setDate(end.getDate() - (day === 0 ? 6 : day - 1) - 1); const start = new Date(end); start.setDate(start.getDate() - 6); return { from: fmt(start), to: fmt(end) }; }
    case "this_month": return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, to: todayStr };
    default: return { from: "", to: "" };
  }
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "all", label: "All Time" },
];

const PAGE_SIZE = 50;

const CallLog = () => {
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const isCounsellor = role === "counsellor";
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Filters
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [dispositionFilter, setDispositionFilter] = useState("all");
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);

  // Stats (from full query, not paginated)
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, interested: 0, not_interested: 0, no_answer: 0, busy: 0, call_back: 0 });

  // Fetch counsellor list + resolve current user's auth ID
  useEffect(() => {
    (async () => {
      // Set current user auth ID for counsellor self-filter
      if (user?.id) setMyUserId(user.id);

      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roleRows?.length) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name, user_id").in("user_id", roleRows.map(r => r.user_id));
      if (profs) {
        setCounsellorOptions(profs.map(p => ({ id: p.user_id, name: p.display_name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)));
        // Auto-filter counsellor to own calls if logged in as counsellor
        if (isCounsellor && user?.id) setCounsellorFilter(user.id);
      }
    })();
  }, [user?.id]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);

    const { from, to } = datePreset === "custom" ? { from: customFrom, to: customTo } : getDateRange(datePreset);

    let query = supabase
      .from("call_logs" as any)
      .select(`
        id, lead_id, disposition, duration_seconds, notes, recording_url, created_at, called_at, user_id,
        leads:lead_id(name, phone, stage, source)
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (from) query = query.gte("created_at", `${from}T00:00:00`);
    if (to) query = query.lte("created_at", `${to}T23:59:59`);

    // Server-side counsellor filter by user_id (who made the call)
    if (counsellorFilter !== "all") {
      query = query.eq("user_id", counsellorFilter);
    } else if (isCounsellor && myUserId) {
      query = query.eq("user_id", myUserId);
    }

    const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (data) {
      // Batch-fetch caller profiles
      const callerIds = [...new Set((data as any[]).map((r: any) => r.user_id).filter(Boolean))];
      const callerMap: Record<string, string> = {};
      if (callerIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", callerIds);
        (profs || []).forEach((p: any) => { callerMap[p.user_id] = p.display_name || "Unknown"; });
      }

      let enriched = (data as any[]).map((r: any) => ({
        ...r,
        lead_name: r.leads?.name || "Unknown",
        lead_phone: r.leads?.phone || "",
        lead_stage: r.leads?.stage || "",
        lead_source: r.leads?.source || "",
        caller_user_id: r.user_id || "",
        counsellor_name: callerMap[r.user_id] || "Unknown",
      }));

      setRecords(enriched);
      setTotalCount(count || enriched.length);

      // Compute stats from this page (ideally from full dataset, but good enough for filtered view)
      const s = { total: count || enriched.length, interested: 0, not_interested: 0, no_answer: 0, busy: 0, call_back: 0 };
      enriched.forEach(r => {
        if (r.disposition === "interested") s.interested++;
        else if (r.disposition === "not_interested") s.not_interested++;
        else if (["not_answered", "no_answer", "voicemail"].includes(r.disposition)) s.no_answer++;
        else if (r.disposition === "busy") s.busy++;
        else if (["call_back", "callback"].includes(r.disposition)) s.call_back++;
      });
      setStats(s);
    }
    setLoading(false);
  }, [datePreset, customFrom, customTo, page, counsellorFilter, myUserId]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { setPage(1); }, [datePreset, counsellorFilter, dispositionFilter]);

  // Client-side filters (disposition + search — counsellor is now server-side)
  const filtered = records.filter(r => {
    if (dispositionFilter !== "all" && r.disposition !== dispositionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.lead_name || "").toLowerCase().includes(q) ||
        (r.lead_phone || "").includes(q) ||
        (r.disposition || "").toLowerCase().includes(q) ||
        (r.counsellor_name || "").toLowerCase().includes(q) ||
        (r.notes || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const formatDuration = (s: number | null) => {
    if (!s) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const inputCls = "rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isCounsellor ? "My Call Log" : "Manual Call Log"}</h1>
        <p className="text-sm text-muted-foreground mt-1">{isCounsellor ? "Your manually logged calls" : "All calls logged manually by counsellors"}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Total Calls", value: stats.total, icon: PhoneCall, bg: "bg-pastel-blue" },
          { label: "Interested", value: stats.interested, icon: CheckCircle, bg: "bg-pastel-green" },
          { label: "Not Interested", value: stats.not_interested, icon: XCircle, bg: "bg-pastel-red" },
          { label: "No Answer", value: stats.no_answer, icon: AlertCircle, bg: "bg-pastel-orange" },
          { label: "Busy", value: stats.busy, icon: Phone, bg: "bg-pastel-yellow" },
          { label: "Call Back", value: stats.call_back, icon: Clock, bg: "bg-pastel-mint" },
        ].map((s) => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-3">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${s.bg} mb-1.5`}>
                <s.icon className="h-3.5 w-3.5 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date presets */}
        <div className="flex rounded-xl border border-input bg-card p-0.5">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setDatePreset(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                datePreset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        <div className="flex items-center gap-1.5">
          <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setDatePreset("custom"); }} className={`${inputCls} w-[130px] text-xs`} />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setDatePreset("custom"); }} className={`${inputCls} w-[130px] text-xs`} />
        </div>

        {/* Counsellor filter (admins only — counsellors are auto-filtered) */}
        {!isCounsellor && (
          <select value={counsellorFilter} onChange={e => setCounsellorFilter(e.target.value)} className={inputCls}>
            <option value="all">All Counsellors</option>
            {counsellorOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {/* Disposition filter */}
        <select value={dispositionFilter} onChange={e => setDispositionFilter(e.target.value)} className={inputCls}>
          <option value="all">All Dispositions</option>
          <option value="interested">Interested</option>
          <option value="not_interested">Not Interested</option>
          <option value="not_answered">Not Answered</option>
          <option value="busy">Busy</option>
          <option value="call_back">Call Back</option>
          <option value="voicemail">Voicemail</option>
          <option value="wrong_number">Wrong Number</option>
          <option value="do_not_contact">DNC</option>
          <option value="ineligible">Ineligible</option>
          <option value="cancelled">Cancelled</option>
          <option value="timeout">Timeout</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search name, phone, notes..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
      </div>

      {/* Pagination header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of <span className="font-semibold text-foreground">{totalCount}</span> calls
          {datePreset !== "all" && <span> ({PRESETS.find(p => p.key === datePreset)?.label || "Custom"})</span>}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(1)} disabled={page <= 1}
              className="rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted">First</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Prev</button>
            <span className="text-xs text-muted-foreground px-2">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Next</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted">Last</button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase">Lead</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase">Type</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase">Disposition</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase">Duration</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase">Notes</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase">Called By</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase">Date & Time</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase">Recording</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(`/admissions/${r.lead_id}`)}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground text-sm">{r.lead_name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {(r.notes || "").includes("Cloud Call") ? (
                          <Badge className="text-[9px] border-0 bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400">Cloud Call</Badge>
                        ) : (
                          <Badge className="text-[9px] border-0 bg-gray-100 text-gray-500">Manual</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge className={`text-[10px] border-0 ${DISPOSITION_COLORS[r.disposition || ""] || "bg-muted text-muted-foreground"}`}>
                          {(r.disposition || "pending").replace(/_/g, " ").replace(/-/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                        {formatDuration(r.duration_seconds)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[250px] truncate">
                        {r.notes || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.counsellor_name}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.called_at || r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        <span className="text-[9px] ml-1 text-muted-foreground/60">
                          {new Date(r.called_at || r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {r.recording_url ? (
                          <a href={r.recording_url} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-primary hover:underline text-xs flex items-center justify-center gap-1">
                            <Play className="h-3 w-3" /> Play
                          </a>
                        ) : <span className="text-[10px] text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                        <Phone className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No call records found</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {totalCount} total calls
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallLog;

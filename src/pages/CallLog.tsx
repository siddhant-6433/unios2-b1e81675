import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, FieldShell } from "@/components/ui/state-fields";
import {
  Phone, Clock, Search, Loader2, ExternalLink,
  CheckCircle, XCircle, AlertCircle, Play, PhoneCall, Calendar,
} from "lucide-react";

const DISPOSITION_COLORS: Record<string, string> = {
  interested: "bg-success/10 text-success",
  not_interested: "bg-destructive/10 text-destructive",
  not_answered: "bg-warning/10 text-warning-foreground",
  no_answer: "bg-warning/10 text-warning-foreground",
  "no-answer": "bg-warning/10 text-warning-foreground",
  voicemail: "bg-primary/10 text-primary",
  call_back: "bg-info/10 text-info-foreground",
  callback: "bg-info/10 text-info-foreground",
  busy: "bg-warning/10 text-warning-foreground",
  timeout: "bg-warning/10 text-warning-foreground",
  failed: "bg-destructive/10 text-destructive",
  completed: "bg-success/10 text-success",
  wrong_number: "bg-pink-100 text-pink-700",
  do_not_contact: "bg-destructive/15 text-destructive",
  ineligible: "bg-gray-100 text-gray-600",
  cold: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
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
const EMPTY_STATS = { total: 0, interested: 0, not_interested: 0, no_answer: 0, busy: 0, call_back: 0 };

interface CallLogLead {
  name: string | null;
  phone: string | null;
  stage: string | null;
  source: string | null;
}

interface CallLogRow {
  id: string;
  lead_id: string;
  disposition: string | null;
  duration_seconds: number | null;
  notes: string | null;
  recording_url: string | null;
  created_at: string;
  called_at: string | null;
  user_id: string | null;
  cloud_call_uuid?: string | null;
  source?: string | null;
  leads?: CallLogLead | null;
}

interface EnrichedCallLog extends CallLogRow {
  lead_name: string;
  lead_phone: string;
  lead_stage: string;
  lead_source: string;
  caller_user_id: string;
  counsellor_name: string;
}

interface CallerProfile {
  user_id: string | null;
  display_name: string | null;
}

interface AiCallRecording {
  call_uuid: string | null;
  recording_url: string | null;
}

interface CallLogCursor {
  created_at: string;
  id: string;
}

interface CallLogMetrics {
  total?: number;
  interested?: number;
  not_interested?: number;
  no_answer?: number;
  busy?: number;
  call_back?: number;
  counsellors?: { id: string | null; name: string | null; count: number | null }[];
}

const CallLog = () => {
  const navigate = useNavigate();
  const { role, roleLoaded, user, profile } = useAuth();
  const isCounsellor = role === "counsellor";
  const [records, setRecords] = useState<EnrichedCallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const callPageCursorsRef = useRef<Record<number, CallLogCursor>>({});
  const [hasNextCallPage, setHasNextCallPage] = useState(false);

  // Filters
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [dispositionFilter, setDispositionFilter] = useState("all");
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);

  const [playingId, setPlayingId] = useState<string | null>(null);

  // Stats (from full query, not paginated)
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [counsellorStats, setCounsellorStats] = useState<{ id: string; name: string; count: number }[]>([]);

  const scopedCounsellorId = isCounsellor ? user?.id ?? null : counsellorFilter !== "all" ? counsellorFilter : null;

  // Fetch counsellor list for admins. Counsellors are always scoped to self.
  useEffect(() => {
    (async () => {
      if (!roleLoaded || !user?.id) return;

      if (isCounsellor) {
        setCounsellorFilter(user.id);
        setCounsellorOptions([{ id: user.id, name: profile?.display_name || "You" }]);
        setCounsellorStats([]);
        return;
      }

      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roleRows?.length) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name, user_id").in("user_id", roleRows.map(r => r.user_id));
      if (profs) {
        setCounsellorOptions(profs.map(p => ({ id: p.user_id, name: p.display_name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)));
      }
    })();
  }, [isCounsellor, profile?.display_name, roleLoaded, setCounsellorFilter, user?.id]);

  const fetchRecords = useCallback(async () => {
    if (!roleLoaded || !user?.id) {
      setRecords([]);
      setTotalCount(0);
      setStats(EMPTY_STATS);
      setCounsellorStats([]);
      setLoading(true);
      return;
    }

    setLoading(true);

    const { from, to } = datePreset === "custom" ? { from: customFrom, to: customTo } : getDateRange(datePreset);
    const pageCursor = page > 1 ? callPageCursorsRef.current[page] : null;
    if (page > 1 && !pageCursor) {
      setPage(1);
      setLoading(false);
      return;
    }

    let query = supabase
      .from("call_logs")
      .select(`
        id, lead_id, disposition, duration_seconds, notes, recording_url, created_at, called_at, user_id, cloud_call_uuid, source,
        leads:lead_id(name, phone, stage, source)
      `)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .not("disposition", "in", '("cancelled","cancelled_by_counsellor")')
      .limit(PAGE_SIZE + 1);

    if (from) query = query.gte("created_at", `${from}T00:00:00`);
    if (to) query = query.lte("created_at", `${to}T23:59:59`);
    if (pageCursor) {
      query = query.or(`created_at.lt.${pageCursor.created_at},and(created_at.eq.${pageCursor.created_at},id.lt.${pageCursor.id})`);
    }

    // Server-side counsellor filter by user_id (who made the call).
    // For counsellors, bind directly to the authenticated user once role is
    // loaded; never rely on the shared dropdown state for data isolation.
    if (scopedCounsellorId) {
      query = query.eq("user_id", scopedCounsellorId);
    }

    const { data } = await query;

    if (data) {
      const rows = (data as unknown as CallLogRow[]).slice(0, PAGE_SIZE);
      const hasNext = (data as unknown as CallLogRow[]).length > PAGE_SIZE;
      // Batch-fetch caller profiles
      const callerIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id)))];
      const callerMap: Record<string, string> = {};
      if (callerIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", callerIds);
        ((profs || []) as CallerProfile[]).forEach((p) => {
          if (p.user_id) callerMap[p.user_id] = p.display_name || "Unknown";
        });
      }

      let enriched: EnrichedCallLog[] = rows.map((r) => ({
        ...r,
        lead_name: r.leads?.name || "Unknown",
        lead_phone: r.leads?.phone || "",
        lead_stage: r.leads?.stage || "",
        lead_source: r.leads?.source || "",
        caller_user_id: r.user_id || "",
        counsellor_name: callerMap[r.user_id] || "Unknown",
      }));

      // Cloud Call rows have no recording_url in call_logs — Plivo's recording
      // callback only updates ai_call_records. Match by cloud_call_uuid (the
      // canonical column the dedup migration added). Falls back to the legacy
      // "Cloud Call [hash]" notes pattern for rows that pre-date the column.
      const cloudUuids = [...new Set(
        enriched.filter(r => !r.recording_url && r.cloud_call_uuid).map(r => r.cloud_call_uuid)
      )];
      const legacyCloudLeadIds = [...new Set(
        enriched
          .filter(r => !r.recording_url && !r.cloud_call_uuid && /Cloud Call \[[a-f0-9]{8}\]/.test(r.notes || ""))
          .map(r => r.lead_id)
      )];

      const recByUuid: Record<string, string> = {};
      const recByPrefix: Record<string, string> = {};

      if (cloudUuids.length > 0) {
        const { data: aiRecs } = await supabase
          .from("ai_call_records")
          .select("call_uuid, recording_url")
          .in("call_uuid", cloudUuids)
          .not("recording_url", "is", null);
        ((aiRecs || []) as AiCallRecording[]).forEach((rec) => {
          if (rec.call_uuid && rec.recording_url) recByUuid[rec.call_uuid] = rec.recording_url;
        });
      }
      if (legacyCloudLeadIds.length > 0) {
        const { data: aiRecs } = await supabase
          .from("ai_call_records")
          .select("call_uuid, recording_url")
          .in("lead_id", legacyCloudLeadIds)
          .not("recording_url", "is", null);
        ((aiRecs || []) as AiCallRecording[]).forEach((rec) => {
          if (rec.call_uuid && rec.recording_url) recByPrefix[rec.call_uuid.slice(0, 8)] = rec.recording_url;
        });
      }

      enriched = enriched.map(r => {
        if (r.recording_url) return r;
        if (r.cloud_call_uuid && recByUuid[r.cloud_call_uuid]) {
          return { ...r, recording_url: recByUuid[r.cloud_call_uuid] };
        }
        const m = (r.notes || "").match(/Cloud Call \[([a-f0-9]{8})\]/i);
        if (m && recByPrefix[m[1]]) return { ...r, recording_url: recByPrefix[m[1]] };
        return r;
      });

      setRecords(enriched);
      setHasNextCallPage(hasNext);
      if (hasNext && enriched.length > 0) {
        const last = enriched[enriched.length - 1];
        callPageCursorsRef.current[page + 1] = { created_at: last.created_at, id: last.id };
      } else {
        delete callPageCursorsRef.current[page + 1];
      }

      if (page === 1) {
        const { data: metricsData, error: metricsError } = await supabase.rpc("call_log_metrics", {
          p_from_date: from || null,
          p_to_date: to || null,
          p_counsellor_id: scopedCounsellorId,
        });

        if (metricsError) {
          console.error("Failed to fetch call log metrics", metricsError);
          const fallbackStats = { ...EMPTY_STATS, total: enriched.length };
          enriched.forEach(r => {
            if (r.disposition === "interested") fallbackStats.interested++;
            else if (r.disposition === "not_interested") fallbackStats.not_interested++;
            else if (["not_answered", "no_answer", "voicemail"].includes(r.disposition || "")) fallbackStats.no_answer++;
            else if (r.disposition === "busy") fallbackStats.busy++;
            else if (["call_back", "callback"].includes(r.disposition || "")) fallbackStats.call_back++;
          });
          setTotalCount(fallbackStats.total);
          setStats(fallbackStats);
          setCounsellorStats([]);
        } else {
          const metrics = (metricsData || EMPTY_STATS) as CallLogMetrics;
          const nextStats = {
            total: metrics.total || 0,
            interested: metrics.interested || 0,
            not_interested: metrics.not_interested || 0,
            no_answer: metrics.no_answer || 0,
            busy: metrics.busy || 0,
            call_back: metrics.call_back || 0,
          };
          setTotalCount(nextStats.total);
          setStats(nextStats);
          setCounsellorStats((metrics.counsellors || [])
            .filter((c): c is { id: string; name: string | null; count: number | null } => Boolean(c.id))
            .map(c => ({
              id: c.id,
              name: c.name || "Unknown",
              count: c.count || 0,
            })));
        }
      }
    }

    setLoading(false);
  }, [datePreset, customFrom, customTo, page, scopedCounsellorId, roleLoaded, user?.id]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => {
    setPage(1);
    callPageCursorsRef.current = {};
    setHasNextCallPage(false);
  }, [datePreset, counsellorFilter, dispositionFilter]);

  // Client-side filters (disposition + search — counsellor is now server-side)
  const filtered = records.filter(r => {
    if (["cancelled", "cancelled_by_counsellor"].includes(r.disposition || "")) return false;
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

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const formatDuration = (s: number | null) => {
    if (!s) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

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

      {/* Counsellor-wise calls. Counsellors see only their own scoped row. */}
      {counsellorStats.length > 0 && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{isCounsellor ? "My Calls" : "Calls by Counsellor"}</p>
                <p className="text-[11px] text-muted-foreground">
                  {datePreset === "all" ? "All time" : PRESETS.find(p => p.key === datePreset)?.label || "Custom range"}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {counsellorStats.reduce((sum, c) => sum + c.count, 0)} total
              </p>
            </div>
            <div className="space-y-2">
              {(() => {
                const max = Math.max(1, ...counsellorStats.map(c => c.count));
                return counsellorStats.map(c => {
                  const pct = (c.count / max) * 100;
                  const isActive = counsellorFilter === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        if (!isCounsellor) setCounsellorFilter(isActive ? "all" : c.id);
                      }}
                      disabled={isCounsellor}
                      className={`w-full text-left group ${isCounsellor ? "cursor-default" : isActive ? "" : "hover:opacity-90"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium ${isActive ? "text-primary" : "text-foreground"} truncate`}>{c.name}</span>
                        <span className="text-xs font-semibold text-foreground tabular-nums">{c.count}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isActive ? "bg-primary" : "bg-primary/60 group-hover:bg-primary/80"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>
      )}

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
          <FieldShell hideLabel><Input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setDatePreset("custom"); }} className="w-[130px]" /></FieldShell>
          <span className="text-xs text-muted-foreground">to</span>
          <FieldShell hideLabel><Input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setDatePreset("custom"); }} className="w-[130px]" /></FieldShell>
        </div>

        {/* Counsellor filter (admins only — counsellors are auto-filtered) */}
        {!isCounsellor && (
          <SelectField
            value={counsellorFilter}
            onValueChange={setCounsellorFilter}
            options={[
              { value: "all", label: "All Counsellors" },
              ...counsellorOptions.map(c => ({ value: c.id, label: c.name })),
            ]}
            hideLabel
            placeholder="All Counsellors"
            className="min-w-[160px]"
          />
        )}

        {/* Disposition filter */}
        <SelectField
          value={dispositionFilter}
          onValueChange={setDispositionFilter}
          options={[
            { value: "all", label: "All Dispositions" },
            { value: "interested", label: "Interested" },
            { value: "not_interested", label: "Not Interested" },
            { value: "not_answered", label: "Not Answered" },
            { value: "busy", label: "Busy" },
            { value: "call_back", label: "Call Back" },
            { value: "voicemail", label: "Voicemail" },
            { value: "wrong_number", label: "Wrong Number" },
            { value: "do_not_contact", label: "DNC" },
            { value: "ineligible", label: "Ineligible" },
            { value: "timeout", label: "Timeout" },
          ]}
          hideLabel
          placeholder="All Dispositions"
          className="min-w-[160px]"
        />

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
        {(totalPages > 1 || hasNextCallPage) && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(1)} disabled={page <= 1}
              className="rounded-lg border border-input bg-card px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted">First</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Prev</button>
            <span className="text-xs text-muted-foreground px-2">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasNextCallPage}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Next</button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <PageLoader />
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
                        {/* Cloud Call badge requires a real channel attribution.
                            Pre-source-column rows fall back to the legacy
                            "Cloud Call [hash]" notes pattern. Just having a
                            cloud_call_uuid is not enough — manual_log entries
                            ship a random UUID through the merge RPC. */}
                        {(r.source === "cloud_dialer" || (r.notes || "").match(/Cloud Call \[[a-f0-9]{8}\]/i)) ? (
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
                      <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                        {r.recording_url ? (
                          playingId === r.id ? (
                            <audio
                              src={r.recording_url}
                              controls
                              autoPlay
                              className="h-7 w-44 max-w-full"
                              onEnded={() => setPlayingId(null)}
                            />
                          ) : (
                            <button
                              onClick={() => setPlayingId(r.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
                            >
                              <Play className="h-3 w-3 fill-primary" /> Play
                            </button>
                          )
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
      {(totalPages > 1 || hasNextCallPage) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {totalCount} total calls
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Prev</button>
            <button onClick={() => setPage(p => p + 1)} disabled={!hasNextCallPage}
              className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium disabled:opacity-40 hover:bg-muted">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallLog;

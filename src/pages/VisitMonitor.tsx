import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Calendar, MapPin, User, CheckCircle2, XCircle, Clock, Footprints,
  AlertCircle, Filter, RefreshCw, Loader2, ChevronRight, PhoneCall,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Visit {
  id: string;
  lead_id: string;
  visit_date: string;
  status: string;
  visit_type: string | null;
  feedback: string | null;
  created_at: string;
  updated_at: string;
  campus_id: string | null;
  scheduled_by: string | null;
  lead_name: string;
  lead_phone: string;
  counsellor_name: string;
  campus_name: string;
}

interface Counsellor { id: string; display_name: string; }
interface Campus { id: string; name: string; }

type Tab = "scheduled" | "completed" | "no_show" | "unmarked" | "walkins" | "post_visit";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled:  { label: "Scheduled",  color: "text-blue-700",   bg: "bg-blue-50 border-blue-200" },
  confirmed:  { label: "Confirmed",  color: "text-teal-700",   bg: "bg-teal-50 border-teal-200" },
  completed:  { label: "Completed",  color: "text-emerald-700",bg: "bg-emerald-50 border-emerald-200" },
  no_show:    { label: "No Show",    color: "text-rose-700",   bg: "bg-rose-50 border-rose-200" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VisitMonitor() {
  const [tab, setTab] = useState<Tab>("scheduled");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [counsellorId, setCounsellorId] = useState("");
  const [campusId, setCampusId] = useState("");
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  );
  const [dateTo, setDateTo] = useState(
    new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
  );

  const [counsellors, setCounsellors] = useState<Counsellor[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);

  // Summary counts (unfiltered by tab, but filtered by counsellor/campus/date)
  const [counts, setCounts] = useState({
    scheduled: 0, completed: 0, no_show: 0, unmarked: 0, walkins: 0, post_visit: 0,
  });

  // Load counsellors + campuses once
  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("id, display_name").order("display_name"),
      supabase.from("campuses").select("id, name").order("name"),
    ]).then(([pRes, cRes]) => {
      if (pRes.data) setCounsellors(pRes.data as Counsellor[]);
      if (cRes.data) setCampuses(cRes.data as Campus[]);
    });
  }, []);

  const buildQuery = useCallback(() => {
    const now = new Date().toISOString();
    const fromIso = new Date(dateFrom).toISOString();
    const toIso = new Date(dateTo + "T23:59:59").toISOString();

    return { now, fromIso, toIso };
  }, [dateFrom, dateTo]);

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    const { now, fromIso, toIso } = buildQuery();

    // Build the joined query
    let q = supabase
      .from("campus_visits")
      .select(`
        id, lead_id, visit_date, status, visit_type, feedback, created_at, updated_at,
        campus_id, scheduled_by,
        leads!inner(name, phone, counsellor_id,
          profiles:counsellor_id(display_name)),
        campuses(name)
      `)
      .gte("visit_date", fromIso)
      .lte("visit_date", toIso)
      .order("visit_date", { ascending: tab === "scheduled" || tab === "unmarked" });

    if (campusId) q = q.eq("campus_id", campusId);

    const { data, error } = await q;
    if (error) { setLoading(false); return; }

    // Flatten and filter by counsellor client-side (the join path makes it awkward server-side)
    let rows: Visit[] = (data ?? []).map((r: any) => ({
      id: r.id,
      lead_id: r.lead_id,
      visit_date: r.visit_date,
      status: r.status,
      visit_type: r.visit_type,
      feedback: r.feedback,
      created_at: r.created_at,
      updated_at: r.updated_at,
      campus_id: r.campus_id,
      scheduled_by: r.scheduled_by,
      lead_name: r.leads?.name ?? "—",
      lead_phone: r.leads?.phone ?? "",
      counsellor_name: r.leads?.profiles?.display_name ?? "Unassigned",
      campus_name: r.campuses?.name ?? "—",
    }));

    if (counsellorId) {
      rows = rows.filter(v => {
        // find counsellor match via the raw data
        const raw = (data ?? []).find((r: any) => r.id === v.id);
        return raw?.leads?.counsellor_id === counsellorId;
      });
    }

    // Compute summary counts
    const scheduled = rows.filter(v => ["scheduled", "confirmed"].includes(v.status) && new Date(v.visit_date) >= new Date()).length;
    const completed = rows.filter(v => v.status === "completed").length;
    const no_show = rows.filter(v => v.status === "no_show").length;
    const unmarked = rows.filter(v => ["scheduled", "confirmed"].includes(v.status) && new Date(v.visit_date) < new Date()).length;
    const walkins = rows.filter(v => v.visit_type === "walk_in").length;
    const post_visit = rows.filter(v => v.status === "completed" && !v.feedback).length;
    setCounts({ scheduled, completed, no_show, unmarked, walkins, post_visit });
    setVisits(rows);
    setLoading(false);
  }, [buildQuery, campusId, counsellorId, tab]);

  // Refetch whenever tab or filters change
  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  // Filter rows by tab
  const now = new Date();
  const tabRows = visits.filter(v => {
    if (tab === "scheduled") return ["scheduled", "confirmed"].includes(v.status) && new Date(v.visit_date) >= now;
    if (tab === "completed") return v.status === "completed";
    if (tab === "no_show")   return v.status === "no_show";
    if (tab === "unmarked")  return ["scheduled", "confirmed"].includes(v.status) && new Date(v.visit_date) < now;
    if (tab === "walkins")   return v.visit_type === "walk_in";
    if (tab === "post_visit") return v.status === "completed" && !v.feedback;
    return false;
  });

  const TABS: { key: Tab; label: string; icon: typeof Calendar; countKey: keyof typeof counts; accent: string }[] = [
    { key: "scheduled",  label: "Scheduled",      icon: Calendar,     countKey: "scheduled",  accent: "text-blue-600" },
    { key: "completed",  label: "Completed",      icon: CheckCircle2, countKey: "completed",  accent: "text-emerald-600" },
    { key: "no_show",    label: "No Show",        icon: XCircle,      countKey: "no_show",    accent: "text-rose-600" },
    { key: "unmarked",   label: "Unmarked",       icon: AlertCircle,  countKey: "unmarked",   accent: "text-amber-600" },
    { key: "walkins",    label: "Walk-ins",       icon: Footprints,   countKey: "walkins",    accent: "text-purple-600" },
    { key: "post_visit", label: "Post-Visit",     icon: Clock,        countKey: "post_visit", accent: "text-slate-600" },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Visit Monitor</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track all campus visits and walk-ins across counsellors and locations</p>
        </div>
        <button
          onClick={fetchVisits}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap gap-3 items-end">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0 self-center">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Counsellor</label>
          <select value={counsellorId} onChange={e => setCounsellorId(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary min-w-[150px]">
            <option value="">All Counsellors</option>
            {counsellors.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Campus / Location</label>
          <select value={campusId} onChange={e => setCampusId(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary min-w-[150px]">
            <option value="">All Campuses</option>
            {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Quick date shortcuts */}
        <div className="flex gap-1.5 self-end flex-wrap">
          {[
            { label: "Today", from: 0, to: 0 },
            { label: "Yesterday", from: -1, to: -1 },
            { label: "Last 7d", from: -7, to: 0 },
            { label: "This month", from: "month-start", to: 0 },
            { label: "Next 7d", from: 0, to: 7 },
          ].map(s => (
            <button key={s.label}
              onClick={() => {
                const today = new Date();
                if (s.from === "month-start") {
                  setDateFrom(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10));
                } else {
                  const d = new Date(today); d.setDate(d.getDate() + (s.from as number));
                  setDateFrom(d.toISOString().slice(0, 10));
                }
                const d2 = new Date(today); d2.setDate(d2.getDate() + (s.to as number));
                setDateTo(d2.toISOString().slice(0, 10));
              }}
              className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted transition-colors"
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-xl border p-4 text-left transition-all ${tab === t.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/40"}`}>
            <t.icon className={`h-4 w-4 mb-2 ${t.accent}`} />
            <p className="text-xl font-bold text-foreground">{counts[t.countKey]}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t.label}</p>
          </button>
        ))}
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors -mb-px
              ${tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {counts[t.countKey] > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {counts[t.countKey]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab description */}
      <TabDescription tab={tab} />

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tabRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <Calendar className="h-8 w-8 opacity-30" />
          <p className="text-sm">No visits found for the selected filters.</p>
        </div>
      ) : (
        <VisitTable rows={tabRows} tab={tab} />
      )}
    </div>
  );
}

// ── Tab description strip ─────────────────────────────────────────────────────

function TabDescription({ tab }: { tab: Tab }) {
  const desc: Record<Tab, string> = {
    scheduled:  "Upcoming visits that are scheduled or confirmed and have not yet occurred.",
    completed:  "Visits that were marked as completed by the counsellor.",
    no_show:    "Visits where the lead did not show up. Auto-followup is triggered for these.",
    unmarked:   "Visits whose date has passed but status was never updated. Action needed.",
    walkins:    "Unscheduled walk-in visits logged on the spot. Shows who logged it and when.",
    post_visit: "Completed visits that have no feedback/notes recorded. Follow up needed.",
  };
  return (
    <p className="text-xs text-muted-foreground -mt-2 px-1">{desc[tab]}</p>
  );
}

// ── Visit table ───────────────────────────────────────────────────────────────

function VisitTable({ rows, tab }: { rows: Visit[]; tab: Tab }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Campus</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                {tab === "walkins" ? "Logged At" : "Visit Date"}
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              {(tab === "walkins" || tab === "completed" || tab === "post_visit") && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Feedback / Notes</th>
              )}
              {tab === "unmarked" && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Overdue By</th>
              )}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(v => <VisitRow key={v.id} visit={v} tab={tab} />)}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
        {rows.length} visit{rows.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

function VisitRow({ visit: v, tab }: { visit: Visit; tab: Tab }) {
  const sc = STATUS_CONFIG[v.status] ?? { label: v.status, color: "text-muted-foreground", bg: "bg-muted border-border" };
  const overdueDays = tab === "unmarked"
    ? Math.floor((Date.now() - new Date(v.visit_date).getTime()) / 86400_000)
    : 0;

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      {/* Lead */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">{v.lead_name}</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <PhoneCall className="h-3 w-3" />{v.lead_phone}
        </p>
      </td>

      {/* Counsellor */}
      <td className="px-4 py-3">
        <p className="text-sm text-foreground flex items-center gap-1">
          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {v.counsellor_name}
        </p>
      </td>

      {/* Campus */}
      <td className="px-4 py-3">
        <p className="text-sm text-foreground flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {v.campus_name}
        </p>
      </td>

      {/* Date */}
      <td className="px-4 py-3">
        <p className="text-sm text-foreground">{fmtDateTime(v.visit_date)}</p>
        {tab === "walkins" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">Logged: {fmtDate(v.created_at)}</p>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex w-fit rounded-md border px-2 py-0.5 text-[11px] font-semibold ${sc.bg} ${sc.color}`}>
            {sc.label}
          </span>
          {v.visit_type === "walk_in" && (
            <span className="inline-flex w-fit items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
              <Footprints className="h-2.5 w-2.5" /> Walk-in
            </span>
          )}
        </div>
      </td>

      {/* Feedback / Notes (conditionally shown) */}
      {(tab === "walkins" || tab === "completed" || tab === "post_visit") && (
        <td className="px-4 py-3 max-w-[200px]">
          {v.feedback
            ? <p className="text-xs text-muted-foreground line-clamp-2">{v.feedback}</p>
            : <span className="text-[11px] text-rose-500 font-medium">No feedback</span>
          }
        </td>
      )}

      {/* Overdue (unmarked tab only) */}
      {tab === "unmarked" && (
        <td className="px-4 py-3">
          <span className={`text-sm font-semibold ${overdueDays > 2 ? "text-rose-600" : "text-amber-600"}`}>
            {overdueDays}d ago
          </span>
        </td>
      )}

      {/* Action */}
      <td className="px-4 py-3 text-right">
        <Link to={`/admissions/${v.lead_id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          Open <ChevronRight className="h-3 w-3" />
        </Link>
      </td>
    </tr>
  );
}

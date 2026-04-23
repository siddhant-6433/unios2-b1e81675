import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock, AlertTriangle, CalendarCheck, Phone, MapPin, Loader2, Search,
  ChevronLeft, ChevronRight, ExternalLink, UserSwitch, X, Check,
} from "lucide-react";

type Tab = "overdue" | "today" | "upcoming" | "visit_confirm" | "post_visit";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "overdue", label: "Overdue", icon: AlertTriangle },
  { key: "today", label: "Today", icon: Clock },
  { key: "upcoming", label: "Upcoming", icon: CalendarCheck },
  { key: "visit_confirm", label: "Visit Confirmations", icon: MapPin },
  { key: "post_visit", label: "Post-Visit", icon: Phone },
];

interface FollowupItem {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_phone: string;
  lead_stage: string;
  counsellor_name: string;
  counsellor_id: string | null;
  type: string;
  scheduled_at: string;
  notes: string | null;
  days_overdue?: number;
  days_since_visit?: number;
  campus_name?: string;
  urgency?: string;
}

const PAGE_SIZE = 50;

const PendingFollowups = () => {
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const isCounsellor = role === "counsellor";
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overdue");
  const [items, setItems] = useState<FollowupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Record<Tab, number>>({ overdue: 0, today: 0, upcoming: 0, visit_confirm: 0, post_visit: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);

  // Get profile id for counsellor filtering
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("id").eq("user_id", user.id).single()
      .then(({ data }) => { if (data) setProfileId(data.id); });
  }, [user?.id]);

  // Fetch counsellor options for reassignment (admins only)
  useEffect(() => {
    if (isCounsellor) return;
    (async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roleRows?.length) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("user_id", roleRows.map(r => r.user_id));
      if (profs) setCounsellorOptions(profs.map(p => ({ id: p.id, name: p.display_name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, [isCounsellor]);

  const fetchCounts = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = `${today}T00:00:00+05:30`;
    const todayEnd = `${today}T23:59:59+05:30`;
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + "T23:59:59+05:30";

    // For counsellors, first get their assigned lead IDs
    let myLeadIds: string[] | null = null;
    if (isCounsellor && profileId) {
      const { data: myLeads } = await supabase.from("leads").select("id").eq("counsellor_id", profileId);
      myLeadIds = (myLeads || []).map((l: any) => l.id);
      if (myLeadIds.length === 0) {
        setCounts({ overdue: 0, today: 0, upcoming: 0, visit_confirm: 0, post_visit: 0 });
        return;
      }
    }

    // Overdue
    let oq = supabase.from("lead_followups" as any).select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("scheduled_at", todayStart);
    if (myLeadIds) oq = oq.in("lead_id", myLeadIds);

    // Today
    let tq = supabase.from("lead_followups" as any).select("id", { count: "exact", head: true })
      .eq("status", "pending").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd);
    if (myLeadIds) tq = tq.in("lead_id", myLeadIds);

    // Upcoming
    let uq = supabase.from("lead_followups" as any).select("id", { count: "exact", head: true })
      .eq("status", "pending").gt("scheduled_at", todayEnd).lte("scheduled_at", weekEnd);
    if (myLeadIds) uq = uq.in("lead_id", myLeadIds);

    // Visit confirmations
    let vcq = supabase.from("visits_needing_confirmation" as any).select("visit_id", { count: "exact", head: true });
    if (isCounsellor && profileId) vcq = vcq.eq("counsellor_id", profileId);

    // Post-visit
    let pvq = supabase.from("post_visit_pending_followups" as any).select("visit_id", { count: "exact", head: true });
    if (isCounsellor && profileId) pvq = pvq.eq("counsellor_id", profileId);

    const [oRes, tRes, uRes, vcRes, pvRes] = await Promise.all([oq, tq, uq, vcq, pvq]);
    setCounts({
      overdue: oRes.count || 0,
      today: tRes.count || 0,
      upcoming: uRes.count || 0,
      visit_confirm: vcRes.count || 0,
      post_visit: pvRes.count || 0,
    });
  }, [isCounsellor, profileId]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = `${today}T00:00:00+05:30`;
    const todayEnd = `${today}T23:59:59+05:30`;
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + "T23:59:59+05:30";

    let result: FollowupItem[] = [];

    if (tab === "overdue" || tab === "today" || tab === "upcoming") {
      // Use !inner join so we can filter by leads.counsellor_id for counsellors
      const joinType = isCounsellor && profileId ? "!inner" : "";
      let q = supabase.from("lead_followups" as any)
        .select(`id, lead_id, type, scheduled_at, notes, status, user_id,
          leads${joinType}:lead_id(name, phone, stage, counsellor_id,
            counsellor_profile:counsellor_id(display_name),
            courses:course_id(name), campuses:campus_id(name)
          )`)
        .eq("status", "pending")
        .order("scheduled_at", { ascending: tab === "overdue" });

      if (tab === "overdue") q = q.lt("scheduled_at", todayStart);
      else if (tab === "today") q = q.gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd);
      else q = q.gt("scheduled_at", todayEnd).lte("scheduled_at", weekEnd);

      // Filter by lead's assigned counsellor (not followup user_id)
      if (isCounsellor && profileId) q = q.eq("leads.counsellor_id", profileId);

      q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data } = await q;

      result = (data || []).map((r: any) => {
        const daysOverdue = Math.max(0, Math.floor((Date.now() - new Date(r.scheduled_at).getTime()) / 86400000));
        return {
          id: r.id,
          lead_id: r.lead_id,
          lead_name: r.leads?.name || "Unknown",
          lead_phone: r.leads?.phone || "",
          lead_stage: r.leads?.stage || "",
          counsellor_name: r.leads?.counsellor_profile?.display_name || "Unassigned",
          counsellor_id: r.leads?.counsellor_id || null,
          type: r.type || "call",
          scheduled_at: r.scheduled_at,
          notes: r.notes,
          days_overdue: daysOverdue,
          campus_name: r.leads?.campuses?.name || "",
        };
      });
    } else if (tab === "visit_confirm") {
      let q = supabase.from("visits_needing_confirmation" as any)
        .select("*")
        .order("visit_date", { ascending: true });
      if (isCounsellor && profileId) q = q.eq("counsellor_id", profileId);
      q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data } = await q;

      result = (data || []).map((r: any) => ({
        id: r.visit_id,
        lead_id: r.lead_id,
        lead_name: r.lead_name || "Unknown",
        lead_phone: r.lead_phone || "",
        lead_stage: "",
        counsellor_name: "",
        counsellor_id: r.counsellor_id,
        type: "visit_confirmation",
        scheduled_at: r.visit_date,
        notes: null,
        urgency: r.urgency,
        campus_name: r.campus_name || "",
      }));
    } else if (tab === "post_visit") {
      let q = supabase.from("post_visit_pending_followups" as any)
        .select("*")
        .order("visit_date", { ascending: true });
      if (isCounsellor && profileId) q = q.eq("counsellor_id", profileId);
      q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const { data } = await q;

      result = (data || []).map((r: any) => ({
        id: r.visit_id,
        lead_id: r.lead_id,
        lead_name: r.lead_name || "Unknown",
        lead_phone: r.lead_phone || "",
        lead_stage: r.lead_stage || "",
        counsellor_name: "",
        counsellor_id: r.counsellor_id,
        type: "post_visit",
        scheduled_at: r.visit_date,
        notes: null,
        days_since_visit: r.days_since_visit,
        campus_name: r.campus_name || "",
      }));
    }

    setItems(result);
    setLoading(false);
  }, [tab, page, isCounsellor, profileId, user?.id]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [tab]);

  const filtered = search
    ? items.filter(r => {
        const q = search.toLowerCase();
        return r.lead_name.toLowerCase().includes(q) || r.lead_phone.includes(q) || (r.notes || "").toLowerCase().includes(q) || r.counsellor_name.toLowerCase().includes(q);
      })
    : items;

  const handleMarkComplete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from("lead_followups" as any).update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id);
    fetchItems();
    fetchCounts();
  };

  const toggleSelect = (leadId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.lead_id)));
    }
  };

  const handleReassign = async () => {
    if (!reassignTo || selected.size === 0) return;
    setReassigning(true);
    const leadIds = [...selected];
    const { error } = await supabase.from("leads").update({ counsellor_id: reassignTo } as any).in("id", leadIds);
    if (error) {
      console.error("Reassign failed:", error);
    } else {
      // Log activity for each lead
      const counsellorName = counsellorOptions.find(c => c.id === reassignTo)?.name || "Unknown";
      await supabase.from("lead_activities").insert(
        leadIds.map(lid => ({
          lead_id: lid,
          user_id: user?.id || null,
          type: "assignment",
          description: `Lead reassigned to ${counsellorName} (bulk from Pending Follow-ups)`,
        }))
      );
    }
    setSelected(new Set());
    setReassignTo("");
    setReassigning(false);
    fetchItems();
    fetchCounts();
  };

  const totalAll = counts.overdue + counts.today + counts.upcoming + counts.visit_confirm + counts.post_visit;

  const fmtOverdue = (d: number) => d === 0 ? "Today" : d === 1 ? "1 day overdue" : `${d} days overdue`;
  const fmtDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isCounsellor ? "My Pending Follow-ups" : "Pending Follow-ups"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalAll > 0 ? `${totalAll} items need attention` : "All caught up!"}
          </p>
        </div>
      </div>

      {/* Tab pills with counts */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => {
          const c = counts[t.key];
          const isActive = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? "bg-primary text-primary-foreground" : "border border-input bg-card text-muted-foreground hover:bg-muted"
              }`}>
              <t.icon className="h-4 w-4" />
              {t.label}
              {c > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive ? "bg-primary-foreground/20 text-primary-foreground"
                    : t.key === "overdue" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                }`}>{c}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder="Search name, phone, notes..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>

      {/* Bulk action bar */}
      {!isCounsellor && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/20 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">{selected.size} lead{selected.size > 1 ? "s" : ""} selected</span>
          <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
            <option value="">Reassign to...</option>
            {counsellorOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={handleReassign} disabled={!reassignTo || reassigning}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {reassigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Reassign
          </button>
          <button onClick={() => setSelected(new Set())}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Clear selection">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-x-auto">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {!isCounsellor && (
                    <th className="px-3 py-2.5 w-10">
                      <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer" />
                    </th>
                  )}
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    {tab === "overdue" ? "Overdue" : tab === "post_visit" ? "Since Visit" : "Scheduled"}
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Stage</th>
                  {!isCounsellor && <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>}
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Campus</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Notes</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className={`border-b border-border/40 hover:bg-muted/20 cursor-pointer ${selected.has(r.lead_id) ? "bg-primary/5" : ""}`}
                    onClick={() => navigate(`/admissions/${r.lead_id}`)}>
                    {!isCounsellor && (
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(r.lead_id)}
                          onChange={() => toggleSelect(r.lead_id)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{r.lead_name}</p>
                      <p className="text-[10px] text-muted-foreground">{r.lead_phone}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`text-[10px] border-0 ${
                        r.type === "call" ? "bg-blue-100 text-blue-700"
                        : r.type === "visit_confirmation" ? "bg-purple-100 text-purple-700"
                        : r.type === "post_visit" ? "bg-amber-100 text-amber-700"
                        : "bg-muted text-muted-foreground"
                      }`}>{r.type.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {tab === "overdue" && r.days_overdue !== undefined ? (
                        <span className={`font-medium ${r.days_overdue > 2 ? "text-red-600" : "text-amber-600"}`}>
                          {fmtOverdue(r.days_overdue)}
                        </span>
                      ) : tab === "post_visit" && r.days_since_visit !== undefined ? (
                        <span className="font-medium text-amber-600">{r.days_since_visit}d ago</span>
                      ) : tab === "visit_confirm" && r.urgency ? (
                        <Badge className={`text-[10px] border-0 ${r.urgency === "same_day" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {r.urgency === "same_day" ? "Today" : "Tomorrow"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">{fmtDate(r.scheduled_at)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className="text-[10px] border-0 bg-muted text-muted-foreground">
                        {(r.lead_stage || "—").replace(/_/g, " ")}
                      </Badge>
                    </td>
                    {!isCounsellor && <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.counsellor_name}</td>}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.campus_name || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">{r.notes || "—"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {(tab === "overdue" || tab === "today" || tab === "upcoming") && (
                          <button onClick={(e) => handleMarkComplete(r.id, e)}
                            className="rounded-lg bg-emerald-100 px-2.5 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-200 transition-colors"
                            title="Mark as completed">Done</button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/admissions/${r.lead_id}`); }}
                          className="rounded-lg bg-muted p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                          title="Open lead">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isCounsellor ? 7 : 9} className="px-4 py-12 text-center text-muted-foreground">
                    <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{tab === "overdue" ? "No overdue follow-ups!" : "No pending items"}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {items.length >= PAGE_SIZE && (
        <div className="flex items-center justify-end gap-1.5">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            className="rounded-lg border border-input bg-card p-1.5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-xs text-muted-foreground px-2">Page {page + 1}</span>
          <button onClick={() => setPage(page + 1)} disabled={items.length < PAGE_SIZE}
            className="rounded-lg border border-input bg-card p-1.5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
};

export default PendingFollowups;

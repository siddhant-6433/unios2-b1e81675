import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Search, Loader2, Phone, ChevronRight, ChevronLeft, Clock, Users,
} from "lucide-react";

interface FreshLead {
  id: string;
  name: string;
  phone: string;
  source: string;
  course_name: string;
  campus_name: string;
  counsellor_name: string;
  counsellor_id: string | null;
  created_at: string;
  hours_since: number;
}

const PAGE_SIZE = 50;

const SOURCE_COLORS: Record<string, string> = {
  website: "bg-blue-100 text-blue-700",
  meta_ads: "bg-purple-100 text-purple-700",
  google_ads: "bg-green-100 text-green-700",
  justdial: "bg-amber-100 text-amber-700",
  collegedunia: "bg-indigo-100 text-indigo-700",
  collegehai: "bg-cyan-100 text-cyan-700",
  shiksha: "bg-pink-100 text-pink-700",
  walk_in: "bg-emerald-100 text-emerald-700",
  referral: "bg-orange-100 text-orange-700",
};

const FreshLeads = () => {
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const isCounsellor = role === "counsellor";
  const [profileId, setProfileId] = useState<string | null>(null);
  const [leads, setLeads] = useState<FreshLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);

  // Get profile id
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("id").eq("user_id", user.id).single()
      .then(({ data }) => {
        if (data) {
          setProfileId(data.id);
          if (isCounsellor) setCounsellorFilter(data.id);
        }
      });
  }, [user?.id]);

  // Fetch counsellor options (for admin filter)
  useEffect(() => {
    if (isCounsellor) return;
    (async () => {
      const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roleRows?.length) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("user_id", roleRows.map(r => r.user_id));
      if (profs) setCounsellorOptions(profs.map(p => ({ id: p.id, name: p.display_name || "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, [isCounsellor]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);

    // Base filters
    const applyFilters = (q: any) => {
      q = q.eq("stage", "new_lead" as any).is("first_contact_at", null);
      if (isCounsellor && profileId) {
        q = q.eq("counsellor_id", profileId);
      } else {
        if (counsellorFilter !== "all") q = q.eq("counsellor_id", counsellorFilter);
        if (assignmentFilter === "assigned") q = q.not("counsellor_id", "is", null);
        else if (assignmentFilter === "unassigned") q = q.is("counsellor_id", null);
      }
      return q;
    };

    // Count query
    const { count } = await applyFilters(
      supabase.from("leads").select("id", { count: "exact", head: true })
    );
    setTotalCount(count || 0);

    // Data query
    let q = applyFilters(
      supabase.from("leads").select(`id, name, phone, source, created_at, counsellor_id,
        courses:course_id(name),
        campuses:campus_id(name),
        counsellor_profile:counsellor_id(display_name)
      `)
    ).order("created_at", { ascending: true })
     .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data } = await q;

    if (data) {
      const now = Date.now();
      setLeads((data as any[]).map((l: any) => ({
        id: l.id,
        name: l.name || "Unknown",
        phone: l.phone || "",
        source: l.source || "",
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        counsellor_name: l.counsellor_profile?.display_name || "Unassigned",
        counsellor_id: l.counsellor_id,
        created_at: l.created_at,
        hours_since: Math.floor((now - new Date(l.created_at).getTime()) / 3600000),
      })));
    }
    setLoading(false);
  }, [counsellorFilter, assignmentFilter, page, isCounsellor, profileId]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { setPage(0); }, [counsellorFilter, assignmentFilter, search]);

  const filtered = search
    ? leads.filter(l => {
        const q = search.toLowerCase();
        return l.name.toLowerCase().includes(q) || l.phone.includes(q) || l.course_name.toLowerCase().includes(q) || l.counsellor_name.toLowerCase().includes(q);
      })
    : leads;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fmtAge = (h: number) => {
    if (h < 1) return "Just now";
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "1 day ago" : `${d} days ago`;
  };

  const handleCallNext = () => {
    if (filtered.length > 0) {
      navigate(`/admissions/${filtered[0].id}`);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isCounsellor ? "My Fresh Leads" : "Fresh Leads Queue"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount > 0 ? `${totalCount} leads assigned but not yet contacted` : "All leads have been contacted!"}
          </p>
        </div>
        {filtered.length > 0 && (
          <button onClick={handleCallNext}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <Phone className="h-4 w-4" />
            Call Next Lead
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Fresh", value: totalCount, icon: Sparkles, bg: "bg-pastel-orange" },
          { label: "< 4 Hours", value: leads.filter(l => l.hours_since < 4).length, icon: Clock, bg: "bg-pastel-green" },
          { label: "4–24 Hours", value: leads.filter(l => l.hours_since >= 4 && l.hours_since < 24).length, icon: Clock, bg: "bg-pastel-yellow" },
          { label: "> 24 Hours (SLA Breach)", value: leads.filter(l => l.hours_since >= 24).length, icon: Clock, bg: "bg-pastel-red" },
        ].map(s => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} mb-2`}>
                <s.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-2xl font-bold text-foreground">{loading ? "—" : s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {!isCounsellor && (
          <>
            <select value={assignmentFilter} onChange={e => { setAssignmentFilter(e.target.value as any); if (e.target.value === "unassigned") setCounsellorFilter("all"); }}
              className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
              <option value="all">All Leads</option>
              <option value="assigned">Assigned Only</option>
              <option value="unassigned">Unassigned Only</option>
            </select>
            {assignmentFilter !== "unassigned" && (
              <select value={counsellorFilter} onChange={e => setCounsellorFilter(e.target.value)}
                className="rounded-xl border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
                <option value="all">All Counsellors</option>
                {counsellorOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </>
        )}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search name, phone, course..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
      </div>

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-x-auto">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-center font-medium text-muted-foreground w-10">#</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Course</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Source</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Waiting Since</th>
                  {!isCounsellor && <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Counsellor</th>}
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Campus</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, i) => (
                  <tr key={l.id} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                    onClick={() => navigate(`/admissions/${l.id}`)}>
                    <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">{page * PAGE_SIZE + i + 1}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{l.name}</p>
                      <p className="text-[10px] text-muted-foreground">{l.phone}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.course_name}</td>
                    <td className="px-3 py-2.5">
                      {l.source ? (
                        <Badge className={`text-[10px] border-0 ${SOURCE_COLORS[l.source] || "bg-muted text-muted-foreground"}`}>
                          {l.source.replace(/_/g, " ")}
                        </Badge>
                      ) : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-medium ${
                        l.hours_since >= 24 ? "text-red-600" : l.hours_since >= 4 ? "text-amber-600" : "text-emerald-600"
                      }`}>
                        {fmtAge(l.hours_since)}
                      </span>
                    </td>
                    {!isCounsellor && <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.counsellor_name}</td>}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.campus_name}</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/admissions/${l.id}`); }}
                        className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors flex items-center gap-1 mx-auto">
                        <Phone className="h-3 w-3" /> Call
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isCounsellor ? 7 : 8} className="px-4 py-12 text-center text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No fresh leads — all have been contacted!</p>
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
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="rounded-lg border border-input bg-card p-1.5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs text-muted-foreground px-2">Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
              className="rounded-lg border border-input bg-card p-1.5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FreshLeads;

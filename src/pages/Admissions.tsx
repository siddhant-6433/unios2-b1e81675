import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useToast } from "@/hooks/use-toast";
import {
  Phone, MessageSquare, ChevronRight, Plus, Search, Filter, Upload,
  Eye, Calendar, MoreHorizontal, Users, TrendingUp, ArrowUpRight,
  Bot, UserCheck, MapPin, FileText, CheckCircle, XCircle, Clock, Loader2,
  Trash2, ArrowRightLeft, Send, Flag
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AddLeadDialog } from "@/components/admissions/AddLeadDialog";
import { BulkLeadImportDialog } from "@/components/admissions/BulkLeadImportDialog";
import { TransferLeadDialog } from "@/components/admissions/TransferLeadDialog";
import { BulkWhatsAppDialog } from "@/components/admissions/BulkWhatsAppDialog";
import { LeadTemperatureBadge } from "@/components/admissions/LeadTemperatureBadge";
import { SeatMatrix } from "@/components/admissions/SeatMatrix";
import { PaymentReconciliation } from "@/components/admissions/PaymentReconciliation";
import { InactivityAlertBanner } from "@/components/admissions/InactivityAlertBanner";
import { CounsellorOnboarding } from "@/components/onboarding/CounsellorOnboarding";
import { LEAD_SOURCES, SOURCE_LABELS, SOURCE_BADGE_COLORS } from "@/config/leadSources";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const STAGES = [
  "new_lead", "application_in_progress", "application_fee_paid", "application_submitted", "ai_called", "counsellor_call", "visit_scheduled",
  "interview", "offer_sent", "token_paid", "pre_admitted", "admitted", "waitlisted", "not_interested", "rejected"
] as const;

type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", waitlisted: "Waitlisted", not_interested: "Not Interested", rejected: "Rejected",
};

const stageColors: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  application_in_progress: "bg-pastel-yellow text-foreground/70",
  application_fee_paid: "bg-pastel-green text-foreground/70",
  application_submitted: "bg-pastel-mint text-foreground/70",
  ai_called: "bg-pastel-purple text-foreground/70",
  counsellor_call: "bg-pastel-orange text-foreground/70",
  visit_scheduled: "bg-pastel-yellow text-foreground/70",
  interview: "bg-pastel-mint text-foreground/70",
  offer_sent: "bg-pastel-green text-foreground/70",
  token_paid: "bg-primary/15 text-primary",
  pre_admitted: "bg-primary/20 text-primary",
  admitted: "bg-primary text-primary-foreground",
  waitlisted: "bg-pastel-orange text-foreground/70",
  not_interested: "bg-muted text-foreground/60",
  rejected: "bg-pastel-red text-foreground/70",
};

const stageIcons: Record<string, typeof Users> = {
  new_lead: Users, application_in_progress: FileText, application_fee_paid: CheckCircle, application_submitted: CheckCircle,
  ai_called: Bot, counsellor_call: Phone,
  visit_scheduled: MapPin, interview: UserCheck, offer_sent: FileText,
  token_paid: CheckCircle, pre_admitted: Clock, admitted: CheckCircle, waitlisted: Clock, not_interested: XCircle, rejected: XCircle,
};

// Lead sources imported from @/config/leadSources

const PERSON_ROLE_COLORS: Record<string, string> = {
  lead: "bg-pastel-yellow text-foreground/80",
  applicant: "bg-pastel-blue text-foreground/80",
  student: "bg-pastel-green text-foreground/80",
  alumni: "bg-pastel-purple text-foreground/80",
};

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  source: string;
  person_role: string;
  created_at: string;
  application_id: string | null;
  pre_admission_no: string | null;
  admission_no: string | null;
  course_id: string | null;
  campus_id: string | null;
  counsellor_id: string | null;
  lead_score: number;
  lead_temperature: "hot" | "warm" | "cold";
  course_name?: string;
  campus_name?: string;
  counsellor_name?: string;
}

const Admissions = () => {
  const navigate = useNavigate();
  const { role, profile } = useAuth();
  const { selectedCampusId } = useCampus();
  const isTeamLeader = useIsTeamLeader();
  const { toast } = useToast();
  const [view, setView] = useState<"pipeline" | "list" | "seats" | "payments">("pipeline");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [tempFilter, setTempFilter] = useState<string>("all");
  const [counsellorFilter, setCounsellorFilter] = useState<string>("all");
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [inactiveIds, setInactiveIds] = useState<Set<string> | null>(null);
  const [followupLeadIds, setFollowupLeadIds] = useState<Set<string> | null>(null);

  // Selection & bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showBulkWhatsApp, setShowBulkWhatsApp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteRequest, setShowDeleteRequest] = useState(false);
  const [deleteReason, setDeleteReason] = useState<string>("duplicate");
  const [deleteCustomMsg, setDeleteCustomMsg] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const isSuperAdmin = role === "super_admin";
  const canTransfer = isSuperAdmin || isTeamLeader;
  const canFilterByCounsellor = role === "super_admin" || role === "admission_head" || role === "campus_admin" || isTeamLeader;

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from("leads")
      .select(`*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)`)
      .order("created_at", { ascending: false })
      .limit(500);
    // Counsellors see their assigned leads across all campuses
    if (role === "counsellor" && profile?.id) {
      query = query.eq("counsellor_id", profile.id);
    } else if (selectedCampusId !== "all") {
      query = query.eq("campus_id", selectedCampusId);
    }
    const { data, error } = await query;

    if (data) {
      setLeads(data.map((l: any) => ({
        ...l,
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        counsellor_name: l.profiles?.display_name || "Unassigned",
      })));
    }
    setSelectedIds(new Set());
    setLoading(false);
  };

  useEffect(() => { fetchLeads(); }, [selectedCampusId]);

  // Fetch counsellor list for filter (admin / admission_head / team leader only)
  useEffect(() => {
    if (!canFilterByCounsellor) return;
    (async () => {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "counsellor");
      if (!roleRows?.length) return;
      const userIds = roleRows.map(r => r.user_id);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, user_id")
        .in("user_id", userIds);
      if (profs) {
        setCounsellorOptions(
          profs
            .map(p => ({ id: p.id, name: p.display_name || "Unnamed" }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    })();
  }, [canFilterByCounsellor]);

  // Auto-refresh when leads change (new leads, stage changes, assignments)
  useEffect(() => {
    const channel = supabase
      .channel("leads-realtime")
      .on("postgres_changes" as any, {
        event: "*",
        schema: "public",
        table: "leads",
      }, () => {
        fetchLeads();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedCampusId]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(l => l.id)));
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("leads").delete().in("id", ids);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Leads deleted", description: `${ids.length} lead(s) deleted successfully.` });
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
    await fetchLeads();
  };

  const handleRequestDeletion = async () => {
    setSubmittingRequest(true);
    const ids = Array.from(selectedIds);
    const rows = ids.map((lead_id) => ({
      lead_id,
      requested_by: user?.id,
      reason: deleteReason,
      custom_message: deleteReason === "other" ? deleteCustomMsg : null,
    }));
    const { error } = await supabase.from("lead_deletion_requests" as any).insert(rows);
    if (error) {
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Deletion requested", description: `${ids.length} lead(s) flagged for review by admin.` });
    }
    setSubmittingRequest(false);
    setShowDeleteRequest(false);
    setDeleteReason("duplicate");
    setDeleteCustomMsg("");
    setSelectedIds(new Set());
  };

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase().trim();
    const digits = q.replace(/\D/g, "");
    const phoneDigits = (l.phone || "").replace(/\D/g, "");
    const matchesSearch = !q ||
      l.name.toLowerCase().includes(q) ||
      (l.course_name || "").toLowerCase().includes(q) ||
      (l.campus_name || "").toLowerCase().includes(q) ||
      (l.email || "").toLowerCase().includes(q) ||
      (l.application_id || "").toLowerCase().includes(q) ||
      (digits.length >= 3 && phoneDigits.includes(digits));
    const matchesStage = stageFilter === "all" || l.stage === stageFilter;
    const matchesSource = sourceFilter === "all" || l.source === sourceFilter;
    const matchesRole = roleFilter === "all" || l.person_role === roleFilter;
    const matchesTemp = tempFilter === "all" || l.lead_temperature === tempFilter;
    const matchesInactive = !inactiveIds || inactiveIds.has(l.id);
    const matchesFollowup = !followupLeadIds || followupLeadIds.has(l.id);
    const matchesCounsellor = counsellorFilter === "all"
      || (counsellorFilter === "unassigned" ? !l.counsellor_id : l.counsellor_id === counsellorFilter);
    return matchesSearch && matchesStage && matchesSource && matchesRole && matchesTemp && matchesInactive && matchesFollowup && matchesCounsellor;
  });

  const totalLeads = leads.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayLeads = leads.filter(l => l.created_at.slice(0, 10) === today).length;
  const newLeads = leads.filter(l => l.stage === "new_lead").length;
  const appStarted = leads.filter(l => ["application_in_progress", "application_fee_paid", "application_submitted"].includes(l.stage)).length;
  const feePaid = leads.filter(l => ["application_fee_paid", "application_submitted"].includes(l.stage)).length;
  const appSubmitted = leads.filter(l => l.stage === "application_submitted").length;
  const admitted = leads.filter(l => l.stage === "admitted").length;

  // Followup & visit counts fetched from DB
  const [pendingFollowups, setPendingFollowups] = useState(0);
  const [todayFollowups, setTodayFollowups] = useState(0);
  const [overdueFollowups, setOverdueFollowups] = useState(0);
  const [upcomingVisits, setUpcomingVisits] = useState(0);
  const [completedVisits, setCompletedVisits] = useState(0);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const todayStart = now.toISOString().slice(0, 10);
      const todayEnd = todayStart + "T23:59:59";

      // For counsellors, limit stats to their own assigned leads
      let leadIds: string[] | null = null;
      if (role === "counsellor" && profile?.id) {
        const { data: myLeads } = await supabase
          .from("leads")
          .select("id")
          .eq("counsellor_id", profile.id);
        leadIds = (myLeads || []).map((l: any) => l.id);
        if (leadIds.length === 0) {
          setPendingFollowups(0); setTodayFollowups(0); setOverdueFollowups(0);
          setUpcomingVisits(0); setCompletedVisits(0);
          return;
        }
      }

      const applyLeadFilter = <T extends any>(q: T): T => {
        if (leadIds) return (q as any).in("lead_id", leadIds) as T;
        return q;
      };

      const [pendingRes, todayRes, overdueRes, upVisitRes, compVisitRes] = await Promise.all([
        applyLeadFilter(supabase.from("lead_followups").select("id", { count: "exact", head: true }).eq("status", "pending")),
        applyLeadFilter(supabase.from("lead_followups").select("id", { count: "exact", head: true }).eq("status", "pending").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd)),
        applyLeadFilter(supabase.from("overdue_followups" as any).select("id", { count: "exact", head: true })),
        applyLeadFilter(supabase.from("campus_visits").select("id", { count: "exact", head: true }).gte("visit_date", todayStart).in("status", ["scheduled", "confirmed"])),
        applyLeadFilter(supabase.from("campus_visits").select("id", { count: "exact", head: true }).eq("status", "completed")),
      ]);
      setPendingFollowups(pendingRes.count || 0);
      setTodayFollowups(todayRes.count || 0);
      setOverdueFollowups(overdueRes.count || 0);
      setUpcomingVisits(upVisitRes.count || 0);
      setCompletedVisits(compVisitRes.count || 0);
    })();
  }, [selectedCampusId, role, profile?.id]);

  // Row 1: Lead data
  const leadStats = [
    { label: "New Leads", value: newLeads, sub: `+${todayLeads} today`, icon: Users, iconBg: "bg-pastel-blue", filterStage: "new_lead", link: "" },
    { label: "Pending Follow-ups", value: pendingFollowups, sub: `${overdueFollowups} overdue · ${todayFollowups} today`, icon: Clock, iconBg: "bg-pastel-orange", filterStage: "", link: "", action: "followups" },
    { label: "Upcoming Visits", value: upcomingVisits, sub: "Scheduled & confirmed", icon: MapPin, iconBg: "bg-pastel-yellow", filterStage: "visit_scheduled", link: "" },
    { label: "Completed Visits", value: completedVisits, sub: "Campus visits done", icon: CheckCircle, iconBg: "bg-pastel-green", filterStage: "", link: "" },
  ];

  // Row 2: Application stages
  const appStats = [
    { label: "Applications Started", value: appStarted, sub: "In progress or beyond", icon: FileText, iconBg: "bg-pastel-blue", filterStage: "application_in_progress" },
    { label: "Fee Paid", value: feePaid, sub: "Application fee received", icon: CheckCircle, iconBg: "bg-pastel-green", filterStage: "application_fee_paid" },
    { label: "Waiting for Offer", value: appSubmitted, sub: "Fully submitted", icon: TrendingUp, iconBg: "bg-pastel-mint", filterStage: "application_submitted" },
    { label: "Admitted", value: admitted, sub: "Fully admitted students", icon: UserCheck, iconBg: "bg-pastel-purple", filterStage: "admitted" },
  ];

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const selectedLeadNames = Array.from(selectedIds).map(id => leads.find(l => l.id === id)?.name || "").filter(Boolean);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* First-time onboarding for counsellors */}
      {role === "counsellor" && <CounsellorOnboarding />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admissions CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage leads, applications & admissions pipeline</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowBulkImport(true)} className="gap-2"><Upload className="h-4 w-4" />Import CSV</Button>
          <Button onClick={() => setShowAddLead(true)} className="gap-2"><Plus className="h-4 w-4" />Add Lead</Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} selected</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowBulkWhatsApp(true)}>
              <Send className="h-4 w-4" /> WhatsApp
            </Button>
            {canTransfer && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowTransfer(true)}>
                <ArrowRightLeft className="h-4 w-4" /> Transfer
              </Button>
            )}
            {isSuperAdmin ? (
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setShowDeleteRequest(true)}>
                <Flag className="h-4 w-4" /> Request Deletion
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Row 1: Lead Data */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Leads</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {leadStats.map((stat) => (
            <Card
              key={stat.label}
              className={`border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer ${
                (stat.filterStage && stageFilter === stat.filterStage) || (stat.action === "followups" && followupLeadIds) ? "ring-2 ring-primary/40 bg-primary/5" : ""
              }`}
              onClick={async () => {
                if (stat.action === "followups") {
                  if (followupLeadIds) { setFollowupLeadIds(null); return; }
                  const { data } = await supabase.from("lead_followups").select("lead_id").eq("status", "pending");
                  const ids = new Set<string>((data || []).map((r: any) => r.lead_id));
                  setFollowupLeadIds(ids);
                  setInactiveIds(null);
                  setStageFilter("all");
                  setSourceFilter("all");
                  setRoleFilter("all");
                  setTempFilter("all");
                  setSearch("");
                  return;
                }
                if (stat.link) { navigate(stat.link); return; }
                if (stat.filterStage) setStageFilter(prev => prev === stat.filterStage ? "all" : stat.filterStage);
              }}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                    <stat.icon className="h-5 w-5 text-foreground/70" />
                  </div>
                  <ArrowUpRight className={`h-4 w-4 mt-1 transition-colors ${
                    (stat.filterStage && stageFilter === stat.filterStage) || (stat.action === "followups" && followupLeadIds) ? "text-primary" : "text-muted-foreground"
                  }`} />
                </div>
                <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
                <p className="text-xs font-medium mt-1 text-primary">{stat.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Row 2: Application Stages */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Applications</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {appStats.map((stat) => (
            <Card
              key={stat.label}
              className={`border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer ${stageFilter === stat.filterStage ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
              onClick={() => setStageFilter(prev => prev === stat.filterStage ? "all" : stat.filterStage)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.iconBg}`}>
                    <stat.icon className="h-5 w-5 text-foreground/70" />
                  </div>
                  <ArrowUpRight className={`h-4 w-4 mt-1 transition-colors ${stageFilter === stat.filterStage ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <p className="text-3xl font-bold text-foreground mt-4">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
                <p className="text-xs font-medium mt-1 text-primary">{stat.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <InactivityAlertBanner
        onViewInactive={(ids) => {
          setInactiveIds(ids);
          setFollowupLeadIds(null);
          setStageFilter("all");
          setSourceFilter("all");
          setRoleFilter("all");
          setTempFilter("all");
          setSearch("");
        }}
        onViewOverdue={() => navigate("/counsellor-dashboard")}
        campusId={selectedCampusId}
      />

      {inactiveIds && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2 text-sm">
          <Clock className="h-3.5 w-3.5 text-amber-600" />
          <span className="font-medium text-amber-800 dark:text-amber-300">
            Showing {inactiveIds.size} inactive lead{inactiveIds.size !== 1 ? "s" : ""} past threshold
          </span>
          <button
            onClick={() => setInactiveIds(null)}
            className="ml-2 rounded-md bg-amber-200 dark:bg-amber-800 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700"
          >
            Clear filter
          </button>
        </div>
      )}

      {followupLeadIds && (
        <div className="flex items-center gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/40 px-3 py-2 text-sm">
          <Clock className="h-3.5 w-3.5 text-orange-600" />
          <span className="font-medium text-orange-800 dark:text-orange-300">
            Showing {followupLeadIds.size} lead{followupLeadIds.size !== 1 ? "s" : ""} with pending follow-ups
          </span>
          <button
            onClick={() => setFollowupLeadIds(null)}
            className="ml-2 rounded-md bg-orange-200 dark:bg-orange-800 px-2 py-0.5 text-xs font-medium text-orange-800 dark:text-orange-200 hover:bg-orange-300 dark:hover:bg-orange-700"
          >
            Clear filter
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search by name, phone, email, course, campus..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Sources</option>
          {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Roles</option>
          <option value="lead">Lead</option>
          <option value="applicant">Applicant</option>
          <option value="student">Student</option>
          <option value="alumni">Alumni</option>
        </select>
        <select value={tempFilter} onChange={(e) => setTempFilter(e.target.value)}
          className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
          <option value="all">All Leads</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        {canFilterByCounsellor && (
          <select value={counsellorFilter} onChange={(e) => setCounsellorFilter(e.target.value)}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
            <option value="all">All Counsellors</option>
            <option value="unassigned">Unassigned</option>
            {counsellorOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <div className="flex rounded-xl border border-input bg-card p-0.5 ml-auto">
          {((role === "counsellor" ? ["pipeline", "list"] : ["pipeline", "list", "seats", "payments"]) as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "seats" ? (
        <SeatMatrix />
      ) : view === "payments" ? (
        <PaymentReconciliation />
      ) : view === "pipeline" ? (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
          {STAGES.map((stage) => {
            const stageLeads = filtered.filter((l) => l.stage === stage);
            const StageIcon = stageIcons[stage] || FileText;
            return (
              <div key={stage} className="min-w-[280px] max-w-[280px] flex-shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <StageIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{STAGE_LABELS[stage]}</h3>
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {stageLeads.map((lead) => (
                    <Card key={lead.id} className="border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer group relative">
                      {(isSuperAdmin || canTransfer) && (
                        <div className="absolute top-3 right-3 z-10" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                            className="h-4 w-4"
                          />
                        </div>
                      )}
                      <CardContent className="p-4" onClick={() => navigate(`/admissions/${lead.id}`)}>
                        <div className="flex items-start justify-between">
                          <div className="pr-6">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-sm font-semibold text-foreground">{lead.name}</h4>
                              <LeadTemperatureBadge temperature={lead.lead_temperature} score={lead.lead_score} />
                            </div>
                            <p className="text-xs text-primary font-medium mt-0.5">{lead.course_name}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{lead.campus_name}</p>
                        <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone.slice(-4)}</span>
                          {lead.application_id && <span className="font-mono text-primary/70">{lead.application_id}</span>}
                        </div>
                        {(lead.pre_admission_no || lead.admission_no) && (
                          <div className="mt-2">
                            {lead.pre_admission_no && !lead.admission_no && (
                              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">PAN: {lead.pre_admission_no}</Badge>
                            )}
                            {lead.admission_no && (
                              <Badge className="text-[10px] bg-primary text-primary-foreground">AN: {lead.admission_no}</Badge>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                          <div className="flex items-center gap-1.5">
                            <Badge className={`text-[10px] font-medium border-0 ${SOURCE_BADGE_COLORS[lead.source] || "bg-muted"}`}>{SOURCE_LABELS[lead.source] || lead.source}</Badge>
                            <Badge className={`text-[10px] font-medium border-0 capitalize ${PERSON_ROLE_COLORS[lead.person_role] || "bg-muted"}`}>{lead.person_role}</Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><Phone className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><MessageSquare className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">{lead.counsellor_name}</p>
                      </CardContent>
                    </Card>
                  ))}
                  {stageLeads.length === 0 && (
                    <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-xs text-muted-foreground">No leads</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {(isSuperAdmin || canTransfer) && (
                    <th className="px-3 py-3 w-10">
                      <Checkbox
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onCheckedChange={toggleSelectAll}
                        className="h-4 w-4"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course / Campus</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">IDs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors">
                    {(isSuperAdmin || canTransfer) && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(lead.id)}
                          onCheckedChange={() => toggleSelect(lead.id)}
                          className="h-4 w-4"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <div className="font-medium text-foreground">{lead.name}</div>
                      <div className="text-xs text-muted-foreground">{lead.phone} · {lead.email || "—"}</div>
                    </td>
                    <td className="px-4 py-3" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <div className="text-foreground">{lead.course_name}</div>
                      <div className="text-xs text-muted-foreground">{lead.campus_name}</div>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <LeadTemperatureBadge temperature={lead.lead_temperature} score={lead.lead_score} />
                    </td>
                    <td className="px-4 py-3" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <Badge className={`text-[11px] font-medium border-0 ${stageColors[lead.stage] || "bg-muted"}`}>
                        {STAGE_LABELS[lead.stage] || lead.stage}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <Badge className={`text-[11px] font-medium border-0 capitalize ${PERSON_ROLE_COLORS[lead.person_role] || "bg-muted"}`}>
                        {lead.person_role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <Badge className={`text-[11px] font-medium border-0 ${SOURCE_BADGE_COLORS[lead.source] || "bg-muted"}`}>
                        {SOURCE_LABELS[lead.source] || lead.source}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm" onClick={() => navigate(`/admissions/${lead.id}`)}>{lead.counsellor_name}</td>
                    <td className="px-4 py-3" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      {lead.application_id && <div className="text-xs font-mono text-muted-foreground">{lead.application_id}</div>}
                      {lead.pre_admission_no && <div className="text-xs font-mono text-primary">{lead.pre_admission_no}</div>}
                      {lead.admission_no && <div className="text-xs font-mono font-semibold text-primary">{lead.admission_no}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm" onClick={() => navigate(`/admissions/${lead.id}`)}>{new Date(lead.created_at).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><Phone className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <AddLeadDialog open={showAddLead} onOpenChange={setShowAddLead} onSuccess={fetchLeads} />
      <BulkLeadImportDialog open={showBulkImport} onOpenChange={setShowBulkImport} onSuccess={fetchLeads} />

      {/* Bulk WhatsApp */}
      <BulkWhatsAppDialog
        open={showBulkWhatsApp}
        onOpenChange={setShowBulkWhatsApp}
        leads={Array.from(selectedIds).map(id => leads.find(l => l.id === id)).filter(Boolean) as Lead[]}
        onSuccess={() => { fetchLeads(); setSelectedIds(new Set()); }}
      />

      {/* Bulk Transfer Dialog */}
      <TransferLeadDialog
        open={showTransfer}
        onOpenChange={setShowTransfer}
        leadIds={Array.from(selectedIds)}
        leadNames={selectedLeadNames}
        onSuccess={fetchLeads}
      />

      {/* Request Deletion Dialog (non-admin) */}
      <Dialog open={showDeleteRequest} onOpenChange={setShowDeleteRequest}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Deletion</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} will be flagged for deletion. A super admin will review your request.
            </p>
            <div>
              <label className="text-sm font-medium text-foreground">Reason</label>
              <select
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <option value="duplicate">Duplicate lead</option>
                <option value="incorrect">Incorrect / invalid data</option>
                <option value="spam">Spam</option>
                <option value="other">Other</option>
              </select>
            </div>
            {deleteReason === "other" && (
              <div>
                <label className="text-sm font-medium text-foreground">Details</label>
                <textarea
                  value={deleteCustomMsg}
                  onChange={(e) => setDeleteCustomMsg(e.target.value)}
                  placeholder="Explain why this lead should be deleted..."
                  className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[80px]"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteRequest(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleRequestDeletion}
              disabled={submittingRequest || (deleteReason === "other" && !deleteCustomMsg.trim())}
              className="gap-2"
            >
              {submittingRequest && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected lead{selectedIds.size > 1 ? "s" : ""} and all associated data (notes, activities, follow-ups, offer letters, etc.). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Admissions;

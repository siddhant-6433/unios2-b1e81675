import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCampus } from "@/contexts/CampusContext";
import { useCounsellorFilter } from "@/contexts/CounsellorFilterContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useToast } from "@/hooks/use-toast";
import {
  Phone, MessageSquare, ChevronRight, Plus, Search, Filter, Upload,
  Eye, Calendar, MoreHorizontal, Users, TrendingUp, ArrowUpRight,
  Bot, UserCheck, MapPin, FileText, CheckCircle, XCircle, Clock, Loader2,
  Trash2, ArrowRightLeft, Send, Flag, Inbox
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
import { ActionCenterView } from "@/components/admissions/ActionCenterView";
import { CounsellorScoreBadge } from "@/components/admissions/CounsellorScoreBadge";
import { InactivityAlertBanner } from "@/components/admissions/InactivityAlertBanner";
import { CounsellorOnboarding } from "@/components/onboarding/CounsellorOnboarding";
import { useTatDefaults } from "@/hooks/useTatDefaults";
import { LEAD_SOURCES, SOURCE_LABELS, SOURCE_BADGE_COLORS } from "@/config/leadSources";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const STAGES = [
  "new_lead", "application_in_progress", "application_fee_paid", "application_submitted", "counsellor_call", "visit_scheduled",
  "interview", "offer_sent", "token_paid", "pre_admitted", "admitted", "waitlisted",
  "not_interested", "ineligible", "dnc", "deferred", "rejected"
] as const;

type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Application Submitted",
  counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", waitlisted: "Waitlisted",
  not_interested: "Not Interested", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)", rejected: "Rejected",
};

const stageColors: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  application_in_progress: "bg-pastel-yellow text-foreground/70",
  application_fee_paid: "bg-pastel-green text-foreground/70",
  application_submitted: "bg-pastel-mint text-foreground/70",
  counsellor_call: "bg-pastel-orange text-foreground/70",
  visit_scheduled: "bg-pastel-yellow text-foreground/70",
  interview: "bg-pastel-mint text-foreground/70",
  offer_sent: "bg-pastel-green text-foreground/70",
  token_paid: "bg-primary/15 text-primary",
  pre_admitted: "bg-primary/20 text-primary",
  admitted: "bg-primary text-primary-foreground",
  waitlisted: "bg-pastel-orange text-foreground/70",
  not_interested: "bg-muted text-foreground/60",
  ineligible: "bg-pastel-red text-foreground/70",
  dnc: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  deferred: "bg-pastel-purple text-foreground/70",
  rejected: "bg-pastel-red text-foreground/70",
};

const stageIcons: Record<string, typeof Users> = {
  new_lead: Users, application_in_progress: FileText, application_fee_paid: CheckCircle, application_submitted: CheckCircle,
  counsellor_call: Phone,
  visit_scheduled: MapPin, interview: UserCheck, offer_sent: FileText,
  token_paid: CheckCircle, pre_admitted: Clock, admitted: CheckCircle, waitlisted: Clock,
  not_interested: XCircle, ineligible: XCircle, dnc: XCircle, deferred: Clock, rejected: XCircle,
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
  ai_called?: boolean;
  course_name?: string;
  campus_name?: string;
  counsellor_name?: string;
  // Application completion computed after fetch
  app_completion_pct?: number | null;   // 0-100 or null when no app
  app_payment_status?: string | null;
  app_fee_amount?: number | null;
}

// Application step counts for % calculation (matches apply portal)
const STEPS_BY_CATEGORY: Record<string, string[]> = {
  school: ["personal", "parents", "siblings", "questionnaire", "academic", "payment", "documents", "review"],
  default: ["personal", "parents", "academic", "extracurricular", "payment", "documents", "review"],
};

function getCompletionPct(completed_sections: any, program_category: string | null): number {
  if (!completed_sections) return 0;
  const steps = STEPS_BY_CATEGORY[program_category || "default"] || STEPS_BY_CATEGORY.default;
  const done = steps.filter(k => completed_sections[k] === true).length;
  return Math.round((done / steps.length) * 100);
}

// Compact application progress badge
function AppProgressBadge({ pct, paymentStatus }: { pct: number | null | undefined; paymentStatus?: string | null }) {
  if (pct === null || pct === undefined) return null;
  const color = pct === 100
    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : pct >= 50
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
    : pct > 0
    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
    : "bg-muted text-muted-foreground";
  const label = paymentStatus === "paid" && pct < 100 ? `${pct}% · 💳 Paid` : `${pct}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${color}`}
      title={`Application ${pct}% complete${paymentStatus === "paid" ? " · Payment done" : ""}`}>
      {label}
    </span>
  );
}

const Admissions = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role, profile } = useAuth();
  const { selectedCampusId } = useCampus();
  const isTeamLeader = useIsTeamLeader();
  const { toast } = useToast();
  const [view, setView] = useState<"action_center" | "pipeline" | "list" | "seats" | "payments">(
    role === "counsellor" ? "action_center" : "pipeline"
  );
  const [actionCounsellorFilter, setActionCounsellorFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [tempFilter, setTempFilter] = useState<string>("all");
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [inactiveIds, setInactiveIds] = useState<Set<string> | null>(null);
  const [followupLeadIds, setFollowupLeadIds] = useState<Set<string> | null>(null);
  const [visitLeadIds, setVisitLeadIds] = useState<Set<string> | null>(null);
  const [actionLeadIds, setActionLeadIds] = useState<Set<string> | null>(null);
  const [actionBucketLabel, setActionBucketLabel] = useState<string>("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [serverSearching, setServerSearching] = useState(false);

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
  const { myDefaults } = useTatDefaults();
  const canTransfer = isSuperAdmin || isTeamLeader;
  const canFilterByCounsellor = role === "super_admin" || role === "admission_head" || role === "campus_admin" || isTeamLeader;
  const [notCalledIds, setNotCalledIds] = useState<Set<string> | null>(null);
  const [pendingNotCalledFilter, setPendingNotCalledFilter] = useState<string | null>(null);

  // Read URL params on mount — store in ref to survive re-renders
  const urlParamsRead = useRef(false);
  useEffect(() => {
    if (urlParamsRead.current) return;
    const counsellorParam = searchParams.get("counsellor");
    const notCalledParam = searchParams.get("not_called");
    if (!counsellorParam) return;
    urlParamsRead.current = true;
    setCounsellorFilter(counsellorParam);
    setView("list");
    if (notCalledParam === "true") {
      setPendingNotCalledFilter(counsellorParam);
    }
  }, [searchParams]);

  // Apply not-called filter AFTER leads finish loading
  useEffect(() => {
    if (!pendingNotCalledFilter || loading) return;

    const cid = pendingNotCalledFilter;
    setPendingNotCalledFilter(null);

    (async () => {
      // Get counsellor's active leads
      const { data: counsellorLeads, error: clErr } = await supabase
        .from("leads")
        .select("id")
        .eq("counsellor_id", cid);

      console.log("Not-called filter: counsellor leads", counsellorLeads?.length, "error:", clErr?.message);
      if (!counsellorLeads?.length) return;

      // Filter out terminal stages client-side (avoids PostgREST syntax issues)
      const activeIds = counsellorLeads
        .map((l: any) => l.id);

      // Find which have call logs
      const { data: calledLeads } = await supabase
        .from("call_logs" as any)
        .select("lead_id")
        .in("lead_id", activeIds);

      const calledSet = new Set((calledLeads || []).map((c: any) => c.lead_id));
      const notCalledArray = activeIds.filter((id: string) => !calledSet.has(id));
      console.log("Not-called filter: total", activeIds.length, "called", calledSet.size, "not-called", notCalledArray.length);

      if (notCalledArray.length === 0) return;

      // Load missing leads
      const existingIds = new Set(leads.map(l => l.id));
      const missingIds = notCalledArray.filter((id: string) => !existingIds.has(id));
      if (missingIds.length > 0) {
        const { data: extraLeads } = await supabase
          .from("leads")
          .select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
          .in("id", missingIds);
        if (extraLeads) {
          setLeads(prev => [...prev, ...extraLeads.map((l: any) => ({
            ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—",
            counsellor_name: l.profiles?.display_name || "Unassigned",
          }))]);
        }
      }

      setNotCalledIds(new Set(notCalledArray));
    })();
  }, [pendingNotCalledFilter, loading]);

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from("leads")
      .select(`*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)`)
      .order("created_at", { ascending: false })
      .limit(500);
    // Apply counsellor filter (from global bar or self for counsellors)
    if (role === "counsellor" && profile?.id) {
      query = query.eq("counsellor_id", profile.id);
    } else if (counsellorFilter !== "all") {
      query = query.eq("counsellor_id", counsellorFilter);
    } else if (selectedCampusId !== "all") {
      query = query.eq("campus_id", selectedCampusId);
    }
    const { data, error } = await query;

    if (data) {
      const enriched = data.map((l: any) => ({
        ...l,
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        counsellor_name: l.profiles?.display_name || "Unassigned",
        app_completion_pct: null as number | null,
        app_payment_status: null as string | null,
        app_fee_amount: null as number | null,
      }));

      // Fetch applications for these leads (for completion %)
      const leadIds = enriched.map(l => l.id);
      if (leadIds.length > 0) {
        const { data: apps } = await supabase
          .from("applications")
          .select("lead_id, completed_sections, program_category, payment_status, fee_amount, status")
          .in("lead_id", leadIds);
        if (apps && apps.length > 0) {
          const byLead: Record<string, any> = {};
          apps.forEach((a: any) => {
            // Keep the most complete app per lead if duplicates
            const existing = byLead[a.lead_id];
            const pct = getCompletionPct(a.completed_sections, a.program_category);
            if (!existing || pct > existing.pct) {
              byLead[a.lead_id] = { pct, payment_status: a.payment_status, fee_amount: a.fee_amount, status: a.status };
            }
          });
          enriched.forEach(l => {
            const m = byLead[l.id];
            if (m) {
              l.app_completion_pct = m.pct;
              l.app_payment_status = m.payment_status;
              l.app_fee_amount = m.fee_amount ?? null;
            }
          });
        }
      }

      setLeads(enriched);
    }
    setSelectedIds(new Set());
    setLoading(false);
  };

  useEffect(() => { fetchLeads(); }, [selectedCampusId, counsellorFilter]);

  // Server-side search: when search has 3+ chars, query DB for leads beyond the loaded 200
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = search.trim();
    if (q.length < 3) return;

    searchTimerRef.current = setTimeout(async () => {
      setServerSearching(true);
      const digits = q.replace(/\D/g, "");
      // Build server-side search query
      let query = supabase
        .from("leads")
        .select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
        .or(`name.ilike.%${q}%,phone.ilike.%${digits.length >= 3 ? digits : q}%,email.ilike.%${q}%,application_id.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (role === "counsellor" && profile?.id) {
        query = query.eq("counsellor_id", profile.id);
      } else if (selectedCampusId !== "all") {
        query = query.eq("campus_id", selectedCampusId);
      }

      const { data } = await query;
      if (data && data.length > 0) {
        setLeads(prev => {
          const existingIds = new Set(prev.map(l => l.id));
          const newLeads = data
            .filter((l: any) => !existingIds.has(l.id))
            .map((l: any) => ({
              ...l,
              course_name: l.courses?.name || "—",
              campus_name: l.campuses?.name || "—",
              counsellor_name: l.profiles?.display_name || "Unassigned",
              app_completion_pct: null,
              app_payment_status: null, app_fee_amount: null,
            }));
          return newLeads.length > 0 ? [...prev, ...newLeads] : prev;
        });
      }
      setServerSearching(false);
    }, 400);

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search, selectedCampusId, role, profile?.id]);

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
    const matchesStage = stageFilter === "all" || stageFilter.split(",").includes(l.stage);
    const matchesSource = sourceFilter === "all" || l.source === sourceFilter;
    const matchesRole = roleFilter === "all" || l.person_role === roleFilter;
    const matchesTemp = tempFilter === "all" || l.lead_temperature === tempFilter;
    const matchesInactive = !inactiveIds || inactiveIds.has(l.id);
    const matchesFollowup = !followupLeadIds || followupLeadIds.has(l.id);
    const matchesVisit = !visitLeadIds || visitLeadIds.has(l.id);
    const matchesCounsellor = counsellorFilter === "all"
      || (counsellorFilter === "unassigned" ? !l.counsellor_id : l.counsellor_id === counsellorFilter);
    const matchesNotCalled = !notCalledIds || notCalledIds.has(l.id);
    const matchesAction = !actionLeadIds || actionLeadIds.has(l.id);
    return matchesSearch && matchesStage && matchesSource && matchesRole && matchesTemp && matchesInactive && matchesFollowup && matchesVisit && matchesCounsellor && matchesNotCalled && matchesAction;
  });

  const filteredCount = filtered.length;
  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);
  const paginatedLeads = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [stageFilter, sourceFilter, roleFilter, tempFilter, search, counsellorFilter, inactiveIds, followupLeadIds, visitLeadIds, actionLeadIds]);

  const totalLeads = leads.length;

  // Stage counts fetched from DB (not from limited local array)
  const [newLeads, setNewLeads] = useState(0);
  const [todayLeads, setTodayLeads] = useState(0);
  const [appStarted, setAppStarted] = useState(0);
  const [feePaid, setFeePaid] = useState(0);
  const [appSubmitted, setAppSubmitted] = useState(0);
  const [admitted, setAdmitted] = useState(0);

  // Followup & visit counts fetched from DB
  const [pendingFollowups, setPendingFollowups] = useState(0);
  const [todayFollowups, setTodayFollowups] = useState(0);
  const [overdueFollowups, setOverdueFollowups] = useState(0);
  const [upcomingVisits, setUpcomingVisits] = useState(0);
  const [completedVisits, setCompletedVisits] = useState(0);
  const [postVisitPendingIds, setPostVisitPendingIds] = useState<Set<string>>(new Set());

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
          setNewLeads(0); setTodayLeads(0); setAppStarted(0); setFeePaid(0);
          setAppSubmitted(0); setAdmitted(0);
          setPendingFollowups(0); setTodayFollowups(0); setOverdueFollowups(0);
          setUpcomingVisits(0); setCompletedVisits(0);
          return;
        }
      }

      const applyLeadFilter = <T extends any>(q: T): T => {
        if (leadIds) return (q as any).in("lead_id", leadIds) as T;
        return q;
      };

      // Stage count queries — excludes mirror leads to avoid double-counting school leads
      const buildStageQ = (stages: string[]) => {
        let q = supabase.from("leads").select("id", { count: "exact", head: true })
          .in("stage", stages)
          .eq("is_mirror" as any, false);
        if (role === "counsellor" && profile?.id) q = q.eq("counsellor_id", profile.id);
        else if (selectedCampusId !== "all") q = q.eq("campus_id", selectedCampusId);
        return q;
      };

      const buildTodayQ = () => {
        let q = supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("created_at", todayStart + "T00:00:00").lte("created_at", todayEnd)
          .eq("is_mirror" as any, false);
        if (role === "counsellor" && profile?.id) q = q.eq("counsellor_id", profile.id);
        else if (selectedCampusId !== "all") q = q.eq("campus_id", selectedCampusId);
        return q;
      };

      // Fee paid: combine lead stage + applications with payment_status='paid'
      const buildFeePaidQ = async (): Promise<number> => {
        // Leads in fee-paid stages (excludes mirrors)
        const stageRes = await buildStageQ(["application_fee_paid", "application_submitted", "offer_sent", "token_paid", "pre_admitted", "admitted"]);
        // Applications with payment received (catch portal payments not yet reflected in lead stage)
        let appQ = supabase.from("applications").select("lead_id").eq("payment_status", "paid");
        const { data: paidApps } = await appQ;
        const paidLeadIds = new Set((paidApps || []).map((a: any) => a.lead_id));
        // Union: stageRes count + paid apps whose lead is NOT in those stages
        // Simpler: return max of the two since stage count includes most paid apps
        return Math.max(stageRes.count || 0, paidLeadIds.size);
      };

      const [
        pendingRes, todayFuRes, overdueRes, upVisitRes, compVisitRes,
        newLeadRes, todayLeadRes, appStartedRes, appSubmittedRes, admittedRes,
        feePaidCount,
      ] = await Promise.all([
        applyLeadFilter(supabase.from("lead_followups").select("id", { count: "exact", head: true }).eq("status", "pending")),
        applyLeadFilter(supabase.from("lead_followups").select("id", { count: "exact", head: true }).eq("status", "pending").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd)),
        applyLeadFilter(supabase.from("overdue_followups" as any).select("id", { count: "exact", head: true })),
        applyLeadFilter(supabase.from("campus_visits").select("lead_id").gte("visit_date", todayStart).in("status", ["scheduled", "confirmed"])),
        applyLeadFilter(supabase.from("campus_visits").select("lead_id").eq("status", "completed")),
        // Stage counts (mirror-excluded)
        buildStageQ(["new_lead"]),
        buildTodayQ(),
        buildStageQ(["application_in_progress", "application_fee_paid", "application_submitted", "offer_sent", "token_paid", "pre_admitted"]),
        buildStageQ(["application_submitted", "offer_sent", "token_paid", "pre_admitted"]),
        buildStageQ(["admitted"]),
        buildFeePaidQ(),
      ]);

      setPendingFollowups(pendingRes.count || 0);
      setTodayFollowups(todayFuRes.count || 0);
      setOverdueFollowups(overdueRes.count || 0);
      // Count unique leads with visits (not visit count)
      setUpcomingVisits(new Set((upVisitRes.data || []).map((r: any) => r.lead_id)).size);
      setCompletedVisits(new Set((compVisitRes.data || []).map((r: any) => r.lead_id)).size);

      // Fetch post-visit pending lead IDs for visual indicator
      const { data: pvPending } = await supabase
        .from("post_visit_pending_followups" as any)
        .select("lead_id");
      setPostVisitPendingIds(new Set((pvPending || []).map((r: any) => r.lead_id)));
      // Stage counts
      setNewLeads(newLeadRes.count || 0);
      setTodayLeads(todayLeadRes.count || 0);
      setAppStarted(appStartedRes.count || 0);
      setFeePaid(feePaidCount);
      setAppSubmitted(appSubmittedRes.count || 0);
      setAdmitted(admittedRes.count || 0);
    })();
  }, [selectedCampusId, role, profile?.id]);

  // Row 1: Lead data
  const leadStats = [
    { label: "New Leads", value: newLeads, sub: `+${todayLeads} today`, icon: Users, iconBg: "bg-pastel-blue", filterStage: "new_lead", link: "" },
    { label: "Pending Follow-ups", value: pendingFollowups, sub: `${overdueFollowups} overdue · ${todayFollowups} today`, icon: Clock, iconBg: "bg-pastel-orange", filterStage: "", link: "", action: "followups" },
    { label: "Upcoming Visits", value: upcomingVisits, sub: "Scheduled & confirmed", icon: MapPin, iconBg: "bg-pastel-yellow", filterStage: "", link: "", action: "upcoming_visits" },
    { label: "Completed Visits", value: completedVisits, sub: "Campus visits done", icon: CheckCircle, iconBg: "bg-pastel-green", filterStage: "", link: "", action: "completed_visits" },
  ];

  // Row 2: Application stages
  const appStats = [
    { label: "Applications Started", value: appStarted, sub: "In progress or beyond", icon: FileText, iconBg: "bg-pastel-blue", filterStage: "application_in_progress,application_fee_paid,application_submitted,offer_sent,token_paid,pre_admitted", action: "" },
    { label: "Fee Paid", value: feePaid, sub: "Application fee received", icon: CheckCircle, iconBg: "bg-pastel-green", filterStage: "", action: "fee_paid" },
    { label: "Waiting for Offer", value: appSubmitted, sub: "Fully submitted", icon: TrendingUp, iconBg: "bg-pastel-mint", filterStage: "application_submitted,offer_sent,token_paid,pre_admitted", action: "" },
    { label: "Admitted", value: admitted, sub: "Fully admitted students", icon: UserCheck, iconBg: "bg-pastel-purple", filterStage: "admitted", action: "" },
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
        <div className="flex items-center gap-3">
          {role === "counsellor" && <CounsellorScoreBadge />}
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
              <>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowTransfer(true)}>
                  <ArrowRightLeft className="h-4 w-4" /> Transfer
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                  const ids = Array.from(selectedIds);
                  const { error } = await supabase
                    .from("leads")
                    .update({ counsellor_id: null } as any)
                    .in("id", ids);
                  if (error) {
                    toast({ title: "Error", description: error.message, variant: "destructive" });
                  } else {
                    toast({ title: "Moved to bucket", description: `${ids.length} lead${ids.length > 1 ? "s" : ""} unassigned and moved to lead buckets.` });
                    setSelectedIds(new Set());
                    fetchLeads();
                  }
                }}>
                  <Inbox className="h-4 w-4" /> Move to Bucket
                </Button>
              </>
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

      {/* Stat cards & filter banners — hidden when Action Center is active */}
      {view !== "action_center" && <>
      {/* Compact stats: Leads + Applications in a single row */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {/* Lead stats */}
        {leadStats.map((stat) => {
          const isActive = (stat.filterStage && stageFilter === stat.filterStage) ||
            (stat.action === "followups" && !!followupLeadIds) ||
            ((stat.action === "upcoming_visits" || stat.action === "completed_visits") && !!visitLeadIds);
          return (
            <Card
              key={stat.label}
              className={`border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer ${isActive ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
              onClick={async () => {
                if (stat.action === "followups") {
                  if (followupLeadIds) { setFollowupLeadIds(null); setPage(1); return; }
                  const { data } = await supabase.from("lead_followups").select("lead_id").eq("status", "pending").limit(500);
                  const ids = new Set<string>((data || []).map((r: any) => r.lead_id));
                  setFollowupLeadIds(ids); setVisitLeadIds(null); setInactiveIds(null);
                  setStageFilter("all"); setSourceFilter("all"); setRoleFilter("all"); setTempFilter("all"); setSearch(""); setView("list"); return;
                }
                if (stat.action === "upcoming_visits") {
                  if (visitLeadIds) { setVisitLeadIds(null); setPage(1); return; }
                  const todayStart = new Date().toISOString().slice(0, 10);
                  const { data } = await supabase.from("campus_visits").select("lead_id").gte("visit_date", todayStart).in("status", ["scheduled", "confirmed"]).limit(500);
                  const ids = [...new Set<string>((data || []).map((r: any) => r.lead_id))];
                  const missingIds = ids.filter(id => !leads.find(l => l.id === id));
                  if (missingIds.length > 0) {
                    const { data: extraLeads } = await supabase.from("leads").select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)").in("id", missingIds);
                    if (extraLeads) setLeads(prev => [...prev, ...extraLeads.map((l: any) => ({ ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—", counsellor_name: l.profiles?.display_name || "Unassigned" }))]);
                  }
                  setVisitLeadIds(new Set(ids)); setFollowupLeadIds(null); setInactiveIds(null);
                  setStageFilter("all"); setSourceFilter("all"); setRoleFilter("all"); setTempFilter("all"); setCounsellorFilter("all"); setSearch(""); setView("list"); setPage(1); return;
                }
                if (stat.action === "completed_visits") {
                  if (visitLeadIds) { setVisitLeadIds(null); setPage(1); return; }
                  const { data } = await supabase.from("campus_visits").select("lead_id").eq("status", "completed").limit(500);
                  const ids = [...new Set<string>((data || []).map((r: any) => r.lead_id))];
                  const missingIds = ids.filter(id => !leads.find(l => l.id === id));
                  if (missingIds.length > 0) {
                    const { data: extraLeads } = await supabase.from("leads").select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)").in("id", missingIds);
                    if (extraLeads) setLeads(prev => [...prev, ...extraLeads.map((l: any) => ({ ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—", counsellor_name: l.profiles?.display_name || "Unassigned" }))]);
                  }
                  setVisitLeadIds(new Set(ids)); setFollowupLeadIds(null); setInactiveIds(null);
                  setStageFilter("all"); setSourceFilter("all"); setRoleFilter("all"); setTempFilter("all"); setCounsellorFilter("all"); setSearch(""); setView("list"); setPage(1); return;
                }
                if (stat.link) { navigate(stat.link); return; }
                if (stat.filterStage) {
                  if (stageFilter === stat.filterStage) { setStageFilter("all"); setPage(1); return; }
                  // Fetch leads at this stage from DB
                  let sq = supabase.from("leads")
                    .select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
                    .eq("stage", stat.filterStage).order("created_at", { ascending: false }).limit(100);
                  if (role === "counsellor" && profile?.id) sq = sq.eq("counsellor_id", profile.id);
                  else if (selectedCampusId !== "all") sq = sq.eq("campus_id", selectedCampusId);
                  const { data: stageData } = await sq;
                  if (stageData) {
                    setLeads(prev => {
                      const existingIds = new Set(prev.map(l => l.id));
                      const nl = stageData.filter((l: any) => !existingIds.has(l.id)).map((l: any) => ({
                        ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—",
                        counsellor_name: l.profiles?.display_name || "Unassigned", app_completion_pct: null, app_payment_status: null, app_fee_amount: null,
                      }));
                      return nl.length > 0 ? [...prev, ...nl] : prev;
                    });
                  }
                  setStageFilter(stat.filterStage);
                  setFollowupLeadIds(null); setVisitLeadIds(null); setInactiveIds(null); setView("list"); setPage(1);
                }
              }}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${stat.iconBg} shrink-0`}>
                    <stat.icon className="h-3.5 w-3.5 text-foreground/70" />
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground truncate leading-tight">{stat.label}</span>
                </div>
                <p className="text-xl font-bold text-foreground">{stat.value}</p>
                <p className="text-[10px] text-primary font-medium truncate">{stat.sub}</p>
              </CardContent>
            </Card>
          );
        })}
        {/* Application stats */}
        {appStats.map((stat) => (
          <Card
            key={stat.label}
            className={`border-border/60 shadow-none hover:shadow-sm transition-all cursor-pointer ${
              (stat.filterStage && stageFilter === stat.filterStage) || (stat.action === "fee_paid" && actionLeadIds && actionBucketLabel === "Fee Paid")
                ? "ring-2 ring-primary/40 bg-primary/5" : ""
            }`}
            onClick={async () => {
              // Fee Paid uses ID-based filter (count includes leads with paid applications regardless of stage)
              if (stat.action === "fee_paid") {
                if (actionLeadIds && actionBucketLabel === "Fee Paid") {
                  setActionLeadIds(null); setActionBucketLabel(""); setPage(1); return;
                }
                // Get leads with fee-paid stages OR paid applications
                const feeStages = ["application_fee_paid", "application_submitted", "offer_sent", "token_paid", "pre_admitted", "admitted"];
                let stageQ = supabase.from("leads")
                  .select("id")
                  .in("stage", feeStages);
                if (role === "counsellor" && profile?.id) stageQ = stageQ.eq("counsellor_id", profile.id);
                else if (selectedCampusId !== "all") stageQ = stageQ.eq("campus_id", selectedCampusId);
                const { data: stageIds } = await stageQ;

                const { data: paidApps } = await supabase.from("applications").select("lead_id").eq("payment_status", "paid");

                const allIds = new Set<string>([
                  ...((stageIds || []) as any[]).map((l: any) => l.id),
                  ...((paidApps || []) as any[]).map((a: any) => a.lead_id),
                ]);

                // Fetch missing leads
                const idsArr = Array.from(allIds);
                const missingIds = idsArr.filter(id => !leads.find(l => l.id === id));
                if (missingIds.length > 0) {
                  const { data: extraLeads } = await supabase
                    .from("leads")
                    .select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
                    .in("id", missingIds);
                  if (extraLeads) {
                    setLeads(prev => [...prev, ...extraLeads.map((l: any) => ({
                      ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—",
                      counsellor_name: l.profiles?.display_name || "Unassigned",
                      app_completion_pct: null, app_payment_status: null, app_fee_amount: null,
                    }))]);
                  }
                }
                setActionLeadIds(allIds); setActionBucketLabel("Fee Paid");
                setStageFilter("all"); setFollowupLeadIds(null); setVisitLeadIds(null); setInactiveIds(null);
                setView("list"); setPage(1);
                return;
              }

              if (stat.filterStage && stageFilter === stat.filterStage) {
                setStageFilter("all"); setPage(1); return;
              }
              if (stat.filterStage) {
                // Fetch leads at these stages from DB
                const stages = stat.filterStage.split(",");
                let q = supabase
                  .from("leads")
                  .select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
                  .in("stage", stages)
                  .order("created_at", { ascending: false })
                  .limit(100);
                if (role === "counsellor" && profile?.id) q = q.eq("counsellor_id", profile.id);
                else if (selectedCampusId !== "all") q = q.eq("campus_id", selectedCampusId);
                const { data: stageLeads } = await q;
                if (stageLeads) {
                  setLeads(prev => {
                    const existingIds = new Set(prev.map(l => l.id));
                    const newLeads = stageLeads
                      .filter((l: any) => !existingIds.has(l.id))
                      .map((l: any) => ({
                        ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—",
                        counsellor_name: l.profiles?.display_name || "Unassigned",
                        app_completion_pct: null, app_payment_status: null, app_fee_amount: null,
                      }));
                    return newLeads.length > 0 ? [...prev, ...newLeads] : prev;
                  });
                }
                setStageFilter(stat.filterStage); setActionLeadIds(null); setActionBucketLabel("");
                setFollowupLeadIds(null); setVisitLeadIds(null); setInactiveIds(null);
                setView("list"); setPage(1);
              }
            }}
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`flex h-6 w-6 items-center justify-center rounded-md ${stat.iconBg} shrink-0`}>
                  <stat.icon className="h-3.5 w-3.5 text-foreground/70" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground truncate leading-tight">{stat.label}</span>
              </div>
              <p className="text-xl font-bold text-foreground">{stat.value}</p>
              <p className="text-[10px] text-primary font-medium truncate">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
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

      {/* TAT Defaults Banner — visible to counsellors with pending tasks */}
      {myDefaults && myDefaults.total_defaults > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/10 dark:border-red-900/30 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
            <Clock className="h-4 w-4 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              You have {myDefaults.total_defaults} pending action{myDefaults.total_defaults > 1 ? "s" : ""}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              {[
                myDefaults.new_leads_overdue > 0 && `${myDefaults.new_leads_overdue} new leads to contact`,
                myDefaults.overdue_followups > 0 && `${myDefaults.overdue_followups} overdue follow-ups`,
                myDefaults.app_checkins_overdue > 0 && `${myDefaults.app_checkins_overdue} application check-ins`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100 shrink-0" onClick={() => navigate("/counsellor-dashboard?tab=tat-defaults")}>
            View Details
          </Button>
        </div>
      )}

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

      {visitLeadIds && (
        <div className="flex items-center gap-2 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/40 px-3 py-2 text-sm">
          <MapPin className="h-3.5 w-3.5 text-violet-600" />
          <span className="font-medium text-violet-800 dark:text-violet-300">
            Showing {visitLeadIds.size} lead{visitLeadIds.size !== 1 ? "s" : ""} with campus visits
          </span>
          <button
            onClick={() => setVisitLeadIds(null)}
            className="ml-2 rounded-md bg-violet-200 dark:bg-violet-800 px-2 py-0.5 text-xs font-medium text-violet-800 dark:text-violet-200 hover:bg-violet-300 dark:hover:bg-violet-700"
          >
            Clear filter
          </button>
        </div>
      )}

      {notCalledIds && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 px-3 py-2 text-sm">
          <Phone className="h-3.5 w-3.5 text-red-600" />
          <span className="font-medium text-red-800 dark:text-red-300">
            Showing {notCalledIds.size} not-called lead{notCalledIds.size !== 1 ? "s" : ""} — select and transfer to reassign
          </span>
          <button
            onClick={() => { setNotCalledIds(null); setCounsellorFilter("all"); }}
            className="ml-2 rounded-md bg-red-200 dark:bg-red-800 px-2 py-0.5 text-xs font-medium text-red-800 dark:text-red-200 hover:bg-red-300 dark:hover:bg-red-700"
          >
            Clear filter
          </button>
        </div>
      )}

      {actionLeadIds && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-sm">
          <Filter className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium text-foreground">
            Showing {actionLeadIds.size} lead{actionLeadIds.size !== 1 ? "s" : ""} from <span className="text-primary">{actionBucketLabel}</span>
          </span>
          <button
            onClick={() => { setActionLeadIds(null); setActionBucketLabel(""); }}
            className="ml-2 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
          >
            Clear filter
          </button>
          <button
            onClick={() => { setActionLeadIds(null); setActionBucketLabel(""); setView("action_center"); }}
            className="ml-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
          >
            Back to Action Center
          </button>
        </div>
      )}

      </>}

      {/* View tabs — always visible */}
      <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
        {((role === "counsellor" ? ["action_center", "pipeline", "list"] : ["action_center", "pipeline", "list", "seats", "payments"]) as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {v === "action_center" ? "Action Center" : v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Search & filters — hidden on Action Center view */}
      {view !== "action_center" && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            {serverSearching ? (
              <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            )}
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
        </div>
      )}

      {view === "action_center" ? (
        <ActionCenterView
          counsellorFilter={actionCounsellorFilter}
          counsellorOptions={counsellorOptions}
          canFilterByCounsellor={canFilterByCounsellor}
          onCounsellorFilterChange={setActionCounsellorFilter}
          onViewAll={(bucket, leadIds) => {
            const labels: Record<string, string> = {
              overdue: "Overdue Follow-ups",
              new_leads: "New Leads to Contact",
              today_followups: "Today's Follow-ups",
              today_visits: "Today's Visits",
              post_visit: "Post-Visit Pending",
              stalled: "Stalled Applications",
              upcoming: "Upcoming This Week",
            };
            // Fetch leads that might not be loaded yet, then switch to list
            (async () => {
              const missingIds = leadIds.filter(id => !leads.find(l => l.id === id));
              if (missingIds.length > 0) {
                const { data: extraLeads } = await supabase
                  .from("leads")
                  .select("*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)")
                  .in("id", missingIds);
                if (extraLeads) {
                  setLeads(prev => [...prev, ...extraLeads.map((l: any) => ({
                    ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—",
                    counsellor_name: l.profiles?.display_name || "Unassigned",
                    app_completion_pct: null, app_payment_status: null, app_fee_amount: null,
                  }))]);
                }
              }
              setActionLeadIds(new Set(leadIds));
              setActionBucketLabel(labels[bucket] || bucket);
              setFollowupLeadIds(null);
              setVisitLeadIds(null);
              setInactiveIds(null);
              setNotCalledIds(null);
              setStageFilter("all");
              setSourceFilter("all");
              setRoleFilter("all");
              setTempFilter("all");
              setSearch("");
              setView("list");
              setPage(1);
            })();
          }}
        />
      ) : view === "seats" ? (
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
                          <AppProgressBadge pct={lead.app_completion_pct} paymentStatus={lead.app_payment_status} />
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
        <>
        {/* Filtered count header */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{paginatedLeads.length}</span> of <span className="font-semibold text-foreground">{filteredCount}</span> leads
            {filteredCount !== totalLeads && <span> (filtered from {totalLeads})</span>}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-40 hover:bg-muted">
                Prev
              </button>
              <span className="text-xs text-muted-foreground px-2">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium text-foreground disabled:opacity-40 hover:bg-muted">
                Next
              </button>
            </div>
          )}
        </div>
        <Card className="border-border/60 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {(isSuperAdmin || canTransfer) && (
                    <th className="px-3 py-3 w-10">
                      <Checkbox
                        checked={selectedIds.size === paginatedLeads.length && paginatedLeads.length > 0}
                        onCheckedChange={() => {
                          if (selectedIds.size === paginatedLeads.length) setSelectedIds(new Set());
                          else setSelectedIds(new Set(paginatedLeads.map(l => l.id)));
                        }}
                        className="h-4 w-4"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Course / Campus</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">App %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">App Fee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Counsellor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">IDs</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((lead) => (
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
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{lead.name}</span>
                        {lead.ai_called && (
                          <span className="flex h-4 w-4 items-center justify-center rounded bg-violet-100 dark:bg-violet-900/30" title="AI Called">
                            <Bot className="h-2.5 w-2.5 text-violet-600" />
                          </span>
                        )}
                        {postVisitPendingIds.has(lead.id) && (
                          <span className="flex h-4 items-center gap-0.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1" title="Post-visit followup pending">
                            <MapPin className="h-2.5 w-2.5 text-amber-600" />
                            <span className="text-[8px] font-bold text-amber-700">VISIT F/U</span>
                          </span>
                        )}
                      </div>
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
                    <td className="px-4 py-3 text-center" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      {lead.app_completion_pct !== null && lead.app_completion_pct !== undefined ? (
                        <AppProgressBadge pct={lead.app_completion_pct} paymentStatus={lead.app_payment_status} />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      {lead.app_fee_amount != null && lead.app_fee_amount > 0 ? (
                        <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                          ₹{Number(lead.app_fee_amount).toLocaleString("en-IN")}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
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
        {/* Bottom pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredCount)} of {filteredCount}
            </p>
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
          </div>
        )}
        </>
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

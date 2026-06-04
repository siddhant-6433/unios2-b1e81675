import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdmissionsStats } from "@/hooks/useAdmissionsData";
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
  Trash2, ArrowRightLeft, Send, Flag, Inbox, Gift, Shield, CreditCard
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AddLeadDialog } from "@/components/admissions/AddLeadDialog";
import { LeadDraftsPanel } from "@/components/admissions/LeadDraftsPanel";
import { BulkLeadImportDialog } from "@/components/admissions/BulkLeadImportDialog";
import { TransferLeadDialog } from "@/components/admissions/TransferLeadDialog";
import { BulkWhatsAppDialog } from "@/components/admissions/BulkWhatsAppDialog";
import { LeadTemperatureBadge } from "@/components/admissions/LeadTemperatureBadge";
import { CahetPendingBadge } from "@/components/leads/CahetPendingBadge";
import { SeatMatrix } from "@/components/admissions/SeatMatrix";
import { PaymentReconciliation } from "@/components/admissions/PaymentReconciliation";
import { ActionCenterView } from "@/components/admissions/ActionCenterView";
import { CounsellorScoreBadge } from "@/components/admissions/CounsellorScoreBadge";
import { HotLeadsSidebar } from "@/components/admissions/HotLeadsSidebar";
import { CounsellorOnboarding } from "@/components/onboarding/CounsellorOnboarding";
import { CloudDialerNudge } from "@/components/admissions/CloudDialerNudge";
import { LeadPipeline, leadStagesForBucket, type LeadFunnelStage } from "@/components/admissions/LeadPipeline";
import { VisitActionCenter, type VisitAction } from "@/components/admissions/VisitActionCenter";
import { VisitPipeline } from "@/components/admissions/VisitPipeline";
import { type VisitFunnelStage, VISIT_FUNNEL_ORDER } from "@/lib/leadStages";
import { useTatDefaults } from "@/hooks/useTatDefaults";
import { LEAD_SOURCES, SOURCE_LABELS, SOURCE_BADGE_COLORS } from "@/config/leadSources";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { groupCourses, type CourseLike } from "@/lib/courseSort";

const STAGES = [
  "new_lead", "priority_interested", "application_in_progress", "application_fee_paid", "application_submitted", "counsellor_call", "visit_scheduled",
  "interview", "offer_sent", "token_paid", "pre_admitted", "admitted", "waitlisted",
  "not_interested", "ineligible", "dnc", "deferred", "rejected"
] as const;

type Stage = typeof STAGES[number];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", priority_interested: "Priority Interested",
  application_in_progress: "Application In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Application Submitted",
  counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", waitlisted: "Waitlisted",
  not_interested: "Not Interested", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)", rejected: "Rejected",
};

const stageColors: Record<string, string> = {
  new_lead: "bg-pastel-blue text-foreground/70",
  priority_interested: "bg-pastel-pink text-foreground/70",
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
  new_lead: Users, priority_interested: Flag,
  application_in_progress: FileText, application_fee_paid: CheckCircle, application_submitted: CheckCircle,
  counsellor_call: Phone,
  visit_scheduled: MapPin, interview: UserCheck, offer_sent: FileText,
  token_paid: CheckCircle, pre_admitted: Clock, admitted: CheckCircle, waitlisted: Clock,
  not_interested: XCircle, ineligible: XCircle, dnc: XCircle, deferred: Clock, rejected: XCircle,
};

// Lead sources imported from @/config/leadSources

type LeadInstitutionType = "all" | "school" | "college";

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

const APPLICATION_HYDRATE_CHUNK_SIZE = 50;

function chunkIds(ids: string[], size = APPLICATION_HYDRATE_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
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
    "list"
  );
  const [actionCounsellorFilter, setActionCounsellorFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [leadInstitutionType, setLeadInstitutionType] = useState<LeadInstitutionType>("all");
  const [courseFilter, setCourseFilter] = useState<string[]>([]);
  const [debouncedCourseFilter, setDebouncedCourseFilter] = useState<string[]>([]);
  const [courseOptions, setCourseOptions] = useState<(CourseLike & { id: string; name: string })[]>([]);
  const [courseSearch, setCourseSearch] = useState("");
  const [coursePopoverOpen, setCoursePopoverOpen] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [tempFilter, setTempFilter] = useState<string>("all");
  const { counsellorFilter, setCounsellorFilter } = useCounsellorFilter();
  const [counsellorOptions, setCounsellorOptions] = useState<{ id: string; name: string }[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | undefined>();
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [inactiveIds, setInactiveIds] = useState<Set<string> | null>(null);
  const [followupLeadIds, setFollowupLeadIds] = useState<Set<string> | null>(null);
  const [visitLeadIds, setVisitLeadIds] = useState<Set<string> | null>(null);
  const [actionLeadIds, setActionLeadIds] = useState<Set<string> | null>(null);
  const [actionBucketLabel, setActionBucketLabel] = useState<string>("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Server-side total count (only used in list view — pipeline view fetches all)
  const [totalCount, setTotalCount] = useState(0);

  // ── Lead-pipeline funnel + Visit Action Center ────────────────────────
  // Org-wide stage counts (drives the funnel + leakage chip). Fetched once
  // per mount; per-stage HEAD count queries in parallel (Supabase REST caps
  // SELECT rows at 1000, so a single GROUP-BY-on-client wouldn't see the
  // tail of the data — admitted lead at row 8.5k would silently disappear).
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  // Leads in counsellor_call/ai_called with at least one call_log disposition='interested'.
  // Promoted into Hot in the funnel — option (b) from the design call.
  const [extraHotCount, setExtraHotCount] = useState(0);
  const [interestedLeadIds, setInterestedLeadIds] = useState<Set<string>>(new Set());
  // AI-call summaries keyed by lead_id, shown inline under each lead's name
  // in the leads list. Fetched in the same batch query for the visible page.
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [funnelStage, setFunnelStage] = useState<LeadFunnelStage | "leakage" | null>(null);
  // Visit-action counts for the operational dashboard.
  const [visitActionCounts, setVisitActionCounts] = useState({
    missedCallbacks: 0, overdueFollowups: 0,
    scheduled: 0, scheduledToday: 0, scheduledThisWeek: 0,
    checkinPending: 0,
    visitsCompleted: 0, visitsCompletedPendingFollowup: 0,
  });
  const [visitAction, setVisitAction] = useState<VisitAction | null>(null);
  // Visit funnel (second pipeline, sourced from visit_funnel_leads view).
  // Counts per box + the lead_id set per box (for click-to-filter), so a
  // single fetch drives both the chart and the filter.
  const [visitFunnelCounts, setVisitFunnelCounts] = useState<Record<VisitFunnelStage, number>>({
    scheduled: 0, confirmed: 0, completed: 0, visit_followup: 0, applied: 0, admitted: 0,
  });
  const [visitFunnelLeakage, setVisitFunnelLeakage] = useState(0);
  const [visitFunnelBoxIds, setVisitFunnelBoxIds] = useState<Record<string, string[]>>({});
  const [visitFunnelBox, setVisitFunnelBox] = useState<VisitFunnelStage | "leakage" | null>(null);
  // Debounced search — keeps server roundtrips low while typing
  const [debouncedSearch, setDebouncedSearch] = useState("");

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
  const canTransfer = isSuperAdmin || isTeamLeader
    || role === "admission_head" || role === "campus_admin" || role === "principal";
  const canFilterByCounsellor = role === "super_admin" || role === "admission_head" || role === "campus_admin" || isTeamLeader;
  const [notCalledIds, setNotCalledIds] = useState<Set<string> | null>(null);
  const [pendingNotCalledFilter, setPendingNotCalledFilter] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // Read URL params on mount — store in ref to survive re-renders.
  // Supports drill-down from external dashboards (e.g. Publisher Analytics):
  //   ?source=salahlo&stage=admitted,token_paid&from=2026-04-01&to=2026-04-30
  const urlParamsRead = useRef(false);
  useEffect(() => {
    if (urlParamsRead.current) return;
    const counsellorParam = searchParams.get("counsellor");
    const notCalledParam  = searchParams.get("not_called");
    const sourceParam     = searchParams.get("source");
    const stageParam      = searchParams.get("stage");
    const fromParam       = searchParams.get("from");
    const toParam         = searchParams.get("to");

    const anyParam = counsellorParam || sourceParam || stageParam || fromParam || toParam;
    if (!anyParam) return;
    urlParamsRead.current = true;
    setView("list");

    if (counsellorParam) setCounsellorFilter(counsellorParam);
    if (sourceParam)     setSourceFilter(sourceParam);
    if (stageParam)      setStageFilter(stageParam);
    if (fromParam)       setFromDate(fromParam);
    if (toParam)         setToDate(toParam);
    if (notCalledParam === "true" && counsellorParam) {
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

  // Debounce search input so we don't query the DB on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Debounce course multi-select toggles — coalesce rapid checkbox clicks
  // into one refetch so the table doesn't flicker between selections.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCourseFilter(courseFilter), 350);
    return () => clearTimeout(t);
  }, [courseFilter]);

  const categoryCourseIds = useMemo(() => {
    if (leadInstitutionType === "all") return [];
    return courseOptions
      .filter((c) => (c.institution_type || "").toLowerCase() === leadInstitutionType)
      .map((c) => c.id);
  }, [courseOptions, leadInstitutionType]);

  const courseOptionsForFilter = useMemo(() => {
    if (leadInstitutionType === "all") return courseOptions;
    return courseOptions.filter((c) => (c.institution_type || "").toLowerCase() === leadInstitutionType);
  }, [courseOptions, leadInstitutionType]);

  const effectiveCourseFilterIds = useMemo(() => {
    if (leadInstitutionType === "all") return debouncedCourseFilter;
    const categorySet = new Set(categoryCourseIds);
    if (debouncedCourseFilter.length === 0) return categoryCourseIds;
    return debouncedCourseFilter.filter((id) => categorySet.has(id));
  }, [categoryCourseIds, debouncedCourseFilter, leadInstitutionType]);

  useEffect(() => {
    if (leadInstitutionType === "all" || courseOptions.length === 0) return;
    const allowed = new Set(categoryCourseIds);
    setCourseFilter((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
    setCourseSearch("");
  }, [categoryCourseIds, courseOptions.length, leadInstitutionType]);

  // Hydrate application completion % for whichever rows we just loaded.
  // Split out so both fetch paths can reuse it.
  const hydrateApplications = async (rows: any[]) => {
    if (!rows.length) return rows;
    const leadIds = rows.map(r => r.id);
    const apps: any[] = [];
    for (const leadIdBatch of chunkIds(leadIds)) {
      const { data, error } = await supabase
        .from("applications")
        .select("lead_id, completed_sections, program_category, payment_status, fee_amount, status")
        .in("lead_id", leadIdBatch);
      if (error) {
        console.warn("[Admissions] application hydration skipped for a lead batch", error.message);
        continue;
      }
      if (data?.length) apps.push(...data);
    }
    if (!apps?.length) return rows;
    const byLead: Record<string, any> = {};
    apps.forEach((a: any) => {
      const existing = byLead[a.lead_id];
      const pct = getCompletionPct(a.completed_sections, a.program_category);
      if (!existing || pct > existing.pct) {
        byLead[a.lead_id] = { pct, payment_status: a.payment_status, fee_amount: a.fee_amount, status: a.status };
      }
    });
    rows.forEach((l: any) => {
      const m = byLead[l.id];
      if (m) {
        l.app_completion_pct = m.pct;
        l.app_payment_status = m.payment_status;
        l.app_fee_amount = m.fee_amount ?? null;
      }
    });
    return rows;
  };

  const applyApplicationHydration = (rows: Lead[]) => {
    const rowsToHydrate = rows.map(row => ({ ...row }));
    void hydrateApplications(rowsToHydrate).then((hydratedRows) => {
      const byLead = new Map(hydratedRows.map((row: Lead) => [row.id, row]));
      setLeads(current => current.map(lead => {
        const hydrated = byLead.get(lead.id);
        if (!hydrated) return lead;
        return {
          ...lead,
          app_completion_pct: hydrated.app_completion_pct,
          app_payment_status: hydrated.app_payment_status,
          app_fee_amount: hydrated.app_fee_amount,
        };
      }));
    });
  };

  const fetchLeads = async () => {
    setLoading(true);
    setLoadError(null);

    try {
      // Pipeline / action_center / seats / payments need the in-memory pool to
      // bucket by stage. Capped at 500 (same as before — those views are heavy).
      // List view is the hot path most counsellors live in; it pages server-side.
      if (view !== "list") {
        let query = supabase
          .from("leads")
          .select(`*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)`)
          .order("created_at", { ascending: false })
          .limit(500);
        if (role === "counsellor" && profile?.id) {
          query = query.eq("counsellor_id", profile.id);
        } else if (counsellorFilter !== "all" && counsellorFilter !== "unassigned") {
          query = query.eq("counsellor_id", counsellorFilter);
        } else if (counsellorFilter === "unassigned") {
          query = query.is("counsellor_id", null);
        } else if (selectedCampusId !== "all") {
          query = query.eq("campus_id", selectedCampusId);
        }
        const { data, error } = await query;
        if (error) throw error;
        const enriched = (data || []).map((l: any) => ({
          ...l,
          course_name: l.courses?.name || "—",
          campus_name: l.campuses?.name || "—",
          counsellor_name: l.profiles?.display_name || "Unassigned",
          app_completion_pct: null as number | null,
          app_payment_status: null as string | null,
          app_fee_amount: null as number | null,
        }));
        setLeads(enriched);
        setTotalCount(enriched.length);
        setSelectedIds(new Set());
        setHasLoadedOnce(true);
        applyApplicationHydration(enriched);
        return;
      }

      // ── List view: server-side filter + paginate ───────────────────────────
      const offset = (page - 1) * PAGE_SIZE;
      let query: any = supabase
        .from("leads")
        .select(
          "*, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      // Counsellor / campus scope
      if (role === "counsellor" && profile?.id) {
        query = query.eq("counsellor_id", profile.id);
      } else if (counsellorFilter === "unassigned") {
        query = query.is("counsellor_id", null);
      } else if (counsellorFilter !== "all") {
        query = query.eq("counsellor_id", counsellorFilter);
      } else if (selectedCampusId !== "all") {
        query = query.eq("campus_id", selectedCampusId);
      }

      // Stage / source / role / temperature
      if (stageFilter !== "all") {
        const stages = stageFilter.split(",").map(s => s.trim()).filter(Boolean);
        if (stages.length === 1) query = query.eq("stage", stages[0]);
        else if (stages.length > 1) query = query.in("stage", stages);
      }
      if (sourceFilter !== "all") query = query.eq("source", sourceFilter);
      if (leadInstitutionType !== "all" && effectiveCourseFilterIds.length === 0) {
        setLeads([]); setTotalCount(0); setSelectedIds(new Set()); setHasLoadedOnce(true);
        return;
      }
      if (effectiveCourseFilterIds.length > 0) query = query.in("course_id", effectiveCourseFilterIds);
      if (roleFilter !== "all") query = query.eq("person_role", roleFilter);
      if (tempFilter !== "all") query = query.eq("lead_temperature", tempFilter);

      // Date range (applied to created_at)
      if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00`);
      if (toDate) query = query.lte("created_at", `${toDate}T23:59:59.999`);

      // Multi-field search (server-side ilike OR). Triggered after ≥ 2 chars.
      if (debouncedSearch.length >= 2) {
        const q = debouncedSearch;
        const digits = q.replace(/\D/g, "");
        const phoneTerm = digits.length >= 3 ? digits : q;
        // Escape any commas in the user-supplied search to avoid breaking the OR string
        const safe = (s: string) => s.replace(/,/g, "");
        query = query.or(
          `name.ilike.%${safe(q)}%,phone.ilike.%${safe(phoneTerm)}%,email.ilike.%${safe(q)}%,application_id.ilike.%${safe(q)}%`
        );
      }

      // ID-set filters: intersect any active sets and pass the result as .in("id", …)
      const idSets: (Set<string> | null)[] = [inactiveIds, followupLeadIds, visitLeadIds, actionLeadIds, notCalledIds];
      const activeSets = idSets.filter((s): s is Set<string> => s !== null);
      if (activeSets.length > 0) {
        let intersection = Array.from(activeSets[0]);
        for (let i = 1; i < activeSets.length; i++) {
          const other = activeSets[i];
          intersection = intersection.filter(id => other.has(id));
        }
        if (intersection.length === 0) {
          setLeads([]); setTotalCount(0); setSelectedIds(new Set()); setHasLoadedOnce(true);
          return;
        }
        query = query.in("id", intersection);
      }

      query = query.range(offset, offset + PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      const enriched = (data || []).map((l: any) => ({
        ...l,
        course_name: l.courses?.name || "—",
        campus_name: l.campuses?.name || "—",
        counsellor_name: l.profiles?.display_name || "Unassigned",
        app_completion_pct: null as number | null,
        app_payment_status: null as string | null,
        app_fee_amount: null as number | null,
      }));
      setLeads(enriched);
      setTotalCount(count ?? enriched.length);
      setHasLoadedOnce(true);
      applyApplicationHydration(enriched);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load admissions leads.";
      console.error("[Admissions] failed to load leads", error);
      setLoadError(message);
      if (!hasLoadedOnce) {
        setLeads([]);
        setTotalCount(0);
        setSelectedIds(new Set());
        setHasLoadedOnce(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Refetch whenever any input that affects the query changes
  useEffect(() => {
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view, page, selectedCampusId, counsellorFilter, role, profile?.id,
    stageFilter, sourceFilter, leadInstitutionType, effectiveCourseFilterIds, roleFilter, tempFilter,
    fromDate, toDate, debouncedSearch,
    inactiveIds, followupLeadIds, visitLeadIds, actionLeadIds, notCalledIds,
  ]);

  // Fetch course options for the multi-select filter, joined with the
  // campus / department hierarchy so we can group them under section
  // headers (Mirai → Toddlers / Montessori / EYP / PYP / MYP;
  //  NIMT Beacon → Toddler / Pre-Nursery / LKG / UKG / Classes).
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("courses")
        .select(`id, name, code,
          departments:department_id (
            name,
            institutions:institution_id (
              name, type,
              campuses:campus_id ( name )
            )
          )`)
        .order("name");
      if (!data) return;
      setCourseOptions(
        (data as any[]).map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code ?? null,
          department_name: c.departments?.name ?? null,
          institution_name: c.departments?.institutions?.name ?? null,
          institution_type: c.departments?.institutions?.type ?? null,
          campus_name: c.departments?.institutions?.campuses?.name ?? null,
        }))
      );
    })();
  }, []);

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

  // Auto-refresh when leads change (new leads, stage changes, assignments).
  // Scoped + debounced + cache-aware: invalidates the cached stats so the
  // dashboard counters update too without an extra fetch per render.
  const queryClient = useQueryClient();
  // Keep latest fetchLeads in a ref so the long-lived realtime subscription
  // always invokes the current closure (current page/filters), not a stale one.
  const fetchLeadsRef = useRef(fetchLeads);
  useEffect(() => { fetchLeadsRef.current = fetchLeads; });

  useEffect(() => {
    let filter: string | undefined;
    if (role === "counsellor" && profile?.id) {
      filter = `counsellor_id=eq.${profile.id}`;
    } else if (selectedCampusId !== "all") {
      filter = `campus_id=eq.${selectedCampusId}`;
    }

    // Throttled refetch: at most once every 30s, with a 5s trailing debounce.
    // The 800ms debounce + event:"*" used to flood the page with refetches on
    // busy days — every ai_summary / last_activity UPDATE was a reload.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefetchAt = 0;
    const MIN_GAP_MS = 30_000;
    const DEBOUNCE_MS = 5_000;
    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const since = Date.now() - lastRefetchAt;
      const wait = Math.max(DEBOUNCE_MS, MIN_GAP_MS - since);
      debounceTimer = setTimeout(() => {
        lastRefetchAt = Date.now();
        fetchLeadsRef.current();
        queryClient.invalidateQueries({ queryKey: ["admissions-stats"] });
      }, wait);
    };

    // Only listen for INSERT (new leads). Stage / assignment changes are
    // visible on next manual filter change or page nav — the constant
    // re-renders caused by UPDATE events aren't worth the disruption.
    const channel = supabase
      .channel(`leads-realtime-${filter ?? "all"}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "leads", ...(filter ? { filter } : {}) },
        scheduleRefetch,
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [selectedCampusId, role, profile?.id, queryClient]);

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
    const matchesCourse = effectiveCourseFilterIds.length === 0 || (l.course_id != null && effectiveCourseFilterIds.includes(l.course_id));
    const matchesRole = roleFilter === "all" || l.person_role === roleFilter;
    const matchesTemp = tempFilter === "all" || l.lead_temperature === tempFilter;
    const matchesInactive = !inactiveIds || inactiveIds.has(l.id);
    const matchesFollowup = !followupLeadIds || followupLeadIds.has(l.id);
    const matchesVisit = !visitLeadIds || visitLeadIds.has(l.id);
    const matchesCounsellor = counsellorFilter === "all"
      || (counsellorFilter === "unassigned" ? !l.counsellor_id : l.counsellor_id === counsellorFilter);
    const matchesNotCalled = !notCalledIds || notCalledIds.has(l.id);
    const matchesAction = !actionLeadIds || actionLeadIds.has(l.id);
    // Date-range filter (URL ?from=YYYY-MM-DD&to=YYYY-MM-DD or in-page state)
    let matchesDate = true;
    if (fromDate || toDate) {
      const t = new Date(l.created_at).getTime();
      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`).getTime();
        if (t < from) matchesDate = false;
      }
      if (matchesDate && toDate) {
        const to = new Date(`${toDate}T23:59:59.999`).getTime();
        if (t > to) matchesDate = false;
      }
    }
    return matchesSearch && matchesStage && matchesSource && matchesCourse && matchesRole && matchesTemp && matchesInactive && matchesFollowup && matchesVisit && matchesCounsellor && matchesNotCalled && matchesAction && matchesDate;
  });

  // List view paginates server-side: `leads` is already the current page
  // and `totalCount` is the unpaginated total. Pipeline / action_center
  // still need the client-side `filtered` array for stage bucketing.
  const filteredCount = view === "list" ? totalCount : filtered.length;
  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);
  const paginatedLeads = view === "list" ? leads : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [stageFilter, sourceFilter, leadInstitutionType, effectiveCourseFilterIds, roleFilter, tempFilter, search, counsellorFilter, inactiveIds, followupLeadIds, visitLeadIds, actionLeadIds, fromDate, toDate]);

  // Fetch lead-pipeline counts (one GROUP-BY) + visit-action counts. Cheap
  // queries; refresh on mount. Counsellor-scoped via stage filter when the
  // signed-in user is a counsellor.
  useEffect(() => {
    let cancelled = false;
    const fetchPipelineData = async () => {
      // Per-stage HEAD count queries. Each is { count: 'exact', head: true }
      // so we never pull rows — the Supabase REST 1000-row cap doesn't
      // matter. is_mirror=false matches the admissions_stats RPC so
      // school + main session leads aren't double-counted.
      const allStages = [
        "new_lead","ai_called","counsellor_call","priority_interested",
        "visit_scheduled","interview",
        "application_in_progress","application_submitted","application_fee_paid",
        "application_approved","offer_sent","token_paid","pre_admitted","admitted",
        "not_interested","dnc","rejected","ineligible","deferred",
      ];
      // Single GROUP BY scan instead of one HEAD count per stage. The
      // get_lead_stage_counts RPC is SECURITY INVOKER, so the leads RLS policy
      // applies exactly as it did to the per-stage queries — same scoping
      // (is_mirror=false; counsellor → own leads; else selected campus).
      const { data: stageRows } = await (supabase as any).rpc("get_lead_stage_counts", {
        p_campus_id: (role !== "counsellor" && selectedCampusId && selectedCampusId !== "all")
          ? selectedCampusId : null,
        p_counsellor_id: (role === "counsellor" && profile?.id) ? profile.id : null,
        p_exclude_mirror: true,
      });
      if (cancelled) return;
      const tally: Record<string, number> = {};
      for (const s of allStages) tally[s] = 0;
      for (const r of (stageRows || []) as { stage: string; count: number }[]) {
        if (r.stage in tally) tally[r.stage] = Number(r.count) || 0;
      }
      setStageCounts(tally);

      // Pull lead_ids for `disposition='interested'` calls so we can both
      // (a) promote them into Hot in the funnel and (b) include them when
      // the Hot bucket is clicked. We fetch ids so we can dedupe AND
      // intersect with stage filters client-side.
      const { data: interestedRows } = await supabase
        .from("call_logs")
        .select("lead_id")
        .eq("disposition", "interested")
        .limit(2000);
      const ids = new Set<string>((interestedRows || []).map((r: any) => r.lead_id).filter(Boolean));
      if (!cancelled) {
        setInterestedLeadIds(ids);
        // Cap at the Contacted bucket size — anything beyond is already in
        // a later stage and shouldn't be re-counted.
        const contacted = (tally["counsellor_call"] || 0) + (tally["ai_called"] || 0);
        setExtraHotCount(Math.min(ids.size, contacted));
      }

      // Visit action counts — parallel HEAD counts.
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const sevenDays = new Date(now.getTime() + 7 * 86400000).toISOString();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();
      const nowIso = now.toISOString();
      const [
        { count: missedCallbacks },
        { count: overdueFollowupsView },
        { count: aiNeedsFollowup },
        { count: scheduled },
        { count: scheduledToday },
        { count: scheduledThisWeek },
        { count: checkinPending },
        { count: visitsCompleted },
        { count: visitsCompletedPendingFollowup },
      ] = await Promise.all([
        // Missed Callbacks — inbound calls that weren't picked up by a
        // human agent. The candidate dialed in; no one answered.
        supabase.from("call_logs").select("id", { count: "exact", head: true })
          .eq("direction", "inbound").eq("disposition", "missed"),
        // Overdue Follow-ups (part 1) — scheduled lead_followups past due,
        // already excludes closed leads via the view.
        (supabase.from("overdue_followups" as any) as any)
          .select("id", { count: "exact", head: true }),
        // Overdue Follow-ups (part 2) — AI calls flagged needs_followup
        // that the counsellor hasn't actioned. Folded into the same card
        // since they're all "scheduled work that's overdue".
        (supabase.from("ai_call_records" as any) as any)
          .select("id", { count: "exact", head: true })
          .eq("needs_followup", true).is("followup_done_at", null),
        supabase.from("campus_visits").select("id", { count: "exact", head: true })
          .in("status", ["scheduled", "confirmed"]).gte("visit_date", nowIso),
        supabase.from("campus_visits").select("id", { count: "exact", head: true })
          .in("status", ["scheduled", "confirmed"]).gte("visit_date", todayStart).lt("visit_date", tomorrowStart),
        supabase.from("campus_visits").select("id", { count: "exact", head: true })
          .in("status", ["scheduled", "confirmed"]).gte("visit_date", nowIso).lt("visit_date", sevenDays),
        supabase.from("campus_visits").select("id", { count: "exact", head: true })
          .in("status", ["scheduled", "confirmed"]).lt("visit_date", nowIso),
        supabase.from("campus_visits").select("id", { count: "exact", head: true })
          .eq("status", "completed").gte("visit_date", fourteenDaysAgo),
        supabase.from("post_visit_pending_followups" as any).select("visit_id", { count: "exact", head: true }),
      ]);
      if (cancelled) return;
      setVisitActionCounts({
        missedCallbacks: missedCallbacks || 0,
        overdueFollowups: (overdueFollowupsView || 0) + (aiNeedsFollowup || 0),
        scheduled: scheduled || 0,
        scheduledToday: scheduledToday || 0,
        scheduledThisWeek: scheduledThisWeek || 0,
        checkinPending: checkinPending || 0,
        visitsCompleted: visitsCompleted || 0,
        visitsCompletedPendingFollowup: visitsCompletedPendingFollowup || 0,
      });

      // Visit funnel — one fetch of the lead-centric view gives both the
      // per-box counts AND the lead_id sets for click-to-filter. ~hundreds of
      // rows max, so client-side tally is cheap. Counsellor-scoped via RLS +
      // the explicit counsellor_id filter for parity with the spine funnel.
      let vfQuery = supabase.from("visit_funnel_leads" as any).select("lead_id, funnel_box, counsellor_id");
      if (role === "counsellor" && profile?.id) vfQuery = vfQuery.eq("counsellor_id", profile.id);
      const { data: vfRows, error: vfError } = await vfQuery;
      if (cancelled) return;
      // Surface query failures instead of silently rendering an empty pipeline.
      // A missing view / RLS denial here previously fell through to all-zero
      // counts, which the funnel reads as a legitimate "no visits" empty state —
      // indistinguishable from a broken backend (e.g. unapplied migration).
      if (vfError) {
        console.error("[VisitPipeline] visit_funnel_leads query failed:", vfError);
        toast({
          title: "Visit Pipeline unavailable",
          description: "Couldn't load visit funnel data. This usually means a backend/migration issue, not that there are no visits.",
          variant: "destructive",
        });
      }
      const vfCounts: Record<VisitFunnelStage, number> = {
        scheduled: 0, confirmed: 0, completed: 0, visit_followup: 0, applied: 0, admitted: 0,
      };
      const vfIds: Record<string, string[]> = {};
      let vfLeakage = 0;
      for (const r of (vfRows || []) as any[]) {
        const box = r.funnel_box as string;
        (vfIds[box] ||= []).push(r.lead_id);
        if (box === "leakage") vfLeakage++;
        else if (box in vfCounts) vfCounts[box as VisitFunnelStage]++;
      }
      setVisitFunnelCounts(vfCounts);
      setVisitFunnelLeakage(vfLeakage);
      setVisitFunnelBoxIds(vfIds);
    };
    fetchPipelineData();
    return () => { cancelled = true; };
  }, [role, profile?.id, selectedCampusId]);

  // Batch-fetch AI call summaries for the currently-loaded leads. One row
  // per lead = the most recent record with a non-null summary. Cheap join
  // keyed by lead_id; runs once per page change.
  useEffect(() => {
    if (!leads.length) { setAiSummaries({}); return; }
    let cancelled = false;
    (async () => {
      const ids = leads.map(l => l.id).filter(Boolean);
      if (ids.length === 0) return;
      const { data } = await supabase.from("ai_call_records")
        .select("lead_id, summary, started_at")
        .in("lead_id", ids)
        .not("summary", "is", null)
        .order("started_at", { ascending: false })
        .limit(ids.length * 3); // overshoot — we'll keep the most recent per lead
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const r of (data || []) as any[]) {
        if (!map[r.lead_id] && r.summary) map[r.lead_id] = r.summary;
      }
      setAiSummaries(map);
    })();
    return () => { cancelled = true; };
  }, [leads]);

  // Funnel click → translate bucket into a stageFilter (comma-separated raw
  // lead_stage values that the existing `matchesStage` filter already
  // understands via `.split(",").includes(l.stage)`).
  const handleFunnelClick = async (bucket: LeadFunnelStage | "leakage" | null) => {
    setFunnelStage(bucket);
    if (!bucket) {
      setStageFilter("all");
      setActionLeadIds(null);
      return;
    }
    setVisitAction(null);
    setVisitFunnelBox(null);
    setVisitLeadIds(null);
    setFollowupLeadIds(null);
    setInactiveIds(null);

    if (bucket === "hot") {
      // Union of canonical hot stages + interested-disposition leads.
      // Resolved via lead_ids → actionLeadIds (intersection happens via
      // the existing matchesAction filter); stageFilter stays 'all' so
      // we don't accidentally exclude anyone in the union.
      const hotStages = leadStagesForBucket("hot");
      const { data: stageLeads } = await supabase.from("leads")
        .select("id").in("stage", hotStages).eq("is_mirror", false).limit(2000);
      const union = new Set<string>([
        ...((stageLeads || []) as any[]).map((r) => r.id),
        ...interestedLeadIds,
      ]);
      setActionLeadIds(union);
      setStageFilter("all");
    } else {
      setActionLeadIds(null);
      setStageFilter(leadStagesForBucket(bucket).join(","));
    }
    setView("list");
  };

  // Visit funnel click → filter the lead list to the leads in that visit box.
  // Reuses the existing visitLeadIds filter (matchesVisit). Visit boxes map to
  // visit states, not lead stages, so we filter by the pre-fetched lead_id set
  // rather than a stageFilter.
  const handleVisitFunnelClick = (box: VisitFunnelStage | "leakage" | null) => {
    setVisitFunnelBox(box);
    if (!box) { setVisitLeadIds(null); return; }
    // Clear the spine-funnel / action filters so they don't intersect.
    setFunnelStage(null);
    setStageFilter("all");
    setActionLeadIds(null);
    setVisitAction(null);
    setFollowupLeadIds(null);
    setInactiveIds(null);
    setVisitLeadIds(new Set<string>(visitFunnelBoxIds[box] || []));
    setView("list");
  };

  // Counsellor Action Center click → load the matching lead_ids into
  // `actionLeadIds` (not `visitLeadIds`) so the legacy "Upcoming Visits" /
  // "Completed Visits" stat cards below don't auto-highlight whenever any
  // CAC action is selected.
  const handleVisitActionClick = async (a: VisitAction | null) => {
    setVisitAction(a);
    setVisitFunnelBox(null);
    if (!a) { setActionLeadIds(null); setActionBucketLabel(""); return; }
    setFunnelStage(null);
    setStageFilter("all");
    setFollowupLeadIds(null);
    setVisitLeadIds(null);
    setInactiveIds(null);

    const nowIso = new Date().toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    let ids: string[] = [];
    if (a === "missed_callbacks") {
      // Inbound calls the agent never picked up.
      const { data } = await supabase.from("call_logs")
        .select("lead_id").eq("direction", "inbound").eq("disposition", "missed").limit(500);
      ids = (data || []).map((r: any) => r.lead_id).filter(Boolean);
    } else if (a === "overdue_followups") {
      // Union of two sources: lead_followups view + AI-call records needing
      // human follow-up. Deduped via Set so a lead in both sources only
      // surfaces once in the filtered table.
      const [{ data: fu }, { data: aiFu }] = await Promise.all([
        (supabase.from("overdue_followups" as any) as any).select("lead_id").limit(500),
        (supabase.from("ai_call_records" as any) as any)
          .select("lead_id").eq("needs_followup", true).is("followup_done_at", null).limit(500),
      ]);
      const union = new Set<string>();
      for (const r of (fu || []) as any[]) if (r.lead_id) union.add(r.lead_id);
      for (const r of (aiFu || []) as any[]) if (r.lead_id) union.add(r.lead_id);
      ids = Array.from(union);
    } else if (a === "scheduled") {
      const { data } = await supabase.from("campus_visits")
        .select("lead_id").in("status", ["scheduled", "confirmed"]).gte("visit_date", nowIso).limit(500);
      ids = (data || []).map((r: any) => r.lead_id).filter(Boolean);
    } else if (a === "checkin_pending") {
      const { data } = await supabase.from("campus_visits")
        .select("lead_id").in("status", ["scheduled", "confirmed"]).lt("visit_date", nowIso).limit(500);
      ids = (data || []).map((r: any) => r.lead_id).filter(Boolean);
    } else if (a === "visits_completed") {
      const { data } = await supabase.from("campus_visits")
        .select("lead_id").eq("status", "completed").gte("visit_date", fourteenDaysAgo).limit(500);
      ids = (data || []).map((r: any) => r.lead_id).filter(Boolean);
    }
    setActionLeadIds(new Set(ids));
    setActionBucketLabel(`CAC: ${a.replace(/_/g, " ")}`);
    setView("list");
  };

  const totalLeads = leads.length;

  // Cached dashboard counts (TanStack Query). Survives navigation back to
  // /admissions without a refetch as long as data is < 30s stale.
  const statsCounsellorId = role === "counsellor" && profile?.id ? profile.id : null;
  const statsCampusId = statsCounsellorId ? null : (selectedCampusId !== "all" ? selectedCampusId : null);
  const { data: statsData } = useAdmissionsStats({ counsellorId: statsCounsellorId, campusId: statsCampusId });

  const newLeads        = statsData?.new_leads         ?? 0;
  const todayLeads      = statsData?.today_leads       ?? 0;
  const appStarted      = statsData?.app_started       ?? 0;
  const feePaid         = statsData?.fee_paid          ?? 0;
  const appSubmitted    = statsData?.app_submitted     ?? 0;
  const admitted        = statsData?.admitted          ?? 0;
  const offerSent       = statsData?.offer_sent        ?? 0;
  const tokenPaid       = statsData?.token_paid        ?? 0;
  const preAdmitted     = statsData?.pre_admitted      ?? 0;
  const pendingFollowups = statsData?.pending_followups ?? 0;
  const todayFollowups  = statsData?.today_followups   ?? 0;
  const overdueFollowups = statsData?.overdue_followups ?? 0;
  const upcomingVisits  = statsData?.upcoming_visits   ?? 0;
  const completedVisits = statsData?.completed_visits  ?? 0;
  const postVisitPendingIds = useMemo(
    () => new Set<string>(statsData?.post_visit_pending_lead_ids ?? []),
    [statsData?.post_visit_pending_lead_ids],
  );

  // Row 1: Lead data
  const leadStats = [
    { label: "New Leads", value: newLeads, sub: `+${todayLeads} today`, icon: Users, iconBg: "bg-pastel-blue", filterStage: "new_lead", link: "" },
    { label: "Pending Follow-ups", value: pendingFollowups, sub: `${overdueFollowups} overdue · ${todayFollowups} today`, icon: Clock, iconBg: "bg-pastel-orange", filterStage: "", link: "", action: "followups" },
    { label: "Upcoming Visits", value: upcomingVisits, sub: "Scheduled & confirmed", icon: MapPin, iconBg: "bg-pastel-yellow", filterStage: "", link: "", action: "upcoming_visits" },
    { label: "Completed Visits", value: completedVisits, sub: "Campus visits done", icon: CheckCircle, iconBg: "bg-pastel-green", filterStage: "", link: "", action: "completed_visits" },
  ];

  // Row 2: Application funnel
  const appStats = [
    { label: "In Progress", value: appStarted, sub: "Draft applications", icon: FileText, iconBg: "bg-pastel-blue", filterStage: "application_in_progress", action: "", link: "/applications" },
    { label: "Fee Paid", value: feePaid, sub: "Application fee received", icon: CheckCircle, iconBg: "bg-pastel-green", filterStage: "", action: "fee_paid", link: "/applications" },
    { label: "Submitted", value: appSubmitted, sub: "Fully submitted", icon: TrendingUp, iconBg: "bg-pastel-mint", filterStage: "application_submitted", action: "", link: "/applications" },
    { label: "Offer Sent", value: offerSent, sub: "Awaiting response", icon: Gift, iconBg: "bg-pastel-yellow", filterStage: "offer_sent", action: "" },
    { label: "Token Paid", value: tokenPaid, sub: "Seat confirmed", icon: CreditCard, iconBg: "bg-pastel-orange", filterStage: "token_paid", action: "" },
    { label: "Pre-Admitted", value: preAdmitted, sub: "PAN/AN pending", icon: Shield, iconBg: "bg-pastel-purple", filterStage: "pre_admitted", action: "" },
    { label: "Admitted", value: admitted, sub: "Fully admitted", icon: UserCheck, iconBg: "bg-pastel-green", filterStage: "admitted", action: "" },
  ];

  // Only show the full-page spinner on the very first load (before any
  // result has come back). Refetches keep the page mounted so controls
  // like the course multi-select popover preserve their state — an empty
  // result no longer unmounts the page just because `leads.length === 0`.
  if (!hasLoadedOnce) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (loadError && leads.length === 0) {
    return (
      <div className="flex min-h-[320px] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <XCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <h1 className="text-lg font-semibold text-foreground">Admissions CRM could not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button className="mt-5" onClick={() => fetchLeads()} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const selectedLeadNames = Array.from(selectedIds).map(id => leads.find(l => l.id === id)?.name || "").filter(Boolean);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* First-time onboarding for counsellors */}
      {role === "counsellor" && <CounsellorOnboarding />}
      {/* Productivity nudge — auto-hides if they're already using the cloud dialer */}
      {role === "counsellor" && <CloudDialerNudge />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admissions CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage leads, applications & admissions pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          {role === "counsellor" && <CounsellorScoreBadge />}
          <Button variant="pill-outline" size="pill" onClick={() => setShowBulkImport(true)} className="gap-2"><Upload className="h-4 w-4" />Import CSV</Button>
          <Button variant="pill" size="pill" onClick={() => { setResumeDraftId(undefined); setShowAddLead(true); }} className="gap-2"><Plus className="h-4 w-4" />Add Lead</Button>
        </div>
      </div>

      {/* Resumable lead drafts (autosaved from AddLeadDialog) */}
      <LeadDraftsPanel
        refreshKey={draftsRefreshKey}
        onResume={(id) => { setResumeDraftId(id); setShowAddLead(true); }}
      />

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

      {/* Pipelines zone (spine + visit) then the visit action center — all
          hidden during the action-center / counsellor focus view to keep that
          screen clean. The two funnels are grouped as "where things stand";
          the action center below is "what to do now". */}
      {view !== "action_center" && (
        <>
          <div className="space-y-2.5">
            <LeadPipeline
              stageCounts={stageCounts}
              extraHot={extraHotCount}
              activeStage={funnelStage}
              onStageClick={handleFunnelClick}
            />
            <VisitPipeline
              counts={visitFunnelCounts}
              leakageCount={visitFunnelLeakage}
              activeBox={visitFunnelBox}
              onBoxClick={handleVisitFunnelClick}
            />
          </div>
          <VisitActionCenter
            counts={visitActionCounts}
            active={visitAction}
            onClick={handleVisitActionClick}
          />
        </>
      )}

      {/* Stat cards & filter banners — hidden when Action Center is active */}
      {view !== "action_center" && <>
      {/* Compact stats: Leads + Applications in a single row.
          11 cards total — tight on lg+; wraps to 2 rows of 6 at md, and
          to 4 rows of 3 on mobile. */}
      <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-11 gap-1.5">
        {/* Lead stats */}
        {leadStats.map((stat) => {
          const isActive = (stat.filterStage && stageFilter === stat.filterStage) ||
            (stat.action === "followups" && !!followupLeadIds) ||
            ((stat.action === "upcoming_visits" || stat.action === "completed_visits") && !!visitLeadIds);
          return (
            <Card
              key={stat.label}
              className={`rounded-2xl border-border/40 shadow-none hover:shadow-sm transition-all cursor-pointer ${isActive ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
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
              <CardContent className="p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${stat.iconBg} shrink-0`}>
                    <stat.icon className="h-3.5 w-3.5 text-foreground/70" />
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground leading-tight line-clamp-2">{stat.label}</span>
                </div>
                <p className="text-lg font-bold text-foreground leading-none tracking-tight tabular-nums">{stat.value}</p>
                <p className="text-[10px] text-primary font-medium truncate mt-1">{stat.sub}</p>
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
            <CardContent className="p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`flex h-6 w-6 items-center justify-center rounded-md ${stat.iconBg} shrink-0`}>
                  <stat.icon className="h-3.5 w-3.5 text-foreground/70" />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground truncate leading-tight">{stat.label}</span>
              </div>
              <p className="text-lg font-bold text-foreground leading-none tracking-tight tabular-nums">{stat.value}</p>
              <p className="text-[10px] text-primary font-medium truncate mt-1">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Hot Leads now lives in a floating right-edge sidebar so it doesn't
          consume vertical space and surfaces a notification badge for new
          arrivals. The FAB is always on the right edge. */}
      <HotLeadsSidebar
        profileId={profile?.id}
        isSuperAdmin={isSuperAdmin}
        isTeamLeader={isTeamLeader}
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
          <select value={leadInstitutionType} onChange={(e) => setLeadInstitutionType(e.target.value as LeadInstitutionType)}
            className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
            <option value="all">School & College</option>
            <option value="school">School Leads</option>
            <option value="college">College Leads</option>
          </select>
          <Popover open={coursePopoverOpen} onOpenChange={setCoursePopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 hover:bg-muted/40"
              >
                <span>
                  {courseFilter.length === 0
                    ? leadInstitutionType === "school"
                      ? "All Grades"
                      : leadInstitutionType === "college"
                        ? "All College Courses"
                        : "All Courses"
                    : courseFilter.length === 1
                      ? (courseOptions.find(c => c.id === courseFilter[0])?.name || "1 course")
                      : leadInstitutionType === "school"
                        ? `${courseFilter.length} grades`
                        : `${courseFilter.length} courses`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
              <div className="p-2 border-b border-border/60 flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search courses..."
                  value={courseSearch}
                  onChange={(e) => setCourseSearch(e.target.value)}
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
                {courseFilter.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCourseFilter([])}
                    className="text-[10px] text-primary hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto p-1">
                {(() => {
                  const q = courseSearch.toLowerCase();
                  const filtered = q
                    ? courseOptionsForFilter.filter(c => [
                        c.name,
                        c.code,
                        c.institution_name,
                        c.campus_name,
                        c.department_name,
                      ].some(v => (v || "").toLowerCase().includes(q)))
                    : courseOptionsForFilter;
                  const sections = groupCourses(filtered);
                  if (sections.length === 0) {
                    return <div className="px-3 py-4 text-center text-xs text-muted-foreground">No courses</div>;
                  }
                  // Group sections by campus, then by institution within
                  // each campus. Some campuses host multiple institutions
                  // (e.g. Mirai Experiential School and Campus School Dept
                  // of Education on Ghaziabad Campus 2) — each gets its
                  // own sub-heading under the campus.
                  type Sec = typeof sections[number];
                  const byCampus = new Map<string, Map<string, Sec[]>>();
                  for (const s of sections) {
                    if (!byCampus.has(s.campusGroup)) byCampus.set(s.campusGroup, new Map());
                    const inst = byCampus.get(s.campusGroup)!;
                    const key = s.institutionGroup || "";
                    if (!inst.has(key)) inst.set(key, []);
                    inst.get(key)!.push(s);
                  }
                  return Array.from(byCampus.entries()).map(([campus, institutions]) => {
                    const allIds = Array.from(institutions.values()).flat().flatMap(s => s.items.map(i => i.id));
                    const allSelected = allIds.length > 0 && allIds.every(id => courseFilter.includes(id));
                    return (
                      <div key={campus} className="mb-2">
                        <div className="flex items-center justify-between px-2 pt-2 pb-1 border-b border-border/40">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{campus}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setCourseFilter(prev =>
                                allSelected
                                  ? prev.filter(id => !allIds.includes(id))
                                  : Array.from(new Set([...prev, ...allIds]))
                              );
                            }}
                            className="text-[10px] text-primary hover:underline"
                          >
                            {allSelected ? "Clear" : "Select all"}
                          </button>
                        </div>
                        {Array.from(institutions.entries()).map(([instName, secs]) => {
                          const institutionIds = secs.flatMap(s => s.items.map(i => i.id));
                          const institutionSelected = institutionIds.length > 0 && institutionIds.every(id => courseFilter.includes(id));
                          const hasSchoolCourses = secs.some(s => s.items.some(i => (i.institution_type || "").toLowerCase() === "school"));
                          return (
                            <div key={`${campus}-${instName}`} className="mb-1">
                              {instName && (
                                <div className="flex items-center justify-between px-2 pt-1.5 pb-0.5">
                                  <span className="text-[11px] font-semibold text-foreground/90">{instName}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCourseFilter(prev =>
                                        institutionSelected
                                          ? prev.filter(id => !institutionIds.includes(id))
                                          : Array.from(new Set([...prev, ...institutionIds]))
                                      );
                                    }}
                                    className="text-[10px] text-primary hover:underline"
                                  >
                                    {institutionSelected ? "Clear" : hasSchoolCourses ? "Select grades" : "Select courses"}
                                  </button>
                                </div>
                              )}
                              {secs.map(section => (
                                <div key={`${campus}-${instName}-${section.sectionKey}`} className="mb-0.5">
                                  <div className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                    {section.sectionLabel}
                                  </div>
                                  {section.items.map(c => {
                                    const checked = courseFilter.includes(c.id);
                                    return (
                                      <label
                                        key={c.id}
                                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer"
                                      >
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={(v) => {
                                            setCourseFilter(prev =>
                                              v ? Array.from(new Set([...prev, c.id])) : prev.filter(id => id !== c.id)
                                            );
                                          }}
                                        />
                                        <span className="flex-1 truncate text-foreground">{c.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            </PopoverContent>
          </Popover>
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
            {view !== "list" && filteredCount !== totalLeads && <span> (filtered from {totalLeads})</span>}
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
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/80">Lead</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/80">Course / Campus</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/80">Stage</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/80">Source · Role</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground/80">Counsellor</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-medium text-muted-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((lead) => {
                  const summary = aiSummaries[lead.id];
                  return (
                  <tr key={lead.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 cursor-pointer transition-colors align-top">
                    {(isSuperAdmin || canTransfer) && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(lead.id)}
                          onCheckedChange={() => toggleSelect(lead.id)}
                          className="h-4 w-4"
                        />
                      </td>
                    )}
                    {/* Lead — name + temperature/score + contact + optional AI summary line.
                        Summary is shown for any lead with an `ai_call_records.summary`
                        so counsellors get instant context without opening the lead page. */}
                    <td className="px-4 py-2.5 max-w-[300px]" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span className="font-medium text-foreground text-sm truncate">{lead.name}</span>
                        <LeadTemperatureBadge temperature={lead.lead_temperature} score={lead.lead_score} />
                        <span onClick={(e) => e.stopPropagation()}>
                          <CahetPendingBadge
                            leadId={lead.id}
                            leadName={lead.name}
                            phone={lead.phone}
                            courseName={lead.course_name}
                          />
                        </span>
                        {lead.ai_called && (
                          <span className="flex h-4 w-4 items-center justify-center rounded bg-violet-100 dark:bg-violet-900/30 shrink-0" title="AI Called">
                            <Bot className="h-2.5 w-2.5 text-violet-600" />
                          </span>
                        )}
                        {postVisitPendingIds.has(lead.id) && (
                          <span className="flex h-4 items-center gap-0.5 rounded bg-amber-100 dark:bg-amber-900/30 px-1 shrink-0" title="Post-visit followup pending">
                            <MapPin className="h-2.5 w-2.5 text-amber-600" />
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{lead.phone}{lead.city ? ` · ${lead.city}` : ""}</div>
                      {summary && (
                        <div
                          className="mt-1 text-[11px] italic text-foreground/70 line-clamp-2 leading-snug"
                          title={summary}
                        >
                          “{summary}”
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <div className="text-sm text-foreground truncate max-w-[180px]" title={lead.course_name || ""}>{lead.course_name || "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[180px]" title={lead.campus_name || ""}>{lead.campus_name || "—"}</div>
                    </td>
                    {/* Stage — badge + PAN/AN underneath (was its own column). */}
                    <td className="px-4 py-2.5" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <Badge className={`text-[11px] font-medium border-0 ${stageColors[lead.stage] || "bg-muted"}`}>
                        {STAGE_LABELS[lead.stage] || lead.stage}
                      </Badge>
                      {(lead.pre_admission_no || lead.admission_no) && (
                        <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                          {lead.admission_no
                            ? <span className="text-primary font-semibold">AN {lead.admission_no}</span>
                            : <span className="text-primary/80">PAN {lead.pre_admission_no}</span>}
                        </div>
                      )}
                    </td>
                    {/* Source · Role — both pills in one cell. */}
                    <td className="px-4 py-2.5" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge className={`text-[10px] font-medium border-0 ${SOURCE_BADGE_COLORS[lead.source] || "bg-muted"}`}>
                          {SOURCE_LABELS[lead.source] || lead.source}
                        </Badge>
                        <Badge className={`text-[10px] font-medium border-0 capitalize ${PERSON_ROLE_COLORS[lead.person_role] || "bg-muted"}`}>
                          {lead.person_role}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-[12px] truncate max-w-[140px]" onClick={() => navigate(`/admissions/${lead.id}`)}>
                      {lead.counsellor_name}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><Phone className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><MessageSquare className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
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

      <AddLeadDialog
        open={showAddLead}
        onOpenChange={(o) => { setShowAddLead(o); if (!o) setResumeDraftId(undefined); }}
        onSuccess={fetchLeads}
        resumeDraftId={resumeDraftId}
        onDraftChange={() => setDraftsRefreshKey(k => k + 1)}
      />
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

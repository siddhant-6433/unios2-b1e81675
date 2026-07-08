import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { MiniLifecycleStepper } from "@/components/admissions/MiniLifecycleStepper";
import { RecordPaymentDialog } from "@/components/admissions/RecordPaymentDialog";
import { OfflinePaymentDialog } from "@/components/finance/OfflinePaymentDialog";
import { NudgePaymentDialog } from "@/components/admissions/NudgePaymentDialog";
import { DateRangeFilter } from "@/components/filters/DateRangeFilter";
import { SelectField } from "@/components/ui/state-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FileText, Download, Eye, Loader2, Search, Filter, ExternalLink,
  CheckCircle, Clock, CreditCard, Upload, AlertCircle, ChevronDown, ChevronUp, ChevronRight, X,
  Sparkles, Send, Gift, Wallet, UserCheck, GraduationCap, Receipt, RefreshCw, ClipboardCheck, Trash2, MessageCircle,
  ListPlus, PauseCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  APPLICATION_FUNNEL_ORDER,
  applicationFunnelStageOf,
  isPaidBeforeOfferStage,
  type ApplicationFunnelStage,
} from "@/lib/applicationFunnel";
import {
  deleteApplication as deleteApplicationRequest,
  PAID_APPLICATION_DELETE_CONFIRMATION,
} from "@/lib/deleteApplication";
import { fetchAllApplicationRows, type ApplicationsReadClient } from "@/lib/applicationsRead";
import {
  applyApplicationDossierToRow,
  buildApplicationDossier,
  type ApplicationDossier,
} from "@/lib/applicationDossier";
import type { DatePreset } from "@/lib/datePresets";
import { compareCourses, type CourseLike } from "@/lib/courseSort";
import { exportRowsCsv, formatExportDateTime } from "@/lib/xlsxExport";
import { cahetRegistrationFromApplication, isBptOrBmritCourseName } from "@/lib/cahet";
import { isDeledCourseName, updeledRegistrationFromApplication } from "@/lib/updeled";
import {
  examCodeForApplication,
  type ExamCode,
  type ExamRegistrationStatus,
} from "@/lib/examRegistration";
import { fetchExamRegistrationsForLeads } from "@/lib/examRegistrationClient";
import { ExamRegistrationBadge } from "@/components/leads/ExamRegistrationBadge";
import { ExamRegisterDialog, type ExamRegisterTarget } from "@/components/leads/ExamRegisterDialog";
import { HoldApplicationDialog, type HoldApplicationTarget } from "@/components/admissions/HoldApplicationDialog";
import { useToast } from "@/hooks/use-toast";

type RegistrationExamKey = "cahet" | "upget" | "updeled";
type RegistrationStatusKind = "registered" | "not_registered" | "unknown";
type RegistrationStatus = {
  label: string;
  status: RegistrationStatusKind;
  registrationNo?: string | null;
};
type RegistrationStatuses = Record<RegistrationExamKey, RegistrationStatus>;
type RegistrationCourseSelection = {
  course_name?: string | null;
  name?: string | null;
};
type RegistrationEntranceExam = {
  exam_name?: string | null;
  status?: string | null;
  registration_no?: string | null;
};
type RegistrationLookupRow = {
  lead_id: string;
  registration_no: string | null;
};
type RegistrationLookupClient = {
  from(table: "cahet_registrations" | "updeled_registrations"): {
    select(columns: string): {
      in(column: "lead_id", values: string[]): Promise<{
        data: RegistrationLookupRow[] | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

interface AppRow {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  status: string;
  payment_status: string | null;
  payment_ref: string | null;
  hold_reason?: string | null;
  fee_amount: number | null;
  program_category: string | null;
  course_selections: any[];
  completed_sections: Record<string, boolean>;
  submitted_at: string | null;
  created_at: string;
  updated_at?: string | null;
  flags: string[] | null;
  dob: string | null;
  gender: string | null;
  category: string | null;
  father: any;
  mother: any;
  address: any;
  academic_details: any;
  form_pdf_url: string | null;
  fee_receipt_url: string | null;
  counsellor_name?: string;
  lead_stage?: string;
  lead_counsellor_id?: string;
  lead_pre_admission_no?: string | null;
  lead_admission_no?: string | null;
  has_offer?: boolean;
  app_fee_paid?: number;
  has_token_fee_paid?: boolean;
  doc_counts?: { total: number; verified: number; rejected: number; pending: number };
  /** Amount still due for PAN issuance (null when lead has no offer yet or already has PAN). */
  pan_due?: number | null;
  /** Amount still due for AN issuance (null when lead has no PAN yet or already has AN). */
  an_due?: number | null;
  /** Remaining balance for the full first-year fee — needed by the nudge dialog. */
  year1_due?: number | null;
  registration_statuses?: RegistrationStatuses;
  /** The single entrance exam this application's course requires, plus its
   *  live registration status. Null when the course has no exam gate. */
  exam_registration?: {
    examCode: ExamCode;
    status: ExamRegistrationStatus;
    registrationNo: string | null;
  } | null;
  dossier?: ApplicationDossier;
}

type ExistingList = { id: string; name: string; member_count: number };
type ApplicationListScope = "selected" | "filtered";

// Mutually-exclusive funnel stages. Each app is bucketed by the FURTHEST
// stage it has reached, so counts never overlap. The funnel below renders
// cumulative "reached" counts (apps at this stage OR beyond) with conversion
// % on the arrows, while clicking a box filters the table to apps currently
// STUCK at that stage — the leakage cohort to act on.
type FunnelStage = ApplicationFunnelStage;

// In NIMT's workflow the candidate ALWAYS pays the application fee before
// submitting — docs + declaration come after the payment screen. So the
// funnel order is In Progress → Paid → Submitted (= paid + declaration
// submitted) → Approved → … rather than Submitted → Paid.
const FUNNEL_ORDER: FunnelStage[] = [
  ...APPLICATION_FUNNEL_ORDER,
];

const funnelStageOf = applicationFunnelStageOf;
const RELATED_QUERY_BATCH_SIZE = 100;
const APPLICATION_TABLE_PAGE_SIZE = 100;
const OFFER_OR_PAYMENT_STAGES = new Set(["offer_sent", "token_paid", "pre_admitted"]);
const REGISTRATION_EXAM_ORDER: RegistrationExamKey[] = ["cahet", "upget", "updeled"];
const REGISTRATION_EXAM_LABELS: Record<RegistrationExamKey, string> = {
  cahet: "CAHET",
  upget: "UPGET",
  updeled: "UPDELED",
};
const UPGET_REGISTERED_STATUSES = new Set(["registered", "declared", "not_declared"]);

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const FUNNEL_META: Record<FunnelStage, {
  label: string; icon: any;
  iconBg: string; iconColor: string;
  tint: string; ring: string; bar: string;
}> = {
  in_progress:  { label: "In Progress",  icon: Clock,         iconBg: "bg-amber-100",   iconColor: "text-amber-600",   tint: "bg-amber-50/60",   ring: "ring-amber-400",   bar: "bg-amber-400" },
  submitted:    { label: "Submitted",    icon: CheckCircle,   iconBg: "bg-violet-100",  iconColor: "text-violet-600",  tint: "bg-violet-50/60",  ring: "ring-violet-400",  bar: "bg-violet-400" },
  paid:         { label: "Paid",         icon: CreditCard,    iconBg: "bg-emerald-100", iconColor: "text-emerald-600", tint: "bg-emerald-50/60", ring: "ring-emerald-400", bar: "bg-emerald-400" },
  approved:     { label: "Pending Offer", icon: ClipboardCheck,iconBg: "bg-orange-100",  iconColor: "text-orange-600",  tint: "bg-orange-50/60",  ring: "ring-orange-400",  bar: "bg-orange-400" },
  offer_sent:   { label: "Offer Sent",   icon: Gift,          iconBg: "bg-teal-100",    iconColor: "text-teal-600",    tint: "bg-teal-50/60",    ring: "ring-teal-400",    bar: "bg-teal-400" },
  token_paid:   { label: "Token Paid",   icon: Wallet,        iconBg: "bg-cyan-100",    iconColor: "text-cyan-600",    tint: "bg-cyan-50/60",    ring: "ring-cyan-400",    bar: "bg-cyan-400" },
  pre_admitted: { label: "Pre-Admitted", icon: UserCheck,     iconBg: "bg-indigo-100",  iconColor: "text-indigo-600",  tint: "bg-indigo-50/60",  ring: "ring-indigo-400",  bar: "bg-indigo-400" },
  admitted:     { label: "Admitted",     icon: GraduationCap, iconBg: "bg-green-100",   iconColor: "text-green-600",   tint: "bg-green-50/60",   ring: "ring-green-400",   bar: "bg-green-400" },
};

const conversionTone = (pct: number | null) => {
  if (pct == null) return "text-muted-foreground bg-muted/40 border-border/40";
  if (pct >= 90)   return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (pct >= 70)   return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-700",
  submitted: "bg-emerald-100 text-emerald-700",
  under_review: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const PAYMENT_BADGE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

const LEAD_STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress", application_submitted: "Submitted",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
  not_interested: "Not Interested", rejected: "Rejected",
};

const LEAD_STAGE_BADGE: Record<string, string> = {
  application_in_progress: "bg-blue-100 text-blue-700",
  application_submitted: "bg-violet-100 text-violet-700",
  visit_scheduled: "bg-purple-100 text-purple-700",
  interview: "bg-indigo-100 text-indigo-700",
  offer_sent: "bg-teal-100 text-teal-700",
  token_paid: "bg-cyan-100 text-cyan-700",
  pre_admitted: "bg-emerald-100 text-emerald-700",
  admitted: "bg-green-100 text-green-700",
};

const applicationActivityTime = (app: Pick<AppRow, "updated_at" | "submitted_at" | "created_at">) =>
  new Date(app.updated_at || app.submitted_at || app.created_at).getTime();

const canRegenerateFormPdf = (app: Pick<AppRow, "status">) =>
  app.status === "submitted" || app.status === "under_review" || app.status === "approved";

const primaryCourseName = (app: Pick<AppRow, "course_selections">) => {
  const firstNamed = (app.course_selections || []).find((course: any) =>
    String(course?.course_name || "").trim()
  );
  return String(firstNamed?.course_name || "No course").trim();
};

const primaryCourseSelection = (app: Pick<AppRow, "course_selections">) => {
  const firstNamed = (app.course_selections || []).find((course: any) =>
    String(course?.course_name || "").trim()
  );
  return {
    course: String(firstNamed?.course_name || "No course").trim(),
    campus: String(firstNamed?.campus_name || "No campus").trim(),
  };
};

const isUpgetExamName = (name: string | null | undefined) =>
  /up\s*gnm\s*entrance|upget|gnm\s*entrance/i.test(String(name || ""));

const isGnmCourseName = (courseName: string | null | undefined) => {
  const c = String(courseName || "").toLowerCase();
  return c.includes("gnm") || c.includes("general nursing");
};

const appHasCourseMatching = (
  app: Pick<AppRow, "course_selections">,
  predicate: (courseName: string | null | undefined) => boolean,
) =>
  (app.course_selections || []).some((course: RegistrationCourseSelection) =>
    predicate(course?.course_name || course?.name || "")
  );

const entranceExamsFor = (app: Pick<AppRow, "academic_details">) => {
  const academic = app.academic_details as { entrance_exams?: unknown } | null | undefined;
  const exams = academic?.entrance_exams;
  return Array.isArray(exams) ? (exams as RegistrationEntranceExam[]) : [];
};

const examRegistrationStatus = (
  app: Pick<AppRow, "academic_details">,
  matcher: (name: string | null | undefined) => boolean,
  required: boolean,
  registeredStatuses = new Set<string>(["registered"]),
): { status: RegistrationStatusKind; registrationNo: string | null } => {
  const exam = entranceExamsFor(app).find((entry) => matcher(entry?.exam_name));
  const registrationNo = String(exam?.registration_no || "").trim();
  if (registrationNo || registeredStatuses.has(String(exam?.status || ""))) {
    return { status: "registered", registrationNo: registrationNo || null };
  }
  if (exam || required) {
    return { status: "not_registered", registrationNo: null };
  }
  return { status: "unknown", registrationNo: null };
};

const buildRegistrationStatuses = (
  app: AppRow,
  registeredByLead: {
    cahet: Record<string, string | null>;
    updeled: Record<string, string | null>;
  },
): RegistrationStatuses => {
  const leadId = app.lead_id || "";
  const requiresCahet = appHasCourseMatching(app, isBptOrBmritCourseName);
  const requiresUpget = appHasCourseMatching(app, isGnmCourseName);
  const requiresUpdeled = appHasCourseMatching(app, isDeledCourseName);

  const appCahetRegistration = cahetRegistrationFromApplication(app, app.lead_id);
  const appUpdeledRegistration = updeledRegistrationFromApplication(app, app.lead_id);
  const cahetRegistrationNo = registeredByLead.cahet[leadId] || appCahetRegistration?.registration_no || null;
  const updeledRegistrationNo = registeredByLead.updeled[leadId] || appUpdeledRegistration?.registration_no || null;
  const upget = examRegistrationStatus(
    app,
    isUpgetExamName,
    requiresUpget,
    UPGET_REGISTERED_STATUSES,
  );

  return {
    cahet: {
      label: REGISTRATION_EXAM_LABELS.cahet,
      status: cahetRegistrationNo ? "registered" : requiresCahet ? "not_registered" : "unknown",
      registrationNo: cahetRegistrationNo,
    },
    upget: {
      label: REGISTRATION_EXAM_LABELS.upget,
      status: upget.status,
      registrationNo: upget.registrationNo,
    },
    updeled: {
      label: REGISTRATION_EXAM_LABELS.updeled,
      status: updeledRegistrationNo ? "registered" : requiresUpdeled ? "not_registered" : "unknown",
      registrationNo: updeledRegistrationNo,
    },
  };
};

const registrationStatusClass = (status: RegistrationStatusKind) => {
  if (status === "registered") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "not_registered") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-border bg-muted/40 text-muted-foreground";
};

const registrationStatusText = (status: RegistrationStatusKind) => {
  if (status === "registered") return "Yes";
  if (status === "not_registered") return "No";
  return "N/A";
};

const exportFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "course";

export default function Applications() {
  const { role, profile } = useAuth();
  const { toast } = useToast();
  const isCounsellor = role === "counsellor";
  const isSuperAdmin = role === "super_admin";
  const canManageApplicationLists = role === "super_admin" || role === "admission_head";
  const canViewCourseBreakup = canManageApplicationLists;
  const canExportApplications = isSuperAdmin || role === "principal";
  const [apps, setApps] = useState<AppRow[]>([]);
  const [offlinePaymentApp, setOfflinePaymentApp] = useState<AppRow | null>(null);
  const [offlineReceiptApp, setOfflineReceiptApp] = useState<AppRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "pending">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "submitted" | "on_hold">("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [counsellorFilter, setCounsellorFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortMode, setSortMode] = useState<"date" | "nudge">("date");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docsDialog, setDocsDialog] = useState<{ appId: string; applicationId: string } | null>(null);
  const [docs, setDocs] = useState<{ name: string; url: string }[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [generatingPdfFor, setGeneratingPdfFor] = useState<string | null>(null);
  const [bulkRegen, setBulkRegen] = useState<{ done: number; total: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AppRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [nudgeTarget, setNudgeTarget] = useState<AppRow | null>(null);
  const [examRegTarget, setExamRegTarget] = useState<ExamRegisterTarget | null>(null);
  const [holdTarget, setHoldTarget] = useState<HoldApplicationTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportingCourseSplit, setExportingCourseSplit] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showCourseBreakup, setShowCourseBreakup] = useState(true);
  const [showAddToList, setShowAddToList] = useState(false);
  const [listMode, setListMode] = useState<"new" | "existing">("new");
  const [listScope, setListScope] = useState<ApplicationListScope>("selected");
  const [newListName, setNewListName] = useState("");
  const [existingListId, setExistingListId] = useState("");
  const [existingLists, setExistingLists] = useState<ExistingList[]>([]);
  const [savingList, setSavingList] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const handleOfflinePaymentSuccess = async () => {
    if (!offlinePaymentApp) return;
    await supabase.from("applications" as any)
      .update({ payment_status: "paid" })
      .eq("id", offlinePaymentApp.id);
    setApps(prev => prev.map(a =>
      a.id === offlinePaymentApp.id ? { ...a, payment_status: "paid" } : a
    ));
    setOfflinePaymentApp(null);
  };

  const generateFormPdf = async (app: AppRow) => {
    setGeneratingPdfFor(app.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-application-form", {
        body: { application_id: app.application_id },
      });
      if (error) throw error;
      const url = (data as any)?.form_pdf_url;
      if (url) {
        setApps(prev => prev.map(a => a.id === app.id ? { ...a, form_pdf_url: url } : a));
        window.open(url, "_blank");
      }
    } catch (e) {
      console.error("generate-application-form failed:", e);
    } finally {
      setGeneratingPdfFor(null);
    }
  };

  const regenerateAll = async () => {
    const eligible = (a: AppRow) => a.status === "submitted" || a.status === "under_review" || a.status === "approved";
    const selectedPdfIds = new Set(selectedPdfApps.map((app) => app.id));
    const targets = selectedPdfIds.size > 0
      ? apps.filter(a => selectedPdfIds.has(a.id) && eligible(a))
      : apps.filter(eligible);
    if (!targets.length) return;
    const scope = selectedPdfIds.size > 0 ? "selected" : "all";
    if (!window.confirm(`Regenerate ${targets.length} ${scope} application form PDFs? This may take a few minutes.`)) return;
    setBulkRegen({ done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const app = targets[i];
      try {
        const { data, error } = await supabase.functions.invoke("generate-application-form", {
          body: { application_id: app.application_id },
        });
        if (error) throw error;
        const url = (data as any)?.form_pdf_url;
        if (url) {
          setApps(prev => prev.map(a => a.id === app.id ? { ...a, form_pdf_url: url } : a));
        }
      } catch (e) {
        console.error(`bulk regen failed for ${app.application_id}:`, e);
      }
      setBulkRegen({ done: i + 1, total: targets.length });
    }
    setBulkRegen(null);
  };

  const generateFeeReceipt = async (app: AppRow) => {
    setGeneratingPdfFor(app.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-application-fee-receipt", {
        body: { application_id: app.application_id },
      });
      if (error) throw error;
      const url = (data as any)?.fee_receipt_url;
      if (url) {
        setApps(prev => prev.map(a => a.id === app.id ? { ...a, fee_receipt_url: url } : a));
        window.open(url, "_blank");
      }
    } catch (e) {
      console.error("generate-application-fee-receipt failed:", e);
    } finally {
      setGeneratingPdfFor(null);
    }
  };

  useEffect(() => {
    // Counsellor scoping has to happen at the SQL layer — otherwise we pull
    // every application system-wide, then fan out lead_fee_status RPCs for
    // every other counsellor's offer-letter leads, then filter to ours.
    // Wait until profile.id is available before firing.
    if (isCounsellor && !profile?.id) return;

    const fetchApps = async () => {
      setLoading(true);

      // Counsellors get a server-scoped list via the counsellor_applications
      // RPC. The old approach — fetch every assigned lead_id, then filter with
      // .in("lead_id", […]) — built a multi-KB request URL for high-volume
      // counsellors (900+ leads) that the gateway rejected, silently blanking
      // the page. Admins still read the table directly (RLS lets them see all).
      let rows: any[] = [];
      if (isCounsellor) {
        const { data, error } = await (supabase as any).rpc("counsellor_applications");
        if (error) {
          console.error("counsellor_applications failed:", error);
          setApps([]);
          setLoading(false);
          return;
        }
        rows = data || [];
      } else {
        try {
          rows = await fetchAllApplicationRows<AppRow>(supabase as unknown as ApplicationsReadClient<AppRow>);
        } catch (error) {
          console.error("applications list fetch failed:", error);
          toast({
            title: "Could not load applications",
            description: error instanceof Error ? error.message : "Please refresh and try again.",
            variant: "destructive",
          });
          setApps([]);
          setLoading(false);
          return;
        }
      }

      // Batch-fetch counsellor names + lead stage + lifecycle data via
      // leads → profiles → offer_letters → application_doc_reviews.
      const leadIds = [...new Set(rows.map((a: any) => a.lead_id).filter(Boolean))];
      const appIdsForReview = rows.map((a: any) => a.application_id).filter(Boolean);
      const counsellorMap: Record<string, string> = {};
      const leadStageMap: Record<string, string> = {};
      const leadCounsellorIdMap: Record<string, string> = {};
      const leadPanMap: Record<string, string | null> = {};
      const leadAnMap: Record<string, string | null> = {};
      const leadOfferMap: Record<string, boolean> = {};
      const appFeePaidMap: Record<string, number> = {};
      const leadTokenFeePaidSet: Set<string> = new Set();
      const leadTokenCompleteMap: Record<string, boolean> = {};
      const appDocCountsMap: Record<string, { total: number; verified: number; rejected: number; pending: number }> = {};
      const panDueMap: Record<string, number | null> = {};
      const anDueMap: Record<string, number | null> = {};
      const year1DueMap: Record<string, number | null> = {};
      const cahetRegistrationMap: Record<string, string | null> = {};
      const updeledRegistrationMap: Record<string, string | null> = {};
      // Generalized per-lead exam registrations: lead_id → exam_code → {status, no}.
      const examRegByLead: Record<string, Partial<Record<ExamCode, { status: ExamRegistrationStatus; registration_no: string | null }>>> = {};
      const registrationClient = supabase as unknown as RegistrationLookupClient;

      const mapRows = () => rows.map((a: any) => {
        const leadId = a.lead_id || "";
        const dossier = buildApplicationDossier(a, {
          lead: {
            hasLead: !!leadId && (
              !!leadStageMap[leadId] ||
              leadId in leadCounsellorIdMap ||
              leadId in leadPanMap ||
              leadId in leadAnMap
            ),
            leadStage: leadStageMap[leadId] || "",
            counsellorId: leadCounsellorIdMap[leadId] || "",
            counsellorName: counsellorMap[leadId] || "",
            preAdmissionNo: leadPanMap[leadId] || null,
            admissionNo: leadAnMap[leadId] || null,
          },
          hasOffer: !!leadOfferMap[leadId],
          appFeePaid: appFeePaidMap[leadId] || 0,
          hasTokenFeePaid: leadTokenFeePaidSet.has(leadId) || !!leadTokenCompleteMap[leadId],
          docs: appDocCountsMap[a.application_id] || { total: 0, verified: 0, rejected: 0, pending: 0 },
          panDue: panDueMap[leadId] ?? null,
          anDue: anDueMap[leadId] ?? null,
          year1Due: year1DueMap[leadId] ?? null,
        });
        return {
          ...applyApplicationDossierToRow(a, dossier),
          registration_statuses: buildRegistrationStatuses(a, {
            cahet: cahetRegistrationMap,
            updeled: updeledRegistrationMap,
          }),
          exam_registration: (() => {
            const code = examCodeForApplication(a);
            if (!code) return null;
            const rec = examRegByLead[leadId]?.[code];
            return {
              examCode: code,
              status: (rec?.status ?? "unknown") as ExamRegistrationStatus,
              registrationNo: rec?.registration_no || null,
            };
          })(),
        };
      });

      // Render the base application rows before secondary dashboard enrichment.
      // Lifecycle badges and dues can update afterward; the initial dashboard
      // should not stay blank while every related lookup finishes.
      setApps(mapRows());
      setLoading(false);

      if (leadIds.length > 0) {
        const leadBatches = chunkArray(leadIds, RELATED_QUERY_BATCH_SIZE);

        await Promise.all(leadBatches.map(async (batch) => {
          // Offer-letter existence — one row per lead is enough to flag.
          // Keep this batched; admins can have 700+ applications, and a single
          // huge `.in(...)` URL silently starves downstream token/PAN status.
          const [offersResult, paymentsResult, cahetResult, updeledResult, examRegResult] = await Promise.all([
            supabase.from("offer_letters")
              .select("lead_id")
              .in("lead_id", batch),
            supabase.from("lead_payments")
              .select("lead_id, amount, type")
              .in("lead_id", batch)
              .in("type", ["application_fee", "token_fee"])
              .eq("status", "confirmed"),
            registrationClient.from("cahet_registrations")
              .select("lead_id, registration_no")
              .in("lead_id", batch),
            registrationClient.from("updeled_registrations")
              .select("lead_id, registration_no")
              .in("lead_id", batch),
            (supabase.from("exam_registrations" as any) as any)
              .select("lead_id, exam_code, status, registration_no")
              .in("lead_id", batch),
          ]);

          if (examRegResult.error) {
            console.error("exam_registrations batch failed:", examRegResult.error);
          }
          (examRegResult.data || []).forEach((r: { lead_id: string; exam_code: ExamCode; status: ExamRegistrationStatus; registration_no: string | null }) => {
            (examRegByLead[r.lead_id] ||= {})[r.exam_code] = {
              status: r.status,
              registration_no: r.registration_no || null,
            };
          });

          if (offersResult.error) {
            console.error("offer_letters batch failed:", offersResult.error);
          }
          (offersResult.data || []).forEach((o: { lead_id: string }) => { leadOfferMap[o.lead_id] = true; });

          if (cahetResult.error) {
            console.error("cahet_registrations batch failed:", cahetResult.error);
          }
          (cahetResult.data || []).forEach((r: { lead_id: string; registration_no: string | null }) => {
            cahetRegistrationMap[r.lead_id] = r.registration_no || null;
          });

          if (updeledResult.error) {
            console.error("updeled_registrations batch failed:", updeledResult.error);
          }
          (updeledResult.data || []).forEach((r: { lead_id: string; registration_no: string | null }) => {
            updeledRegistrationMap[r.lead_id] = r.registration_no || null;
          });

          // Confirmed application_fee + token_fee payments — track per lead.
          // `leadTokenFeePaidSet` is a cheap early flag for explicit token_fee
          // receipts. Course-fee lump-sum payments are recorded as `other`, so
          // the authoritative token-complete flag comes from lead_fee_status
          // below once the offer/threshold is known.
          if (paymentsResult.error) {
            console.error("lead_payments batch failed:", paymentsResult.error);
          }
          (paymentsResult.data || []).forEach((p: { lead_id: string; amount: number | string | null; type: string }) => {
            if (p.type === "application_fee") {
              appFeePaidMap[p.lead_id] = (appFeePaidMap[p.lead_id] || 0) + Number(p.amount || 0);
            } else if (p.type === "token_fee") {
              leadTokenFeePaidSet.add(p.lead_id);
            }
          });
        }));

        const leadResults = await Promise.all(leadBatches.map(async (batch) => {
          const { data, error } = await supabase.from("leads")
            .select("id, counsellor_id, stage, pre_admission_no, admission_no")
            .in("id", batch);
          if (error) {
            console.error("leads batch failed:", error);
          }
          return data || [];
        }));

        const leads = leadResults.flat() as {
          id: string;
          counsellor_id: string | null;
          stage: string;
          pre_admission_no: string | null;
          admission_no: string | null;
        }[];
        leads.forEach((l) => {
          leadStageMap[l.id] = l.stage;
          leadCounsellorIdMap[l.id] = l.counsellor_id;
          leadPanMap[l.id] = l.pre_admission_no;
          leadAnMap[l.id] = l.admission_no;
        });

        const counsellorIds = [...new Set(leads.map((l) => l.counsellor_id).filter(Boolean))] as string[];
        if (counsellorIds.length > 0) {
          const profileResults = await Promise.all(chunkArray(counsellorIds, RELATED_QUERY_BATCH_SIZE).map(async (batch) => {
            const { data, error } = await supabase.from("profiles")
              .select("id, display_name")
              .in("id", batch);
            if (error) {
              console.error("profiles batch failed:", error);
            }
            return data || [];
          }));
          const profileMap: Record<string, string> = {};
          profileResults.flat().forEach((p: any) => { profileMap[p.id] = p.display_name || ""; });
          leads.forEach((l) => {
            if (l.counsellor_id && profileMap[l.counsellor_id]) {
              counsellorMap[l.id] = profileMap[l.counsellor_id];
            }
          });
        }
      }

      // Document review counts per application — used by the mini lifecycle
      // stepper. Keep this batched for the same reason as lead-side lookups.
      if (appIdsForReview.length > 0) {
        await Promise.all(chunkArray(appIdsForReview, RELATED_QUERY_BATCH_SIZE).map(async (batch) => {
          const { data: reviews, error: reviewsError } = await supabase.from("application_doc_reviews" as any)
            .select("application_id, status")
            .in("application_id", batch);
          if (reviewsError) {
            console.error("application_doc_reviews batch failed:", reviewsError);
          }
          (reviews || []).forEach((r: { application_id: string; status: string }) => {
            if (!appDocCountsMap[r.application_id]) {
              appDocCountsMap[r.application_id] = { total: 0, verified: 0, rejected: 0, pending: 0 };
            }
            const c = appDocCountsMap[r.application_id];
            c.total++;
            if (r.status === "verified") c.verified++;
            else if (r.status === "rejected") c.rejected++;
            else c.pending++;
          });
        }));
      }

      // Pull PAN/AN amounts due from the server-side `lead_fee_status` RPC
      // — same source of truth the candidate's portal uses (TokenFeePanel).
      // Only fetch for leads who can still progress toward PAN or AN:
      // they have an offer letter or are already in the offer/payment lifecycle,
      // AND don't already have admission_no. The lead-stage fallback matters
      // when legacy/stale rows have stage='offer_sent' but no preloaded offer row.
      const feeStatusLeadIds = leadIds.filter((lid: string) =>
        !leadAnMap[lid] && (
          leadOfferMap[lid] ||
          OFFER_OR_PAYMENT_STAGES.has(leadStageMap[lid]) ||
          !!leadPanMap[lid]
        )
      );

      setApps(mapRows());

      if (feeStatusLeadIds.length === 0) return;

      const enrichFeeStatus = async () => {
        const workerCount = Math.min(8, feeStatusLeadIds.length);
        let nextIndex = 0;

        const worker = async () => {
          while (nextIndex < feeStatusLeadIds.length) {
            const lid = feeStatusLeadIds[nextIndex];
            nextIndex += 1;

            try {
              const { data: fs } = await (supabase as any).rpc("lead_fee_status", { _lead_id: lid });
              if (!fs) continue;
              const tokenReq = Number(fs.token_required || 0);
              const anThr = Number(fs.an_threshold || 0);
              const postSchY1 = Number(fs.post_scholarship_year_1 || fs.first_year_fee || 0);
              // `paid_toward_course` is the authoritative course-applied
              // amount. It excludes separate app/reg payments unless the fee
              // structure explicitly credits application fee to a seat-block
              // line. `total_paid` would wrongly shrink displayed dues.
              const paidTowardCourse = Number(
                fs.paid_toward_course ?? Math.max(
                  0,
                  Number(fs.total_paid || 0) -
                    Number(fs.application_paid || 0) -
                    Number(fs.registration_paid || 0)
                )
              );
              const hasPan = !!leadPanMap[lid];
              leadTokenCompleteMap[lid] = !!fs.token_complete;
              panDueMap[lid] = hasPan ? null : Math.max(0, tokenReq - paidTowardCourse);
              anDueMap[lid] = Math.max(0, anThr - paidTowardCourse);
              year1DueMap[lid] = Math.max(0, postSchY1 - paidTowardCourse);
            } catch (error) {
              console.warn("[Applications] lead fee status enrichment skipped", { leadId: lid, error });
            }
          }
        };

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        setApps(mapRows());
      };

      void enrichFeeStatus();
    };
    fetchApps();
  }, [profile?.id, isCounsellor, toast, refreshKey]);

  const completedCount = (cs: Record<string, boolean>) => Object.values(cs || {}).filter(Boolean).length;
  const totalCount = (cs: Record<string, boolean>) => Object.keys(cs || {}).length;
  const completionPct = (cs: Record<string, boolean>) => { const t = totalCount(cs); return t > 0 ? completedCount(cs) / t : 0; };

  const courseOptions = useMemo(() => {
    const courses = new Set<string>();
    let hasNoCourse = false;
    apps.forEach((app) => {
      if (primaryCourseName(app) === "No course") hasNoCourse = true;
      (app.course_selections || []).forEach((course: any) => {
        const name = String(course?.course_name || "").trim();
        if (name) courses.add(name);
      });
    });
    const sorted = Array.from(courses).sort((a, b) => a.localeCompare(b));
    return hasNoCourse ? ["No course", ...sorted] : sorted;
  }, [apps]);

  const counsellorOptions = useMemo(() => {
    const counsellors = new Map<string, string>();
    let hasUnassigned = false;
    apps.forEach((app) => {
      if (app.lead_counsellor_id) {
        counsellors.set(
          app.lead_counsellor_id,
          app.counsellor_name || "Assigned counsellor",
        );
      } else {
        hasUnassigned = true;
      }
    });
    const options = Array.from(counsellors, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return hasUnassigned
      ? [{ id: "__unassigned", name: "Unassigned" }, ...options]
      : options;
  }, [apps]);

  const matchesCourseFilter = useCallback((app: AppRow) =>
    courseFilter === "all" ||
    (courseFilter === "No course" && primaryCourseName(app) === "No course") ||
    app.course_selections?.some((course: any) => course?.course_name === courseFilter),
    [courseFilter],
  );

  const matchesCounsellorFilter = useCallback((app: AppRow) => {
    if (isCounsellor || counsellorFilter === "all") return true;
    if (counsellorFilter === "__unassigned") return !app.lead_counsellor_id;
    return app.lead_counsellor_id === counsellorFilter;
  }, [counsellorFilter, isCounsellor]);

  const dashboardApps = useMemo(
    () => apps.filter((app) => matchesCourseFilter(app) && matchesCounsellorFilter(app)),
    [apps, matchesCourseFilter, matchesCounsellorFilter],
  );

  const filtered = useMemo(() => apps.filter(a => {
    if (!matchesCourseFilter(a)) return false;
    if (!matchesCounsellorFilter(a)) return false;
    if (paymentFilter !== "all" && a.payment_status !== paymentFilter) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    // The "token_paid" tile filters on the lead_payments-derived flag so it
    // includes everyone who paid token fee, not just those currently AT the
    // token_paid stage. Other stage tiles still match on the lead's stage.
    if (stageFilter === "paid_no_offer") {
      if (!isPaidBeforeOfferStage(a)) return false;
    } else if (stageFilter && (FUNNEL_ORDER as string[]).includes(stageFilter)) {
      // Funnel filter → show only apps currently STUCK at that stage
      // (the leakage cohort — didn't progress beyond).
      if (funnelStageOf(a) !== stageFilter) return false;
    } else if (stageFilter && a.lead_stage !== stageFilter) {
      // Legacy stage-key passthrough (kept for any external callers).
      return false;
    }
    if (fromDate || toDate) {
      const t = new Date(a.created_at).getTime();
      if (fromDate && t < new Date(`${fromDate}T00:00:00`).getTime()) return false;
      if (toDate && t > new Date(`${toDate}T23:59:59.999`).getTime()) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.full_name?.toLowerCase().includes(q) ||
      a.phone?.includes(q) ||
      a.application_id?.toLowerCase().includes(q) ||
      a.course_selections?.some((c: any) => c.course_name?.toLowerCase().includes(q))
    );
  }).sort((a, b) => {
    if (sortMode === "nudge") {
      const aPaid = a.payment_status === "paid" ? 1 : 0;
      const bPaid = b.payment_status === "paid" ? 1 : 0;
      if (bPaid !== aPaid) return bPaid - aPaid;
      const completionDelta = completionPct(b.completed_sections) - completionPct(a.completed_sections);
      return completionDelta || applicationActivityTime(b) - applicationActivityTime(a);
    }

    // "In Progress" filter: paid first → then most sections completed first
    if (statusFilter === "draft") {
      const aPaid = a.payment_status === "paid" ? 1 : 0;
      const bPaid = b.payment_status === "paid" ? 1 : 0;
      if (bPaid !== aPaid) return bPaid - aPaid;
      const completionDelta = completionPct(b.completed_sections) - completionPct(a.completed_sections);
      return completionDelta || applicationActivityTime(b) - applicationActivityTime(a);
    }

    // "Paid" filter: most sections completed first (closest to submission)
    if (paymentFilter === "paid") {
      const completionDelta = completionPct(b.completed_sections) - completionPct(a.completed_sections);
      return completionDelta || applicationActivityTime(b) - applicationActivityTime(a);
    }

    // "Submitted" filter: most recent submission first
    if (statusFilter === "submitted") {
      const aDate = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const bDate = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return (bDate - aDate) || applicationActivityTime(b) - applicationActivityTime(a);
    }

    // Default: most recently active applications first.
    return applicationActivityTime(b) - applicationActivityTime(a);
  }), [apps, fromDate, matchesCourseFilter, matchesCounsellorFilter, paymentFilter, search, sortMode, stageFilter, statusFilter, toDate]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / APPLICATION_TABLE_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = (safeCurrentPage - 1) * APPLICATION_TABLE_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + APPLICATION_TABLE_PAGE_SIZE, filtered.length);
  const visibleApps = filtered.slice(pageStart, pageEnd);
  const selectedListApps = useMemo(
    () => apps.filter((app) => selectedIds.has(app.id) && !!app.lead_id),
    [apps, selectedIds],
  );
  const selectedPdfApps = useMemo(
    () => apps.filter((app) => selectedIds.has(app.id) && canRegenerateFormPdf(app)),
    [apps, selectedIds],
  );
  const filteredListApps = useMemo(
    () => filtered.filter((app) => !!app.lead_id),
    [filtered],
  );
  const selectableApps = useMemo(
    () => canManageApplicationLists ? filteredListApps : filtered.filter(canRegenerateFormPdf),
    [canManageApplicationLists, filtered, filteredListApps],
  );
  const allSelectableAppsSelected = selectableApps.length > 0 &&
    selectableApps.every((app) => selectedIds.has(app.id));

  const courseExportApps = useMemo(
    () => apps.filter((app) => matchesCourseFilter(app) && matchesCounsellorFilter(app)),
    [apps, matchesCourseFilter, matchesCounsellorFilter],
  );

  const courseStatusRows = useMemo(() => {
    const courseMap = new Map<string, {
      campus: string;
      course: string;
      stageCounts: Record<FunnelStage, number>;
      stageApps: Record<FunnelStage, AppRow[]>;
      totalBeyondInProgress: number;
    }>();

    for (const app of dashboardApps) {
      const { campus, course } = primaryCourseSelection(app);
      const key = `${campus}::${course}`;
      const existing = courseMap.get(key) || {
        campus,
        course,
        stageCounts: {
          in_progress: 0, submitted: 0, paid: 0, approved: 0,
          offer_sent: 0, token_paid: 0, pre_admitted: 0, admitted: 0,
        },
        stageApps: {
          in_progress: [], submitted: [], paid: [], approved: [],
          offer_sent: [], token_paid: [], pre_admitted: [], admitted: [],
        },
        totalBeyondInProgress: 0,
      };
      const stage = funnelStageOf(app);
      existing.stageCounts[stage]++;
      existing.stageApps[stage].push(app);
      if (stage !== "in_progress") existing.totalBeyondInProgress++;
      courseMap.set(key, existing);
    }

    return Array.from(courseMap.values()).sort((a, b) => {
      if (a.campus !== b.campus) return a.campus.localeCompare(b.campus);
      const courseOrder = compareCourses(
        { id: `${a.campus}-${a.course}`, name: a.course, campus_name: a.campus } satisfies CourseLike,
        { id: `${b.campus}-${b.course}`, name: b.course, campus_name: b.campus } satisfies CourseLike,
      );
      return courseOrder ||
        b.totalBeyondInProgress - a.totalBeyondInProgress ||
        b.stageCounts.in_progress - a.stageCounts.in_progress;
    });
  }, [dashboardApps]);

  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [courseFilter, counsellorFilter, fromDate, paymentFilter, search, sortMode, stageFilter, statusFilter, toDate]);

  const selectApplicationCohort = (rows: AppRow[], label: string) => {
    if (!canManageApplicationLists) return;
    const ids = rows.filter((app) => !!app.lead_id).map((app) => app.id);
    setSelectedIds(new Set(ids));
    toast({
      title: "Applications selected",
      description: ids.length > 0
        ? `${ids.length} lead-linked application${ids.length === 1 ? "" : "s"} selected from ${label}.`
        : `No lead-linked applications found in ${label}.`,
    });
  };

  const resetListDialog = () => {
    setNewListName("");
    setExistingListId("");
    setListMode("new");
    setListScope("selected");
  };

  const openAddToListDialog = async (scope: ApplicationListScope) => {
    if (!canManageApplicationLists) return;
    setListScope(scope);
    setShowAddToList(true);

    const { data, error } = await supabase
      .from("lead_lists" as any)
      .select("id, name, member_count")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Lists could not load", description: error.message, variant: "destructive" });
      return;
    }

    setExistingLists(((data || []) as any[]).map((list) => ({
      id: list.id,
      name: list.name,
      member_count: list.member_count || 0,
    })));
  };

  const listRowsForScope = () => listScope === "filtered" ? filteredListApps : selectedListApps;

  const currentFilterSnapshot = () => ({
    source: "applications_dashboard",
    courseFilter,
    counsellorFilter,
    paymentFilter,
    statusFilter,
    stageFilter,
    fromDate: fromDate || null,
    toDate: toDate || null,
    search: search || null,
    sortMode,
  });

  const handleAddApplicationsToList = async () => {
    if (!canManageApplicationLists) return;
    const rows = listRowsForScope();
    const leadIds = Array.from(new Set(rows.map((app) => app.lead_id).filter(Boolean))) as string[];

    if (!leadIds.length) {
      toast({
        title: "No applications to add",
        description: listScope === "filtered"
          ? "The current filters do not match any applications with linked leads."
          : "Select at least one application with a linked lead first.",
        variant: "destructive",
      });
      return;
    }

    let listId = existingListId;
    let listName = existingLists.find((list) => list.id === existingListId)?.name || "";
    setSavingList(true);

    if (listMode === "new") {
      const name = newListName.trim();
      if (!name) {
        toast({ title: "Name required", description: "Give the list a name first.", variant: "destructive" });
        setSavingList(false);
        return;
      }

      const { data: list, error: listErr } = await supabase
        .from("lead_lists" as any)
        .insert({
          name,
          source: listScope === "filtered" ? "filter" : "manual",
          filters_snapshot: listScope === "filtered" ? currentFilterSnapshot() : { source: "applications_dashboard_selection" },
          description: `Saved from Applications — ${leadIds.length} ${listScope === "filtered" ? "filtered" : "selected"} applications`,
          created_by: profile?.id || null,
        })
        .select("id, name")
        .single();

      if (listErr || !list) {
        toast({ title: "Could not create list", description: listErr?.message || "Unknown error", variant: "destructive" });
        setSavingList(false);
        return;
      }

      listId = (list as any).id;
      listName = (list as any).name;
    } else if (!listId) {
      toast({ title: "Choose a list", description: "Select an existing list first.", variant: "destructive" });
      setSavingList(false);
      return;
    }

    const members = leadIds.map((lead_id) => ({ list_id: listId, lead_id }));
    let memberErrors = 0;
    for (let i = 0; i < members.length; i += 500) {
      const chunk = members.slice(i, i + 500);
      const { error: memberErr } = await supabase
        .from("lead_list_members" as any)
        .upsert(chunk, { onConflict: "list_id,lead_id", ignoreDuplicates: true } as any);
      if (memberErr) {
        memberErrors++;
        console.error("Application list member insert failed:", memberErr);
      }
    }

    setSavingList(false);
    if (memberErrors > 0) {
      toast({
        title: "List partially updated",
        description: `"${listName}" was saved, but some applications could not be added. Check console.`,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: listMode === "new" ? "List created" : "List updated",
      description: `"${listName}" — ${leadIds.length} application lead${leadIds.length === 1 ? "" : "s"} added. Use Lists for bulk WhatsApp or email.`,
    });
    setShowAddToList(false);
    resetListDialog();
    if (listScope === "selected") setSelectedIds(new Set());
  };

  const fetchDocs = async (appId: string, applicationId: string) => {
    setDocsDialog({ appId, applicationId });
    setDocsLoading(true);
    setDocs([]);

    try {
      const { data, error } = await supabase.functions.invoke("list-app-docs", {
        body: { application_id: applicationId },
      });
      if (error) throw error;
      const list = ((data as any)?.docs || []) as { name: string; url: string }[];
      setDocs(list);
    } catch (e) {
      console.error("list-app-docs failed:", e);
      setDocs([]);
    }
    setDocsLoading(false);
  };

  // ── Funnel bucketing ─────────────────────────────────────────────────────
  // Bucket every app into exactly one stage (the furthest reached) so counts
  // never overlap. Then derive cumulative "reached" counts for the funnel
  // display: reached[s] = apps that landed at s OR any later stage.
  const stageBucket: Record<FunnelStage, number> = {
    in_progress: 0, submitted: 0, paid: 0, approved: 0,
    offer_sent: 0, token_paid: 0, pre_admitted: 0, admitted: 0,
  };
  for (const a of dashboardApps) stageBucket[funnelStageOf(a)]++;

  const stageReached: Record<FunnelStage, number> = {} as any;
  {
    let cum = dashboardApps.length;
    for (const s of FUNNEL_ORDER) {
      stageReached[s] = cum;
      cum -= stageBucket[s];
    }
  }
  const totalApps = dashboardApps.length;
  const paidNoOffer = dashboardApps.filter(isPaidBeforeOfferStage).length;

  const handleDelete = async () => {
    if (!deleteTarget || !isSuperAdmin) return;
    const paidDeleteConfirmation = deleteTarget.payment_status === "paid"
      ? deleteConfirmText.trim().toUpperCase()
      : undefined;
    setDeleting(true);
    const { data, error } = await deleteApplicationRequest({
      id: deleteTarget.id,
      applicationId: deleteTarget.application_id,
      paymentStatus: deleteTarget.payment_status,
      paidDeleteConfirmation,
    });
    setDeleting(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setApps(prev => prev.filter(a => a.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleteConfirmText("");
    toast({
      title: "Application deleted",
      description: data
        ? `${data.application_id} deleted with ${data.deleted_storage_files} storage files cleaned up.`
        : undefined,
    });
  };

  const handleBulkDelete = async () => {
    if (!isSuperAdmin) return;
    const targetIds = new Set(selectedIds);
    const targets = apps.filter(a => targetIds.has(a.id));
    if (!targets.length) return;
    setBulkDeleting(true);
    let deleted = 0;
    let failed = 0;
    let skippedPaid = 0;
    for (const app of targets) {
      if (app.payment_status === "paid") {
        skippedPaid++;
        continue;
      }
      const { error } = await deleteApplicationRequest({
        id: app.id,
        applicationId: app.application_id,
        paymentStatus: app.payment_status,
      });
      if (error) {
        failed++;
        console.error("Bulk delete failed:", app.application_id, error);
      } else {
        deleted++;
      }
    }
    setBulkDeleting(false);
    setBulkDeleteConfirmOpen(false);
    setSelectedIds(new Set());
    setApps(prev => prev.filter(a => !targetIds.has(a.id) || a.payment_status === "paid"));
    const parts: string[] = [];
    if (deleted > 0) parts.push(`${deleted} deleted`);
    if (skippedPaid > 0) parts.push(`${skippedPaid} paid skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    toast({
      title: "Bulk delete complete",
      description: parts.join(" · ") || "Nothing to delete.",
      variant: failed > 0 ? "destructive" : undefined,
    });
  };

  const handleExportApplications = async () => {
    setExporting(true);
    try {
      const { count } = exportRowsCsv(
        filtered.map((app) => {
          const courses = (app.course_selections || []).map((c: any) => c.course_name).filter(Boolean);
          const campuses = (app.course_selections || []).map((c: any) => c.campus_name).filter(Boolean);
          const completed = completedCount(app.completed_sections);
          const total = totalCount(app.completed_sections);
          return {
            "Application ID": app.application_id,
            "Applicant Name": app.full_name || "",
            Phone: app.phone || "",
            Email: app.email || "",
            Courses: courses.join(", "),
            Campuses: Array.from(new Set(campuses)).join(", "),
            "Application Status": app.status || "",
            "Payment Status": app.payment_status || "pending",
            "Payment Ref": app.payment_ref || "",
            "Fee Amount": app.fee_amount ?? "",
            "Completion %": total > 0 ? Math.round((completed / total) * 100) : 0,
            "Sections Completed": `${completed}/${total}`,
            "Lead Stage": app.lead_stage || "",
            Counsellor: app.counsellor_name || "",
            PAN: app.lead_pre_admission_no || "",
            AN: app.lead_admission_no || "",
            Gender: app.gender || "",
            DOB: app.dob || "",
            Category: app.category || "",
            City: app.address?.city || "",
            State: app.address?.state || "",
            "Submitted At": formatExportDateTime(app.submitted_at),
            "Created At": formatExportDateTime(app.created_at),
          };
        }),
        "applications-export",
      );
      toast({
        title: count > 0 ? "Applications exported" : "No applications to export",
        description: count > 0 ? `${count} filtered application${count === 1 ? "" : "s"} exported.` : undefined,
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to export applications.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const applicationCourseExportRow = (app: AppRow) => {
    const { course, campus } = primaryCourseSelection(app);
    const currentStatus = FUNNEL_META[funnelStageOf(app)].label;
    const registrationStatuses = app.registration_statuses || buildRegistrationStatuses(app, {
      cahet: {},
      updeled: {},
    });
    return {
      "Applicant Name": app.full_name || "",
      "Mobile No": app.phone || "",
      "Email ID": app.email || "",
      "Application ID": app.application_id,
      "Current Status": currentStatus,
      "Application Status": app.status || "",
      "Payment Status": app.payment_status || "pending",
      "Lead Stage": app.lead_stage ? (LEAD_STAGE_LABELS[app.lead_stage] || app.lead_stage) : "",
      Course: course === "No course" ? "" : course,
      Campus: campus === "No campus" ? "" : campus,
      "UPGET Registration Status": registrationStatusText(registrationStatuses.upget.status),
      "UPGET Registration No": registrationStatuses.upget.registrationNo || "",
      "CAHET Registration Status": registrationStatusText(registrationStatuses.cahet.status),
      "CAHET Registration No": registrationStatuses.cahet.registrationNo || "",
      "UPDELED Registration Status": registrationStatusText(registrationStatuses.updeled.status),
      "UPDELED Registration No": registrationStatuses.updeled.registrationNo || "",
      PAN: app.lead_pre_admission_no || "",
      AN: app.lead_admission_no || "",
      Counsellor: app.counsellor_name || "",
      "Submitted At": formatExportDateTime(app.submitted_at),
      "Created At": formatExportDateTime(app.created_at),
    };
  };

  const handleExportCourseSplitCsv = async () => {
    if (courseFilter === "all") {
      toast({
        title: "Choose a course first",
        description: "Select a course filter before downloading the split course CSVs.",
        variant: "destructive",
      });
      return;
    }

    setExportingCourseSplit(true);
    try {
      const inProgressRows = courseExportApps.filter((app) => funnelStageOf(app) === "in_progress");
      const paidAndOtherRows = courseExportApps.filter((app) => funnelStageOf(app) !== "in_progress");
      const slug = exportFileSlug(courseFilter);
      const inProgress = exportRowsCsv(
        inProgressRows.map((app) => applicationCourseExportRow(app)),
        `applications-${slug}-in-progress`,
      );
      const paidAndOther = exportRowsCsv(
        paidAndOtherRows.map((app) => applicationCourseExportRow(app)),
        `applications-${slug}-paid-and-other-states`,
      );
      const total = inProgress.count + paidAndOther.count;

      toast({
        title: total > 0 ? "Course CSVs exported" : "No applications to export",
        description: total > 0
          ? `${inProgress.count} in-progress and ${paidAndOther.count} paid/other application${paidAndOther.count === 1 ? "" : "s"} exported for ${courseFilter}.`
          : `No applications found for ${courseFilter}.`,
      });
    } catch (error) {
      toast({
        title: "Course export failed",
        description: error instanceof Error ? error.message : "Unable to export course applications.",
        variant: "destructive",
      });
    } finally {
      setExportingCourseSplit(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isCounsellor ? "My Applications" : "Applications"}</h1>
          <p className="text-sm text-muted-foreground mt-1">{isCounsellor ? "Applications for your assigned leads" : "All online applications with payment and document status"}</p>
        </div>
        <div className="flex items-center gap-2">
          {canExportApplications && (
            <button
              onClick={handleExportApplications}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
              title="Export applications matching the current filters"
            >
              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Download CSV
            </button>
          )}
          {!isCounsellor && (
            <button onClick={regenerateAll} disabled={!!bulkRegen}
              className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50">
              {bulkRegen ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {bulkRegen
                ? `Regenerating ${bulkRegen.done}/${bulkRegen.total}`
                : selectedPdfApps.length > 0
                  ? `Regenerate Selected (${selectedPdfApps.length})`
                  : "Regenerate All PDFs"}
            </button>
          )}
          <button onClick={() => setSortMode(sortMode === "nudge" ? "date" : "nudge")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              sortMode === "nudge" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-input bg-background text-muted-foreground hover:bg-muted/50"
            }`}>
            <Sparkles className="h-3 w-3" />{sortMode === "nudge" ? "Nudge View" : "Sort: Activity"}
          </button>
        </div>
      </div>

      {/* Application Pipeline Funnel ────────────────────────────────────────
          Mutually-exclusive stages — each app is bucketed by the furthest
          stage it has reached. The big number in each box is the STUCK-here
          count (apps currently at that stage and not progressed beyond) so
          the click filter and the displayed number always match. Funnel
          NARROWING comes from box width = proportional to cumulative reach,
          and "X reached" caption shows that cumulative count for context.
          Conversion % between stages uses cumulative reach (proper funnel
          math), colored ≥90 green, ≥70 amber, <70 rose. */}
      <Card className="rounded-2xl border-border/40 shadow-none">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">Application Pipeline</h2>
              <span className="text-xs text-muted-foreground">{totalApps} total · big number = currently at stage · click to see who's stuck</span>
            </div>
            <div className="flex items-center gap-2">
              {paidNoOffer > 0 && (
                <button
                  onClick={() => {
                    const isActive = stageFilter === "paid_no_offer";
                    setStageFilter(isActive ? null : "paid_no_offer");
                    setPaymentFilter("all");
                    setStatusFilter("all");
                    if (!isActive) {
                      selectApplicationCohort(dashboardApps.filter(isPaidBeforeOfferStage), "paid applications without offer");
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                    stageFilter === "paid_no_offer"
                      ? "border-rose-400 bg-rose-100 text-rose-800 ring-2 ring-rose-300"
                      : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 animate-pulse"
                  }`}
                  title="Paid candidates with no offer letter yet — counsellor action needed"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  {paidNoOffer} paid · offer not issued
                </button>
              )}
            </div>
          </div>

          {/* `overflow-x-auto` also clips Y in CSS, so the ring-2 on the active
              box would get cropped at the top/bottom without vertical padding.
              `py-1.5 -my-1.5` keeps layout space identical while giving the
              ring room to render. */}
          <div className="flex items-stretch gap-1.5 overflow-x-auto py-1.5 -my-1.5 px-1 -mx-1">
            {FUNNEL_ORDER.map((stage, i) => {
              const meta = FUNNEL_META[stage];
              const Icon = meta.icon;
              const reached = stageReached[stage];
              const stuck = stageBucket[stage];
              const prevReached = i > 0 ? stageReached[FUNNEL_ORDER[i - 1]] : null;
              const conversion = prevReached != null && prevReached > 0
                ? Math.round((reached / prevReached) * 100)
                : null;
              const isActive = stageFilter === stage;
              // Proportional width gives the true funnel-narrowing shape;
              // floor at min-width so single-digit stages stay legible.
              const widthBasis = totalApps > 0
                ? Math.max(124, (reached / totalApps) * 220)
                : 124;
              const reachPct = totalApps > 0 ? (reached / totalApps) * 100 : 0;

              return (
                <Fragment key={stage}>
                  {i > 0 && (
                    <div className="flex flex-col items-center justify-center shrink-0 self-center">
                      <div className={`text-[10px] font-semibold rounded-md border px-1.5 py-0.5 leading-tight ${conversionTone(conversion)}`}>
                        {conversion != null ? `${conversion}%` : "—"}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5" />
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setStageFilter(isActive ? null : stage);
                      setPaymentFilter("all");
                      setStatusFilter("all");
                      if (!isActive) {
                        selectApplicationCohort(dashboardApps.filter((app) => funnelStageOf(app) === stage), meta.label);
                      }
                    }}
                    className={`group relative rounded-xl border transition-all text-left p-3 shrink-0 overflow-hidden ${
                      isActive
                        ? `${meta.tint} ring-2 ${meta.ring} border-transparent`
                        : "border-border/50 bg-card hover:bg-muted/30 hover:border-border"
                    }`}
                    style={{ flex: `0 0 ${widthBasis}px`, width: widthBasis }}
                    title={`${stuck} currently at ${meta.label} · ${reached} reached this stage or beyond`}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                      <div className={`w-6 h-6 rounded-lg ${meta.iconBg} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-3 w-3 ${meta.iconColor}`} />
                      </div>
                      <p className="whitespace-nowrap text-xl font-bold text-foreground leading-none tracking-tight tabular-nums">{stuck}</p>
                    </div>
                    <p className="text-[11px] font-medium text-foreground/80 truncate">{meta.label}</p>
                    <div className="mt-2 h-1 rounded-full bg-muted/60 overflow-hidden">
                      <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${reachPct}%` }} />
                    </div>
                    <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground/70">{reached}</span> reached
                    </p>
                  </button>
                </Fragment>
              );
            })}
          </div>

          {canViewCourseBreakup && (
            <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-foreground">Course-wise application status</p>
                  <p className="text-[11px] text-muted-foreground">Campus-wise courses. Total excludes In Progress. Click any count to select that cohort for a lead list.</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedListApps.length > 0 && (
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => openAddToListDialog("selected")}
                    >
                      <ListPlus className="h-3.5 w-3.5" />
                      Add selected ({selectedListApps.length})
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setShowCourseBreakup((current) => !current)}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {showCourseBreakup ? "Hide course status" : "Show course status"}
                  </Button>
                </div>
              </div>
              {showCourseBreakup && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50 bg-background/70">
                        <th className="sticky left-0 z-10 min-w-[190px] bg-background/95 px-3 py-2 text-left font-medium text-muted-foreground">Campus</th>
                        <th className="sticky left-[190px] z-10 min-w-[220px] bg-background/95 px-3 py-2 text-left font-medium text-muted-foreground">Course</th>
                        <th className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">Total excl. In Progress</th>
                        {FUNNEL_ORDER.map((stage) => (
                          <th key={stage} className="px-2 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
                            {FUNNEL_META[stage].label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {courseStatusRows.map((row) => (
                        <tr key={`${row.campus}::${row.course}`} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                          <td className="sticky left-0 z-10 max-w-[220px] bg-background/95 px-3 py-2 text-muted-foreground">
                            <span className="block truncate" title={row.campus}>{row.campus}</span>
                          </td>
                          <td className="sticky left-[190px] z-10 max-w-[260px] bg-background/95 px-3 py-2 font-medium text-foreground">
                            <span className="block truncate" title={row.course}>{row.course}</span>
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              disabled={row.totalBeyondInProgress === 0}
                              onClick={() => {
                                const rows = FUNNEL_ORDER
                                  .filter((stage) => stage !== "in_progress")
                                  .flatMap((stage) => row.stageApps[stage]);
                                selectApplicationCohort(rows, `${row.course} beyond In Progress`);
                                setCourseFilter(row.course);
                                setStageFilter(null);
                              }}
                              className="rounded-md px-2 py-1 font-semibold tabular-nums text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:text-muted-foreground/40"
                              title={`Select ${row.course} applications beyond In Progress`}
                            >
                              {row.totalBeyondInProgress}
                            </button>
                          </td>
                          {FUNNEL_ORDER.map((stage) => {
                            const count = row.stageCounts[stage];
                            const meta = FUNNEL_META[stage];
                            return (
                              <td key={stage} className="px-2 py-2 text-right">
                                <button
                                  disabled={count === 0}
                                  onClick={() => {
                                    selectApplicationCohort(row.stageApps[stage], `${row.course} · ${meta.label}`);
                                    setCourseFilter(row.course);
                                    setStageFilter(stage);
                                    setPaymentFilter("all");
                                    setStatusFilter("all");
                                  }}
                                  className={`rounded-md px-2 py-1 font-medium tabular-nums hover:bg-muted disabled:pointer-events-none disabled:text-muted-foreground/30 ${count > 0 ? "text-foreground" : "text-muted-foreground/30"}`}
                                  title={`Select ${count} ${row.course} application${count === 1 ? "" : "s"} at ${meta.label}`}
                                >
                                  {count}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {courseStatusRows.length === 0 && (
                        <tr>
                          <td colSpan={FUNNEL_ORDER.length + 3} className="px-3 py-8 text-center text-muted-foreground">
                            No applications match the current dashboard scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, app ID, course..."
            className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <SelectField
          value={courseFilter}
          onValueChange={setCourseFilter}
          options={[
            { value: "all", label: "All Courses" },
            ...courseOptions.map((course) => ({ value: course, label: course })),
          ]}
          allowEmpty={false}
          triggerClassName="min-w-[180px] max-w-[260px] rounded-xl border border-input bg-background px-3 py-2 text-sm"
          ariaLabel="Filter applications by course"
        />
        {canExportApplications && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            disabled={courseFilter === "all" || exportingCourseSplit}
            onClick={handleExportCourseSplitCsv}
            title={courseFilter === "all"
              ? "Select a course first to export in-progress and paid/other CSV files"
              : "Download two CSV files for the selected course: in-progress and paid/other states"}
          >
            {exportingCourseSplit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Course CSVs
          </Button>
        )}
        {!isCounsellor && (
          <SelectField
            value={counsellorFilter}
            onValueChange={setCounsellorFilter}
            options={[
              { value: "all", label: "All Counsellors" },
              ...counsellorOptions.map((counsellor) => ({
                value: counsellor.id,
                label: counsellor.name,
              })),
            ]}
            allowEmpty={false}
            triggerClassName="min-w-[170px] max-w-[240px] rounded-xl border border-input bg-background px-3 py-2 text-sm"
            ariaLabel="Filter applications by counsellor"
          />
        )}
        <SelectField
          value={paymentFilter}
          onValueChange={(value) => setPaymentFilter(value as any)}
          options={[
            { value: "all", label: "All Payments" },
            { value: "paid", label: "Paid" },
            { value: "pending", label: "Pending" },
          ]}
          allowEmpty={false}
          triggerClassName="rounded-xl border border-input bg-background px-3 py-2 text-sm"
          ariaLabel="Filter applications by payment status"
        />
        <SelectField
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as any)}
          options={[
            { value: "all", label: "All Status" },
            { value: "draft", label: "Draft" },
            { value: "submitted", label: "Submitted" },
            { value: "on_hold", label: "On Hold" },
          ]}
          allowEmpty={false}
          triggerClassName="rounded-xl border border-input bg-background px-3 py-2 text-sm"
          ariaLabel="Filter applications by application status"
        />
        <DateRangeFilter
          preset={datePreset}
          fromDate={fromDate}
          toDate={toDate}
          onPresetChange={setDatePreset}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
          ariaPrefix="Application created"
        />
        {canManageApplicationLists && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            disabled={filteredListApps.length === 0}
            onClick={() => openAddToListDialog("filtered")}
            title="Save the current filtered application view as a reusable lead list for bulk WhatsApp/email"
          >
            <Send className="h-3.5 w-3.5" />
            Save filter ({filteredListApps.length})
          </Button>
        )}
        {(courseFilter !== "all" || (!isCounsellor && counsellorFilter !== "all") || paymentFilter !== "all" || statusFilter !== "all" || stageFilter || fromDate || toDate) && (
          <Button variant="ghost" size="sm" onClick={() => { setCourseFilter("all"); setCounsellorFilter("all"); setPaymentFilter("all"); setStatusFilter("all"); setStageFilter(null); setDatePreset("all"); setFromDate(""); setToDate(""); }}>
            <X className="h-3.5 w-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Bulk action bar — appears when applications are selected */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} application{selectedIds.size > 1 ? "s" : ""} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canManageApplicationLists && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={selectedListApps.length === 0}
                onClick={() => openAddToListDialog("selected")}
              >
                <ListPlus className="h-4 w-4" /> Add to List
              </Button>
            )}
            {isSuperAdmin && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setBulkDeleteConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="border-border/60 shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-8"></th>
                {!isCounsellor && (
                  <th className="px-2 py-2.5 text-left font-medium text-muted-foreground w-8">
                    <input
                      type="checkbox"
                      className="cursor-pointer accent-primary"
                      title={canManageApplicationLists ? "Select all filtered lead-linked applications" : "Select all eligible for PDF regeneration"}
                      checked={allSelectableAppsSelected}
                      onChange={(e) => {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) selectableApps.forEach(a => next.add(a.id));
                          else selectableApps.forEach(a => next.delete(a.id));
                          return next;
                        });
                      }}
                    />
                  </th>
                )}
                <th className="px-2 py-2 text-left font-medium text-muted-foreground whitespace-nowrap min-w-[120px]">App ID</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px] max-w-[240px]">Name</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Phone</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Course</th>
                {/* Form-fill progress is meaningless on the Submitted tab — every
                    row is 7/7 by definition — so we drop the column there. */}
                {statusFilter !== "submitted" && (
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground">Form</th>
                )}
                <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[380px]" title="Submission → Fee → Docs → Approved → Offer → Token → Admitted">Lifecycle</th>
                {!isCounsellor && <th className="px-2 py-2 text-left font-medium text-muted-foreground">Counsellor</th>}
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Active</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleApps.map(app => {
                const isExpanded = expandedId === app.id;
                const courses = (app.course_selections || []).map((c: any) => c.course_name).join(", ");
                const cc = completedCount(app.completed_sections);
                const tc = totalCount(app.completed_sections);
                const progressPct = tc > 0 ? Math.round((cc / tc) * 100) : 0;

                const courseList = app.course_selections || [];
                const cs = app.completed_sections || {};
                // Columns: chevron + (checkbox if !counsellor) + appId + name + phone + course
                // + (form if !submitted-tab) + lifecycle + (counsellor if !counsellor) + date + actions.
                // Adjust expandColSpan when the Form column is hidden on the Submitted tab.
                const formColShown = statusFilter !== "submitted";
                const expandColSpan = (isCounsellor ? 9 : 11) - (formColShown ? 0 : 1);

                return (
                  <Fragment key={app.id}>
                  <tr className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-2 py-2">
                      <button onClick={() => setExpandedId(isExpanded ? null : app.id)} className="text-muted-foreground hover:text-foreground">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </td>
                    {!isCounsellor && (
                      <td className="px-2 py-2">
                        {(canManageApplicationLists ? !!app.lead_id : canRegenerateFormPdf(app)) ? (
                          <input
                            type="checkbox"
                            className="cursor-pointer accent-primary"
                            checked={selectedIds.has(app.id)}
                            onChange={(e) => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(app.id);
                                else next.delete(app.id);
                                return next;
                              });
                            }}
                          />
                        ) : null}
                      </td>
                    )}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="font-mono text-xs text-primary">{app.application_id}</span>
                    </td>
                    <td className="px-2 py-2 min-w-[180px] max-w-[240px]">
                      <span className={`font-medium block truncate ${app.full_name === "Applicant" ? "text-muted-foreground italic" : "text-foreground"}`} title={app.full_name || ""}>
                        {app.full_name || "—"}
                      </span>
                      {app.exam_registration && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <ExamRegistrationBadge
                            examCode={app.exam_registration.examCode}
                            status={app.exam_registration.status}
                            registrationNo={app.exam_registration.registrationNo}
                            onClick={app.lead_id ? () => setExamRegTarget({
                              lead_id: app.lead_id as string,
                              lead_name: app.full_name || "Applicant",
                              exam_code: app.exam_registration!.examCode,
                              phone: app.phone,
                              course_name: primaryCourseName(app),
                            }) : undefined}
                          />
                        </div>
                      )}
                      {app.status === "on_hold" && (
                        <div className="mt-1.5">
                          <span
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 max-w-[260px]"
                            title={app.hold_reason || "No reason provided"}
                          >
                            <PauseCircle className="h-3 w-3 shrink-0" />
                            <span className="truncate">{app.hold_reason || "No reason provided"}</span>
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground text-xs">{app.phone}</td>
                    <td className="px-2 py-2 text-xs text-foreground max-w-[200px] truncate">{courses || "—"}</td>
                    {/* Form-fill progress (sections completed in apply portal) — hidden on Submitted tab. */}
                    {statusFilter !== "submitted" && (
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${progressPct === 100 ? "bg-emerald-500" : progressPct > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                              style={{ width: `${progressPct}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{cc}/{tc}</span>
                        </div>
                      </td>
                    )}
                    {/* Lifecycle stepper — labeled variant so each stage is readable at a glance. */}
                    <td className="px-2 py-2">
                      <MiniLifecycleStepper
                        showLabels
                        app={app.dossier?.lifecycle.app || { status: app.status, payment_status: app.payment_status }}
                        lead={app.dossier?.lifecycle.lead || null}
                        hasLead={app.dossier?.lifecycle.hasLead ?? !!app.lead_id}
                        appFeePaid={app.dossier?.lifecycle.appFeePaid ?? app.app_fee_paid}
                        hasOffer={app.dossier?.lifecycle.hasOffer ?? app.has_offer}
                        docs={app.dossier?.lifecycle.docs ?? app.doc_counts}
                        panDue={app.dossier?.lifecycle.panDue ?? app.pan_due}
                        anDue={app.dossier?.lifecycle.anDue ?? app.an_due}
                      />
                    </td>
                    {!isCounsellor && <td className="px-2 py-2 text-xs text-muted-foreground">{app.counsellor_name || "—"}</td>}
                    <td className="px-2 py-2 text-[10px] text-muted-foreground">
                      {new Date(applicationActivityTime(app)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                    </td>
                    <td className="px-2 py-2">
                      <div className="inline-flex items-center gap-2">
                        {/* Single "View" CTA — opens AdminApplicationView, which is the
                            unified surface for the application PDF, fee receipt,
                            uploaded documents, lifecycle, and admin actions
                            (approve / reject, issue offer letter, etc.).
                            Replaces the previous icon-cluster of separate
                            doc / receipt / open-lead links. */}
                        <a
                          href={`/applications/${app.application_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 whitespace-nowrap"
                          title="View application — PDF, receipt, uploaded documents, and admin actions"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </a>

                        {/* Send a one-click login link to the apply portal so the
                            student can resume / complete their application or pay
                            the token fee. */}
                        {app.lead_id && (
                          <ApplyMagicLinkButton
                            leadId={app.lead_id}
                            leadName={app.full_name}
                            leadPhone={app.phone}
                          />
                        )}

                        {/* Nudge button — surfaces only when the candidate has
                            an offer letter and still owes money before getting
                            AN. Opens a dialog that pre-fills a WhatsApp message
                            with the AN balance + full Sem 1 balance + due date. */}
                        {app.lead_id && app.has_offer && !app.lead_admission_no
                          && (((app.an_due ?? 0) > 0) || ((app.year1_due ?? 0) > 0)) && (
                          <button
                            onClick={() => setNudgeTarget(app)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                            title="Nudge candidate over WhatsApp to confirm admission"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Nudge
                          </button>
                        )}
                        {/* Put on hold / release — for applications that can't
                            be processed (fails eligibility / entrance-exam
                            registration and no alternative course). */}
                        {!isCounsellor && (
                          app.status === "on_hold" ? (
                            <button
                              onClick={() => setHoldTarget({
                                id: app.id, application_id: app.application_id, lead_id: app.lead_id,
                                full_name: app.full_name, phone: app.phone,
                                course_name: primaryCourseName(app),
                                exam_code: app.exam_registration?.examCode ?? null,
                                on_hold: true, hold_reason: app.hold_reason ?? null,
                              })}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 whitespace-nowrap"
                              title="This application is on hold — click to release"
                            >
                              <PauseCircle className="h-3.5 w-3.5" />
                              On hold
                            </button>
                          ) : (
                            <button
                              onClick={() => setHoldTarget({
                                id: app.id, application_id: app.application_id, lead_id: app.lead_id,
                                full_name: app.full_name, phone: app.phone,
                                course_name: primaryCourseName(app),
                                exam_code: app.exam_registration?.examCode ?? null,
                                on_hold: false,
                              })}
                              className="p-1.5 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
                              title="Put application on hold (ineligible)"
                            >
                              <PauseCircle className="h-3.5 w-3.5" />
                            </button>
                          )
                        )}
                        {isSuperAdmin && (
                          <button
                            onClick={() => {
                              setDeleteTarget(app);
                              setDeleteConfirmText("");
                            }}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                            title={app.payment_status === "paid" ? "Delete paid application" : "Delete application"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded details — rendered inline below the clicked row */}
                  {isExpanded && (
                    <tr className="border-b border-border/40">
                      <td colSpan={expandColSpan} className="p-0 bg-primary/5">
                        <div className="border-l-4 border-primary/30 p-5 animate-fade-in">
                          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-foreground">{app.application_id} — {app.full_name}</h3>
                            <div className="flex items-center gap-2">
                              {app.form_pdf_url ? (
                                <>
                                  <a href={app.form_pdf_url} target="_blank" rel="noopener"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
                                    <FileText className="h-3.5 w-3.5" /> Open Form PDF
                                  </a>
                                  <button onClick={() => generateFormPdf(app)} disabled={generatingPdfFor === app.id}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                                    title="Regenerate Application Form PDF">
                                    {generatingPdfFor === app.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                    Regenerate
                                  </button>
                                </>
                              ) : (app.status === "submitted" || app.status === "under_review" || app.status === "approved") && (
                                <button onClick={() => generateFormPdf(app)} disabled={generatingPdfFor === app.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                  {generatingPdfFor === app.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                                  Generate Form PDF
                                </button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => setExpandedId(null)}><X className="h-3.5 w-3.5" /></Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                            {/* Personal Details */}
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Personal Details</p>
                              <div className="space-y-1">
                                <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{app.full_name}</span></p>
                                <p><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{app.phone}</span></p>
                                <p><span className="text-muted-foreground">Email:</span> <span className="font-medium">{app.email || "—"}</span></p>
                                <p><span className="text-muted-foreground">DOB:</span> <span className="font-medium">{app.dob || "—"}</span></p>
                                <p><span className="text-muted-foreground">Gender:</span> <span className="font-medium capitalize">{app.gender || "—"}</span></p>
                                <p><span className="text-muted-foreground">Category:</span> <span className="font-medium">{app.category || "—"}</span></p>
                                {app.address?.city && <p><span className="text-muted-foreground">City:</span> <span className="font-medium">{app.address.city}, {app.address.state}</span></p>}
                              </div>
                            </div>

                            {/* Course & Payment */}
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Course Selections</p>
                              <div className="space-y-1.5">
                                {courseList.map((c: any, i: number) => (
                                  <div key={i} className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{i + 1}</span>
                                    <span className="font-medium">{c.course_name}</span>
                                    {c.campus_name && <span className="text-muted-foreground">· {c.campus_name}</span>}
                                  </div>
                                ))}
                                {courseList.length === 0 && <p className="text-muted-foreground">No courses selected</p>}
                              </div>

                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Payment</p>
                              <div className="space-y-1">
                                <p><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] border-0 ml-1 ${PAYMENT_BADGE[app.payment_status || "pending"]}`}>{app.payment_status || "pending"}</Badge></p>
                                {app.fee_amount && <p><span className="text-muted-foreground">Amount:</span> <span className="font-medium">₹{app.fee_amount.toLocaleString("en-IN")}</span></p>}
                                {app.payment_ref && <p><span className="text-muted-foreground">Ref:</span> <span className="font-mono text-[10px]">{app.payment_ref}</span></p>}
                                {isSuperAdmin && app.payment_status !== "paid" && app.lead_id && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => setOfflinePaymentApp(app)}
                                  >
                                    <CreditCard className="h-3 w-3 mr-1" />Mark Offline Payment
                                  </Button>
                                )}
                                {isSuperAdmin && app.lead_id && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 ml-2 h-7 text-xs"
                                    onClick={() => setOfflineReceiptApp(app)}
                                  >
                                    <Receipt className="h-3 w-3 mr-1" />Record Offline Receipt
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Section Progress */}
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Section Progress</p>
                              <div className="space-y-1.5">
                                {Object.entries(cs).map(([key, done]) => (
                                  <div key={key} className="flex items-center gap-2">
                                    {done ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
                                    <span className={`capitalize ${done ? "text-foreground" : "text-muted-foreground"}`}>{key.replace(/_/g, " ")}</span>
                                  </div>
                                ))}
                              </div>

                              <div className="mt-4 flex gap-2">
                                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => fetchDocs(app.id, app.application_id)}>
                                  <Upload className="h-3 w-3 mr-1" />Documents
                                </Button>
                                {app.lead_id && (
                                  <a href={`/admissions/${app.lead_id}`} target="_blank" rel="noreferrer">
                                    <Button size="sm" variant="outline" className="text-xs h-7">
                                      <ExternalLink className="h-3 w-3 mr-1" />Lead Page
                                    </Button>
                                  </a>
                                )}
                              </div>

                              {app.flags?.length ? (
                                <div className="mt-3 flex flex-wrap gap-1">
                                  {app.flags.filter(f => !(f === "payment_pending" && app.payment_status === "paid")).map((f, i) => (
                                    <Badge key={i} className="text-[9px] border-0 bg-gray-100 text-gray-600">{f}</Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={isCounsellor ? 11 : 13} className="px-4 py-12 text-center text-muted-foreground">No applications found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > APPLICATION_TABLE_PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing {pageStart + 1}-{pageEnd} of {filtered.length} applications
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage <= 1}
              >
                Previous
              </Button>
              <span className="tabular-nums">
                Page {safeCurrentPage} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                disabled={safeCurrentPage >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Add selected / filtered applications to a reusable lead list */}
      <Dialog open={showAddToList} onOpenChange={(open) => {
        if (savingList) return;
        setShowAddToList(open);
        if (!open) resetListDialog();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListPlus className="h-4 w-4" />
              Add applications to list
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {listScope === "filtered"
                ? `${filteredListApps.length} currently filtered application lead${filteredListApps.length === 1 ? "" : "s"} will be saved to a static list for bulk WhatsApp or email campaigns.`
                : `${selectedListApps.length} selected application lead${selectedListApps.length === 1 ? "" : "s"} will be saved to a static list for bulk WhatsApp or email campaigns.`}
            </p>
            {filteredListApps.length > 0 && selectedListApps.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={listScope === "selected" ? "default" : "outline"}
                  onClick={() => setListScope("selected")}
                >
                  Selected ({selectedListApps.length})
                </Button>
                <Button
                  type="button"
                  variant={listScope === "filtered" ? "default" : "outline"}
                  onClick={() => setListScope("filtered")}
                >
                  Current filter ({filteredListApps.length})
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={listMode === "new" ? "default" : "outline"}
                onClick={() => setListMode("new")}
              >
                New list
              </Button>
              <Button
                type="button"
                variant={listMode === "existing" ? "default" : "outline"}
                onClick={() => setListMode("existing")}
              >
                Existing list
              </Button>
            </div>
            {listMode === "new" ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">List name</label>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder={`Applications — ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                  className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                  autoFocus
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Choose list</label>
                <select
                  value={existingListId}
                  onChange={(e) => setExistingListId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">Select a list...</option>
                  {existingLists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name} ({list.member_count})</option>
                  ))}
                </select>
                {existingLists.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">No existing lists yet. Create a new list instead.</p>
                )}
              </div>
            )}
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              After saving, open <a href="/lists" className="font-medium text-primary underline">Lists</a> to preview recipients and send bulk WhatsApp or email.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddToList(false)} disabled={savingList}>Cancel</Button>
            <Button
              onClick={handleAddApplicationsToList}
              disabled={savingList || (listMode === "new" ? !newListName.trim() : !existingListId)}
              className="gap-2"
            >
              {savingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
              {listMode === "new" ? "Create List" : "Add to List"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documents Dialog */}
      <Dialog open={!!docsDialog} onOpenChange={() => setDocsDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Documents — {docsDialog?.applicationId}
            </DialogTitle>
          </DialogHeader>
          {docsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No documents uploaded</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {docs.map((doc, i) => {
                const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(doc.name);
                const isPdf = /\.pdf$/i.test(doc.name);
                const label = doc.name.split("-").slice(0, -1).join("-").replace(/_/g, " ") || doc.name;

                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {isImage ? (
                        <img src={doc.url} alt={doc.name} className="w-10 h-10 rounded object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize truncate">{label}</p>
                        <p className="text-[10px] text-muted-foreground">{isPdf ? "PDF" : isImage ? "Image" : "File"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={doc.url} target="_blank" rel="noreferrer"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="View">
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a href={doc.url} download
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary" title="Download">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {offlinePaymentApp?.lead_id && (
        <RecordPaymentDialog
          open={!!offlinePaymentApp}
          onOpenChange={(o) => { if (!o) setOfflinePaymentApp(null); }}
          leadId={offlinePaymentApp.lead_id}
          leadName={offlinePaymentApp.full_name}
          defaultType="application_fee"
          applicationId={offlinePaymentApp.application_id}
          title="Record Offline Payment"
          onSuccess={handleOfflinePaymentSuccess}
        />
      )}

      {offlineReceiptApp?.lead_id && (
        <OfflinePaymentDialog
          open={!!offlineReceiptApp}
          onOpenChange={(o) => { if (!o) setOfflineReceiptApp(null); }}
          leadId={offlineReceiptApp.lead_id}
          applicationId={offlineReceiptApp.application_id}
          onRecorded={() => setOfflineReceiptApp(null)}
        />
      )}

      <NudgePaymentDialog
        open={!!nudgeTarget}
        onClose={() => setNudgeTarget(null)}
        candidate={nudgeTarget ? {
          lead_id: nudgeTarget.lead_id || "",
          full_name: nudgeTarget.full_name,
          phone: nudgeTarget.phone,
          course_name: (nudgeTarget.course_selections || [])
            .map((c: any) => c.course_name).filter(Boolean).join(", ") || null,
          an_due: nudgeTarget.an_due ?? null,
          year1_due: nudgeTarget.year1_due ?? null,
        } : null}
      />

      <ExamRegisterDialog
        target={examRegTarget}
        onClose={() => setExamRegTarget(null)}
        onSaved={() => { setExamRegTarget(null); setRefreshKey((k) => k + 1); }}
      />

      <HoldApplicationDialog
        target={holdTarget}
        onClose={() => setHoldTarget(null)}
        onSaved={() => { setHoldTarget(null); setRefreshKey((k) => k + 1); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => {
        if (!o) {
          setDeleteTarget(null);
          setDeleteConfirmText("");
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{deleteTarget?.application_id}</span> ({deleteTarget?.full_name}).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget?.payment_status === "paid" && (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">Paid application deletion requires confirmation.</p>
              <p className="text-xs text-muted-foreground">
                Type <span className="font-mono font-semibold text-foreground">{PAID_APPLICATION_DELETE_CONFIRMATION}</span> to confirm deleting this paid application.
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder={PAID_APPLICATION_DELETE_CONFIRMATION}
                disabled={deleting}
                autoComplete="off"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || (
                deleteTarget?.payment_status === "paid" &&
                deleteConfirmText.trim().toUpperCase() !== PAID_APPLICATION_DELETE_CONFIRMATION
              )}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={(o) => {
        if (!o && !bulkDeleting) setBulkDeleteConfirmOpen(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} application{selectedIds.size > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size} selected application{selectedIds.size > 1 ? "s" : ""}.
              This action cannot be undone. Paid applications will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs text-muted-foreground">
              Only non-paid applications will be deleted. Paid applications require individual confirmation and will be skipped in bulk mode.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleBulkDelete();
              }}
            >
              {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete {selectedIds.size} application{selectedIds.size > 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

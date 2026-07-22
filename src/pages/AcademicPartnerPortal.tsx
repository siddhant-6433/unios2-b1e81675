import { PageLoader } from "@/components/ui/page-loader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { LeadPipeline } from "@/components/admissions/LeadPipeline";
import { ApplicationFunnelStrip } from "@/components/admissions/ApplicationFunnelStrip";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { SendPaymentLinkDialog } from "@/components/finance/SendPaymentLinkDialog";
import {
  type LeadFunnelStage,
  leadStagesForBucket,
} from "@/lib/leadStages";
import {
  applicationFunnelStageOf,
  type ApplicationFunnelStage,
} from "@/lib/applicationFunnel";
import {
  Building2,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  EyeOff,
  GraduationCap,
  IndianRupee,
  Loader2,
  MoreHorizontal,
  PhoneCall,
  Link as LinkIcon,
  Plus,
  FileText,
  Gift,
  RotateCcw,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import { LeadAssociationRequestsPanel } from "@/components/admissions/LeadAssociationRequestsPanel";
import { defaultFeeTermLabel } from "@/lib/feeTermLabels";

// Derive up to two-letter initials from a partner's company/display name,
// used as the logo fallback when no logo has been uploaded.
const getPartnerInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

type Partner = {
  id: string;
  name: string;
  default_payout_percentage: number;
  logo_url: string | null;
  company_name: string | null;
  company_address: string | null;
  pan_number: string | null;
  gst_number: string | null;
  tan_number: string | null;
  authorised_signatory_name: string | null;
  authorised_signatory_contact: string | null;
  authorised_signatory_email: string | null;
  onboarding_status: "not_started" | "in_progress" | "skipped" | "completed";
  onboarding_step: number;
  logo_file_path: string | null;
  logo_uploaded_at: string | null;
};

type DashboardStats = {
  partner_name: string;
  assigned_courses: number;
  assigned_batches: number;
  total_leads: number;
  conversions: number;
  pipeline: number;
  total_candidates: number;
  total_fee_collected: number;
  total_payout: number;
  pending_payout: number;
  paid_payout: number;
};

type Assignment = {
  id: string;
  course_id: string;
  course_name: string;
  batch_id: string | null;
  batch_name: string | null;
  effective_payout_percentage: number;
  candidates: number;
  fee_collected: number;
};

type Lead = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  source: string | null;
  academic_partner_id: string | null;
  application_id: string | null;
  application_status: string | null;
  application_payment_status: string | null;
  application_stage: string | null;
  application_submitted_at: string | null;
  application_created_at: string | null;
  application_fee_amount: number | null;
  application_completed_sections: Record<string, boolean> | null;
  application_form_pdf_url: string | null;
  course_id: string | null;
  campus_id: string | null;
  course_name: string;
  campus_name: string;
  created_at: string;
  attribution_type?: string | null;
  attribution_label?: string | null;
  has_offer?: boolean;
  has_token_fee_paid?: boolean;
  lead_pre_admission_no?: string | null;
  lead_admission_no?: string | null;
  latest_offer_id?: string | null;
  latest_offer_letter_url?: string | null;
};

type Student = {
  id: string;
  name: string;
  admission_no: string | null;
  phone: string | null;
  course_id: string | null;
  batch_id: string | null;
  lead_id: string | null;
  course_name: string;
  batch_name: string;
  status: string;
};

type AttendanceRow = {
  id: string;
  student_id: string;
  date: string;
  status: string;
  subject: string | null;
  student_name: string;
  student_admission_no: string | null;
  batch_name: string;
};

type FeeRow = {
  id: string;
  student_id: string;
  student_name: string;
  student_admission_no: string | null;
  term: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  status: string;
  due_date?: string | null;
  fee_code_name?: string | null;
};

type FeeReceipt = {
  id: string;
  lead_id: string;
  type: string;
  amount: number | null;
  concession_amount: number | null;
  payment_mode: string | null;
  transaction_ref: string | null;
  receipt_no: string | null;
  receipt_url: string | null;
  status: string;
  payment_date: string | null;
  created_at: string;
};

type Payout = {
  id: string;
  payout_amount: number;
  payout_percentage: number;
  fee_paid: number;
  status: string;
  created_at: string;
  lead_name?: string;
  student_name?: string;
  course_name?: string;
};

type ApplicationSummary = {
  application_id: string;
  status: string | null;
  payment_status: string | null;
  fee_amount: number | null;
  completed_sections?: Record<string, boolean> | null;
  submitted_at: string | null;
  created_at: string;
  form_pdf_url?: string | null;
};

type LeadRow = Omit<Lead, "course_name" | "campus_name"> & {
  // Raw lead columns selected by ACADEMIC_PARTNER_PIPELINE_LEAD_SELECT.
  pre_admission_no?: string | null;
  admission_no?: string | null;
  courses?: { name: string | null } | null;
  campuses?: { name: string | null } | null;
  applications?: ApplicationSummary[];
};

type StudentRow = Omit<Student, "course_name" | "batch_name"> & {
  courses?: { name: string | null } | null;
  batches?: { name: string | null } | null;
};

type AttendanceDataRow = Omit<AttendanceRow, "student_name" | "batch_name"> & {
  students?: { name: string | null; admission_no: string | null; pre_admission_no?: string | null } | null;
  batches?: { name: string | null } | null;
};

type FeeDataRow = Omit<FeeRow, "student_name" | "student_admission_no"> & {
  students?: { name: string | null; admission_no: string | null; pre_admission_no?: string | null } | null;
  fee_codes?: { code: string | null; name: string | null } | null;
};

type PayoutRow = Payout & {
  leads?: { name: string | null } | null;
  students?: { name: string | null } | null;
  courses?: { name: string | null } | null;
};

type PaidApplicationRpcRow = {
  lead_id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  source: string | null;
  academic_partner_id: string | null;
  counsellor_id: string | null;
  application_uuid: string;
  application_id: string;
  application_status: string | null;
  application_payment_status: string | null;
  application_submitted_at: string | null;
  application_created_at: string | null;
  application_fee_amount: number | null;
  application_completed_sections: Record<string, boolean> | null;
  application_form_pdf_url: string | null;
  course_id: string | null;
  course_name: string | null;
  campus_id: string | null;
  campus_name: string | null;
  attribution_type: "attributed_to_you" | "nimt_counsellor" | "direct" | "not_attributed_to_you";
  attribution_label: string;
  has_offer: boolean;
  latest_offer_id: string | null;
  latest_offer_letter_url: string | null;
};

type OnboardingStatus = Partner["onboarding_status"];
type OnboardingForm = {
  company_name: string;
  company_address: string;
  pan_number: string;
  gst_number: string;
  tan_number: string;
  authorised_signatory_name: string;
  authorised_signatory_contact: string;
  authorised_signatory_email: string;
};
type OnboardingDocType = "agreement" | "gst" | "pan" | "tan" | "fee_structure" | "brochure" | "additional";
type OnboardingFiles = Record<OnboardingDocType, File[]>;
type OperationError = { message: string };
type OnboardingDataClient = {
  from: (
    table: "academic_partner_documents",
  ) => {
    insert: (row: {
      partner_id: string;
      document_type: OnboardingDocType;
      title: string;
      file_name: string;
      file_path: string;
      content_type: string | null;
      file_size_bytes: number;
      visibility: "internal";
      uploaded_by: string;
    }) => Promise<{ error: OperationError | null }>;
  };
  rpc: {
    (
      fn: "save_academic_partner_onboarding",
      args: {
        _partner_id: string;
        _company_name: string;
        _company_address: string;
        _pan_number: string;
        _gst_number: string;
        _tan_number?: string;
        _authorised_signatory_name: string;
        _authorised_signatory_contact: string;
        _authorised_signatory_email: string;
        _onboarding_status: OnboardingStatus;
        _onboarding_step: number;
      },
    ): Promise<{ data: Partner | null; error: OperationError | null }>;
    (
      fn: "save_academic_partner_logo",
      args: {
        _partner_id: string;
        _logo_file_path: string;
      },
    ): Promise<{ data: Partner | null; error: OperationError | null }>;
  };
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  application_in_progress: "Application",
  application_fee_paid: "Fee Paid",
  application_submitted: "Submitted",
  counsellor_call: "Follow Up",
  visit_scheduled: "Visit",
  interview: "Interview",
  offer_sent: "Offer",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
  rejected: "Rejected",
  waitlisted: "Waitlisted",
};

const statusBadge = (status: string) => {
  if (["paid", "present", "admitted", "active", "approved"].includes(status)) return "bg-success/10 text-success";
  if (["pending", "due", "waitlisted"].includes(status)) return "bg-warning/10 text-warning-foreground";
  if (["cancelled", "overdue", "absent", "rejected"].includes(status)) return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
};

const attributionBadge = (type: string | null | undefined) => {
  if (type === "attributed_to_you") return "bg-success/10 text-success";
  if (type === "nimt_counsellor") return "bg-info/10 text-info-foreground";
  if (type === "not_attributed_to_you") return "bg-slate-100 text-slate-700";
  return "bg-warning/10 text-warning-foreground";
};

const ATTRIBUTION_LABELS: Record<PaidApplicationRpcRow["attribution_type"], string> = {
  attributed_to_you: "Attributed to you",
  nimt_counsellor: "NIMT counsellor",
  direct: "Direct",
  not_attributed_to_you: "Not attributed to you",
};

const attributionLabel = (lead: Lead, partnerId: string) => {
  if (lead.attribution_label) return lead.attribution_label;
  if (lead.attribution_type && lead.attribution_type in ATTRIBUTION_LABELS) {
    return ATTRIBUTION_LABELS[lead.attribution_type as PaidApplicationRpcRow["attribution_type"]];
  }
  return lead.academic_partner_id === partnerId ? ATTRIBUTION_LABELS.attributed_to_you : ATTRIBUTION_LABELS.direct;
};

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const fmt = (n: number | string | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const completedCount = (sections: Record<string, boolean> | null | undefined) =>
  Object.values(sections || {}).filter(Boolean).length;

const totalCount = (sections: Record<string, boolean> | null | undefined) =>
  Math.max(Object.keys(sections || {}).length, 0);

const applicationStageLabel = (app: ApplicationSummary | null | undefined) => {
  if (!app) return "Not Started";
  if (app.status === "approved") return "Approved";
  if (app.status === "rejected") return "Rejected";
  if (app.submitted_at || app.status === "submitted" || app.status === "under_review") return "Submitted";
  if (app.payment_status === "paid") return "Fee Paid";
  const total = totalCount(app.completed_sections);
  const completed = completedCount(app.completed_sections);
  if (total > 0 && completed > 0) return `${completed}/${total} Sections`;
  return "Draft";
};

const isCompletedApplication = (lead: Lead) =>
  Boolean(
    lead.application_submitted_at
    || ["submitted", "under_review", "approved", "rejected"].includes(lead.application_status || "")
  );

const attendancePercent = (present: number, total: number) => {
  if (total <= 0) return "-";
  return `${Math.round((present / total) * 100)}%`;
};

const PORTAL_TABS = [
  { label: "Leads", value: "leads" },
  { label: "Applications", value: "applications" },
  { label: "Students", value: "students" },
  { label: "Fee Collection", value: "fees" },
  { label: "Academic Record", value: "attendance" },
  { label: "Payouts", value: "payouts" },
  { label: "Batches", value: "batches" },
  { label: "Requests", value: "requests" },
  { label: "Settings", value: "settings" },
] as const;

const PORTAL_TAB_VALUES = new Set<string>(PORTAL_TABS.map((tab) => tab.value));

const ONBOARDING_STEPS = ["Company", "Tax", "Signatory", "Documents"] as const;
const ONBOARDING_DOC_TYPES: { value: OnboardingDocType; label: string; required?: boolean }[] = [
  { value: "agreement", label: "Agreement", required: true },
  { value: "gst", label: "GST Certificate" },
  { value: "pan", label: "PAN Card" },
  { value: "tan", label: "TAN Certificate" },
  { value: "fee_structure", label: "Fee Structure" },
  { value: "brochure", label: "Brochures" },
  { value: "additional", label: "Additional Documents" },
];
const emptyOnboardingFiles = (): OnboardingFiles => ({
  agreement: [],
  gst: [],
  pan: [],
  tan: [],
  fee_structure: [],
  brochure: [],
  additional: [],
});
const onboardingFormFromPartner = (partner: Partner | null): OnboardingForm => ({
  company_name: partner?.company_name || "",
  company_address: partner?.company_address || "",
  pan_number: partner?.pan_number || "",
  gst_number: partner?.gst_number || "",
  tan_number: partner?.tan_number || "",
  authorised_signatory_name: partner?.authorised_signatory_name || "",
  authorised_signatory_contact: partner?.authorised_signatory_contact || "",
  authorised_signatory_email: partner?.authorised_signatory_email || "",
});
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
const isTanSchemaCacheError = (error: OperationError | null) =>
  Boolean(error?.message && /tan_number|_tan_number|schema cache|function .*save_academic_partner_onboarding/i.test(error.message));
const isTanDocumentTypeConstraintError = (error: OperationError | null) =>
  Boolean(error?.message && /document_type|academic_partner_documents_document_type_check|check constraint/i.test(error.message));
const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Please try again.";
};

const ACADEMIC_PARTNER_PIPELINE_LEAD_SELECT = "id, name, phone, email, stage, source, academic_partner_id, application_id, pre_admission_no, admission_no, course_id, campus_id, created_at, courses:course_id(name), campuses:campus_id(name), applications:applications(application_id, status, payment_status, fee_amount, completed_sections, submitted_at, created_at, form_pdf_url)";

// Partner-created new leads are mapped on insert; duplicate existing CRM leads
// remain pending requests and enter these pipelines only after admin approval.
const scopePartnerPipelineLeads = (rows: LeadRow[], partnerId: string) =>
  rows.filter((lead) => lead.academic_partner_id === partnerId);

const uniqueById = <T extends { id: string }>(rows: T[]) =>
  Array.from(new Map(rows.map((row) => [row.id, row])).values());

const assignmentMatchesStudent = (assignment: Assignment, student: Pick<StudentRow, "course_id" | "batch_id">) =>
  assignment.course_id === student.course_id && (!assignment.batch_id || assignment.batch_id === student.batch_id);

const assignedCourseIds = (assignments: Assignment[]) =>
  Array.from(new Set(assignments.map((assignment) => assignment.course_id).filter(Boolean)));

export default function AcademicPartnerPortal() {
  const { user, role, hasPermission, isImpersonating, realRole } = useAuth();
  const { toast } = useToast();
  const canIssueOfferLetters = role === "academic_partner_offer_letter" && hasPermission("academic_partner_offer_letters:issue");
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") || "leads";
  const activeTab = PORTAL_TAB_VALUES.has(requestedTab) ? requestedTab : "leads";
  const [loading, setLoading] = useState(true);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [paidApplications, setPaidApplications] = useState<Lead[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [receiptsByLead, setReceiptsByLead] = useState<Map<string, FeeReceipt[]>>(new Map());
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [detailsLead, setDetailsLead] = useState<Lead | null>(null);
  const [offerLead, setOfferLead] = useState<Lead | null>(null);
  const [feeDetailsStudentId, setFeeDetailsStudentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [savingAgentPhone, setSavingAgentPhone] = useState(false);
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
  const [payLinkLead, setPayLinkLead] = useState<{ id: string; name: string } | null>(null);
  const [loginLinkLead, setLoginLinkLead] = useState<{ id: string; name: string | null; phone: string | null } | null>(null);
  const [agentPhone, setAgentPhone] = useState("");
  const [leadForm, setLeadForm] = useState({ name: "", phone: "", email: "", course_id: "", notes: "", share_with_nimt: false });
  const [leadFunnelStage, setLeadFunnelStage] = useState<LeadFunnelStage | "leakage" | null>(null);
  const [appFunnelStage, setAppFunnelStage] = useState<ApplicationFunnelStage | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingFiles, setOnboardingFiles] = useState<OnboardingFiles>(() => emptyOnboardingFiles());
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>(() => onboardingFormFromPartner(null));
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    assignments.forEach((a) => map.set(a.course_id, a.course_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments]);

  const feeByStudent = useMemo(() => {
    const map = new Map<string, { total: number; paid: number; balance: number; rows: number }>();
    fees.forEach((fee) => {
      const current = map.get(fee.student_id) || { total: 0, paid: 0, balance: 0, rows: 0 };
      current.total += Number(fee.total_amount || 0);
      current.paid += Number(fee.paid_amount || 0);
      current.balance += Number(fee.balance || 0);
      current.rows += 1;
      map.set(fee.student_id, current);
    });
    return map;
  }, [fees]);

  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, { total: number; present: number; absent: number; late: number }>();
    attendance.forEach((row) => {
      const current = map.get(row.student_id) || { total: 0, present: 0, absent: 0, late: 0 };
      current.total += 1;
      if (row.status === "present") current.present += 1;
      if (row.status === "absent") current.absent += 1;
      if (row.status === "late") current.late += 1;
      map.set(row.student_id, current);
    });
    return map;
  }, [attendance]);

  const feeDetailsRows = useMemo(
    () => feeDetailsStudentId ? fees.filter((fee) => fee.student_id === feeDetailsStudentId) : [],
    [feeDetailsStudentId, fees],
  );
  const feeDetailsSummary = feeDetailsStudentId ? feeByStudent.get(feeDetailsStudentId) : null;
  const feeDetailsStudent = feeDetailsRows[0] || null;

  // Actual payment receipts for the open student — matched via the student's
  // lead (lead_payments is lead-scoped).
  const feeDetailsReceipts = useMemo(() => {
    if (!feeDetailsStudentId) return [] as FeeReceipt[];
    const leadId = students.find((s) => s.id === feeDetailsStudentId)?.lead_id;
    return leadId ? (receiptsByLead.get(leadId) || []) : [];
  }, [feeDetailsStudentId, students, receiptsByLead]);

  const applicationLeads = useMemo(
    () => paidApplications.filter((lead) => Boolean(lead.application_id || lead.application_status || lead.application_created_at)),
    [paidApplications],
  );
  const onboardingComplete = partner?.onboarding_status === "completed";
  const onboardingSkipped = partner?.onboarding_status === "skipped";
  const onboardingNeedsAttention = Boolean(partner && !onboardingComplete && showOnboarding);

  // Lead-pipeline funnel counts, built only from this partner's scoped leads.
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((lead) => {
      counts[lead.stage] = (counts[lead.stage] || 0) + 1;
    });
    return counts;
  }, [leads]);

  // Leads table filtered to the clicked funnel bucket (or all when no filter).
  const visibleLeads = useMemo(() => {
    if (!leadFunnelStage) return leads;
    const stages = new Set(leadStagesForBucket(leadFunnelStage));
    return leads.filter((lead) => stages.has(lead.stage));
  }, [leads, leadFunnelStage]);

  // Application-pipeline funnel rows, derived from the scoped application leads.
  // Full funnel input — including the offer / token-fee / PAN / AN signals — so
  // token_paid, pre_admitted and admitted are counted, not collapsed into Paid.
  const funnelInputOf = useCallback((lead: Lead) => ({
    status: lead.application_status,
    payment_status: lead.application_payment_status,
    lead_stage: lead.stage,
    lead_pre_admission_no: lead.lead_pre_admission_no,
    lead_admission_no: lead.lead_admission_no,
    has_offer: lead.has_offer,
    has_token_fee_paid: lead.has_token_fee_paid,
  }), []);

  const applicationFunnelItems = useMemo(
    () => applicationLeads.map((lead) => funnelInputOf(lead)),
    [applicationLeads, funnelInputOf],
  );

  // Applications table filtered to the clicked application-funnel stage.
  const visibleApplicationLeads = useMemo(() => {
    if (!appFunnelStage) return applicationLeads;
    return applicationLeads.filter((lead) => applicationFunnelStageOf(funnelInputOf(lead)) === appFunnelStage);
  }, [applicationLeads, appFunnelStage, funnelInputOf]);

  const loadPartnerLogoUrl = useCallback(async (filePath: string | null, fallbackUrl?: string | null) => {
    if (!filePath) {
      setLogoUrl(fallbackUrl || null);
      return;
    }

    const { data, error } = await supabase.storage
      .from("academic-partner-logos")
      .createSignedUrl(filePath, 60 * 60);

    setLogoUrl(error || !data?.signedUrl ? null : data.signedUrl);
  }, []);

  const fetchPortal = useCallback(async (partnerId: string) => {
    const [statsRes, assignmentsRes, leadsRes, payoutsRes] = await Promise.all([
      supabase.from("academic_partner_dashboard").select("*").eq("partner_id", partnerId).single(),
      supabase.from("academic_partner_assignment_summary").select("*").eq("partner_id", partnerId).eq("is_active", true).order("course_name"),
      supabase.from("leads").select(ACADEMIC_PARTNER_PIPELINE_LEAD_SELECT).eq("academic_partner_id", partnerId).order("created_at", { ascending: false }).limit(200),
      supabase.from("academic_partner_payouts").select("*, leads:lead_id(name), students:student_id(name), courses:course_id(name)").eq("partner_id", partnerId).order("created_at", { ascending: false }).limit(100),
    ]);

    if (statsRes.data) setStats(statsRes.data as DashboardStats);
    const activeAssignments = ((assignmentsRes.data || []) as unknown as Assignment[]).map((a) => ({
      ...a,
      effective_payout_percentage: Number(a.effective_payout_percentage || 0),
      candidates: Number(a.candidates || 0),
      fee_collected: Number(a.fee_collected || 0),
    }));
    setAssignments(activeAssignments);

    const scopedRows = scopePartnerPipelineLeads((leadsRes.data || []) as unknown as LeadRow[], partnerId);

    // Funnel signals the partner cannot read directly (offer_letters +
    // lead_payments are RLS-blocked for the academic_partner role) — fetched via
    // a scoped SECURITY DEFINER RPC so token-paid / pre-admitted / admitted are
    // classified correctly instead of collapsing into "Paid".
    const funnelSignals = new Map<string, { has_offer: boolean; has_token_fee_paid: boolean }>();
    const panAnByLead = new Map<string, { pan: string | null; an: string | null }>();
    scopedRows.forEach((l) => panAnByLead.set(l.id, { pan: l.pre_admission_no ?? null, an: l.admission_no ?? null }));
    {
      const { data: signalRows, error: signalsError } = await supabase.rpc("academic_partner_lead_funnel_signals", {
        _partner_id: isImpersonating && realRole === "super_admin" ? partnerId : null,
      } as any);
      if (signalsError) {
        console.error("[academic_partner_lead_funnel_signals]", signalsError.message);
      } else {
        ((signalRows || []) as { lead_id: string; has_offer: boolean; has_token_fee_paid: boolean }[])
          .forEach((row) => funnelSignals.set(row.lead_id, {
            has_offer: !!row.has_offer,
            has_token_fee_paid: !!row.has_token_fee_paid,
          }));
      }
    }

    const mappedLeads = scopedRows.map((l) => ({
      ...l,
      application_id: l.applications?.[0]?.application_id || l.application_id || null,
      application_status: l.applications?.[0]?.status || null,
      application_payment_status: l.applications?.[0]?.payment_status || null,
      application_stage: applicationStageLabel(l.applications?.[0]),
      application_submitted_at: l.applications?.[0]?.submitted_at || null,
      application_created_at: l.applications?.[0]?.created_at || null,
      application_fee_amount: l.applications?.[0]?.fee_amount || null,
      application_completed_sections: l.applications?.[0]?.completed_sections || null,
      application_form_pdf_url: l.applications?.[0]?.form_pdf_url || null,
      course_name: l.courses?.name || "-",
      campus_name: l.campuses?.name || "-",
      attribution_type: "attributed_to_you",
      attribution_label: "Attributed to you",
      has_offer: funnelSignals.get(l.id)?.has_offer ?? false,
      has_token_fee_paid: funnelSignals.get(l.id)?.has_token_fee_paid ?? false,
      lead_pre_admission_no: l.pre_admission_no ?? null,
      lead_admission_no: l.admission_no ?? null,
      latest_offer_id: null,
      latest_offer_letter_url: null,
    }));
    setLeads(mappedLeads);

    if (canIssueOfferLetters) {
      const { data: paidRows, error: paidError } = await supabase.rpc("academic_partner_paid_applications", {
        _partner_id: isImpersonating && realRole === "super_admin" ? partnerId : null,
      } as any);
      if (paidError) {
        toast({
          title: "Paid applications not loaded",
          description: paidError.message,
          variant: "destructive",
        });
        setPaidApplications(mappedLeads.filter((lead) => lead.application_payment_status === "paid"));
      } else {
        setPaidApplications(((paidRows || []) as unknown as PaidApplicationRpcRow[]).map((row) => ({
          id: row.lead_id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          stage: row.stage,
          source: row.source,
          academic_partner_id: row.academic_partner_id,
          application_id: row.application_id,
          application_status: row.application_status,
          application_payment_status: row.application_payment_status,
          application_stage: applicationStageLabel({
            application_id: row.application_id,
            status: row.application_status,
            payment_status: row.application_payment_status,
            fee_amount: row.application_fee_amount,
            completed_sections: row.application_completed_sections,
            submitted_at: row.application_submitted_at,
            created_at: row.application_created_at || "",
            form_pdf_url: row.application_form_pdf_url,
          }),
          application_submitted_at: row.application_submitted_at,
          application_created_at: row.application_created_at,
          application_fee_amount: row.application_fee_amount,
          application_completed_sections: row.application_completed_sections,
          application_form_pdf_url: row.application_form_pdf_url,
          course_id: row.course_id,
          campus_id: row.campus_id,
          course_name: row.course_name || "-",
          campus_name: row.campus_name || "-",
          created_at: row.application_created_at || row.application_submitted_at || new Date().toISOString(),
          attribution_type: row.attribution_type,
          attribution_label: row.attribution_label,
          has_offer: row.has_offer || (funnelSignals.get(row.lead_id)?.has_offer ?? false),
          has_token_fee_paid: funnelSignals.get(row.lead_id)?.has_token_fee_paid ?? false,
          lead_pre_admission_no: panAnByLead.get(row.lead_id)?.pan ?? null,
          lead_admission_no: panAnByLead.get(row.lead_id)?.an ?? null,
          latest_offer_id: row.latest_offer_id,
          latest_offer_letter_url: row.latest_offer_letter_url,
        })));
      }
    } else {
      setPaidApplications(mappedLeads.filter((lead) => Boolean(lead.application_id || lead.application_status || lead.application_created_at)));
    }

    const studentSelect = "id, name, admission_no, phone, status, course_id, batch_id, lead_id, courses:course_id(name), batches:batch_id(name)";
    const assignmentStudentQueries = activeAssignments.map((assignment) => {
      let query = supabase
        .from("students")
        .select(studentSelect)
        .eq("course_id", assignment.course_id)
        .order("created_at", { ascending: false })
        .limit(300);
      if (assignment.batch_id) query = query.eq("batch_id", assignment.batch_id);
      return query;
    });
    const assignmentStudentResponses = assignmentStudentQueries.length > 0
      ? await Promise.all(assignmentStudentQueries)
      : [];
    const scopedStudentRows = uniqueById(
      assignmentStudentResponses.flatMap((res) => ((res.data || []) as unknown as StudentRow[]))
    ).filter((student) => activeAssignments.some((assignment) => assignmentMatchesStudent(assignment, student)));
    const scopedStudentIds = scopedStudentRows.map((student) => student.id);

    const mappedLeadIds = mappedLeads.map((lead) => lead.id);
    const mappedStudentRows = mappedLeadIds.length > 0
      ? ((await supabase
        .from("students")
        .select("id, lead_id")
        .in("lead_id", mappedLeadIds)
        .limit(500)).data || []) as Array<{ id: string; lead_id: string | null }>
      : [];
    const feeStudentIds = Array.from(new Set(mappedStudentRows.map((student) => student.id)));

    const [attendanceRes, feesRes] = await Promise.all([
      scopedStudentIds.length > 0
        ? supabase
          .from("daily_attendance")
          .select("id, student_id, date, status, subject, students:student_id(name, admission_no, pre_admission_no), batches:batch_id(name)")
          .in("student_id", scopedStudentIds)
          .order("date", { ascending: false })
          .limit(300)
        : Promise.resolve({ data: [], error: null }),
      feeStudentIds.length > 0
        ? supabase
          .from("fee_ledger")
          .select("id, student_id, term, total_amount, paid_amount, balance, status, due_date, students:student_id(name, admission_no, pre_admission_no), fee_codes:fee_code_id(code, name)")
          .in("student_id", feeStudentIds)
          .order("due_date", { ascending: false })
          .limit(300)
        : Promise.resolve({ data: [], error: null }),
    ]);

    setStudents(scopedStudentRows.map((s) => ({
      ...s,
      course_name: s.courses?.name || "-",
      batch_name: s.batches?.name || "-",
    })));
    setAttendance(((attendanceRes.data || []) as unknown as AttendanceDataRow[]).map((a) => ({
      ...a,
      student_name: a.students?.name || "-",
      student_admission_no: a.students?.admission_no || a.students?.pre_admission_no || null,
      batch_name: a.batches?.name || "-",
    })));
    setFees(((feesRes.data || []) as unknown as FeeDataRow[]).map((f) => ({
      ...f,
      student_name: f.students?.name || "-",
      student_admission_no: f.students?.admission_no || f.students?.pre_admission_no || null,
      fee_code_name: f.fee_codes?.name || null,
    })));

    // Fee receipts (lead_payments) are RLS-blocked for the academic_partner
    // role, so they're loaded via a scoped SECURITY DEFINER RPC and grouped by
    // lead for the Students / Finance tabs.
    {
      const { data: receiptRows, error: receiptsError } = await supabase.rpc("academic_partner_fee_receipts", {
        _partner_id: isImpersonating && realRole === "super_admin" ? partnerId : null,
      } as any);
      if (receiptsError) {
        console.error("[academic_partner_fee_receipts]", receiptsError.message);
        setReceiptsByLead(new Map());
      } else {
        const grouped = new Map<string, FeeReceipt[]>();
        ((receiptRows || []) as FeeReceipt[]).forEach((r) => {
          const list = grouped.get(r.lead_id) || [];
          list.push(r);
          grouped.set(r.lead_id, list);
        });
        setReceiptsByLead(grouped);
      }
    }
    setPayouts(((payoutsRes.data || []) as unknown as PayoutRow[]).map((p) => ({
      ...p,
      lead_name: p.leads?.name,
      student_name: p.students?.name,
      course_name: p.courses?.name,
    })));
  }, [canIssueOfferLetters, toast]);

  const fetchCallingAgentPhone = useCallback(async () => {
    if (!user?.id) return;
    setProfileLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      toast({ title: "Calling number not loaded", description: error.message, variant: "destructive" });
    } else {
      setAgentPhone(data?.phone || "");
    }
    setProfileLoading(false);
  }, [toast, user?.id]);

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      setLoading(true);
      const { data } = await supabase
        .from("academic_partners")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (!data) {
        setLoading(false);
        return;
      }
      const partnerData = data as unknown as Partner;
      setPartner(partnerData);
      await loadPartnerLogoUrl(partnerData.logo_file_path, partnerData.logo_url);
      setOnboardingForm(onboardingFormFromPartner(partnerData));
      setOnboardingStep(Math.min(Number(partnerData.onboarding_step || 0), ONBOARDING_STEPS.length - 1));
      setShowOnboarding(partnerData.onboarding_status !== "completed" && partnerData.onboarding_status !== "skipped");
      await fetchCallingAgentPhone();
      await fetchPortal(partnerData.id);
      setLoading(false);
    })();
  }, [fetchCallingAgentPhone, fetchPortal, loadPartnerLogoUrl, user?.id]);

  const updateOnboardingField = (field: keyof OnboardingForm, value: string) => {
    setOnboardingForm((current) => ({ ...current, [field]: value }));
  };

  const setOnboardingDocuments = (documentType: OnboardingDocType, fileList: FileList | null) => {
    setOnboardingFiles((current) => ({ ...current, [documentType]: Array.from(fileList || []) }));
  };

  const validateOnboardingForCompletion = () => {
    if (!onboardingForm.company_name.trim()) return "Company name is required.";
    if (!onboardingForm.company_address.trim()) return "Company address is required.";
    if (!onboardingForm.authorised_signatory_name.trim()) return "Authorised signatory name is required.";
    if (!onboardingForm.authorised_signatory_contact.trim()) return "Authorised signatory contact number is required.";
    if (!onboardingForm.authorised_signatory_email.trim()) return "Authorised signatory email is required.";
    return null;
  };

  const uploadOnboardingDocuments = async () => {
    if (!partner || !user?.id) return;
    const selected = ONBOARDING_DOC_TYPES.flatMap(({ value, label }) =>
      onboardingFiles[value].map((file) => ({ file, documentType: value, label })),
    );
    if (selected.length === 0) return;

    for (const { file, documentType, label } of selected) {
      const path = `${partner.id}/${Date.now()}-${documentType}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("academic-partner-documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });

      if (uploadError) throw uploadError;

      const onboardingClient = supabase as unknown as OnboardingDataClient;
      const documentRecord = {
        partner_id: partner.id,
        document_type: documentType,
        title: label,
        file_name: file.name,
        file_path: path,
        content_type: file.type || null,
        file_size_bytes: file.size,
        visibility: "internal",
        uploaded_by: user.id,
      } as const;
      const { error: recordError } = await onboardingClient.from("academic_partner_documents").insert(documentRecord);

      if (recordError && documentType === "tan" && isTanDocumentTypeConstraintError(recordError)) {
        const { error: fallbackError } = await onboardingClient.from("academic_partner_documents").insert({
          ...documentRecord,
          document_type: "additional",
          title: "TAN Certificate",
        });
        if (fallbackError) throw fallbackError;
      } else if (recordError) {
        throw recordError;
      }
    }
    setOnboardingFiles(emptyOnboardingFiles());
  };

  const uploadPartnerLogo = async (file: File | null) => {
    if (!partner || !file) return;

    if (file.type !== "image/png") {
      toast({
        title: "Upload a PNG logo",
        description: "Use a PNG with a transparent background for the partner dashboard.",
        variant: "destructive",
      });
      return;
    }

    setLogoUploading(true);
    try {
      const path = `${partner.id}/logo-${Date.now()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("academic-partner-logos")
        .upload(path, file, { contentType: "image/png", upsert: false });

      if (uploadError) throw uploadError;

      const onboardingClient = supabase as unknown as OnboardingDataClient;
      const { data, error } = await onboardingClient.rpc("save_academic_partner_logo", {
        _partner_id: partner.id,
        _logo_file_path: path,
      });

      if (error) throw error;
      if (!data) throw new Error("Academic partner profile was not returned.");

      setPartner(data);
      await loadPartnerLogoUrl(path);
      toast({ title: "Logo uploaded" });
    } catch (error: unknown) {
      toast({ title: "Logo not uploaded", description: errorMessage(error), variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  const onboardingRpcPayload = (status: OnboardingStatus, nextStep: number, includeTan = true) => ({
    _partner_id: partner?.id || "",
    _company_name: onboardingForm.company_name,
    _company_address: onboardingForm.company_address,
    _pan_number: onboardingForm.pan_number,
    _gst_number: onboardingForm.gst_number,
    ...(includeTan ? { _tan_number: onboardingForm.tan_number } : {}),
    _authorised_signatory_name: onboardingForm.authorised_signatory_name,
    _authorised_signatory_contact: onboardingForm.authorised_signatory_contact,
    _authorised_signatory_email: onboardingForm.authorised_signatory_email,
    _onboarding_status: status,
    _onboarding_step: nextStep,
  });

  const saveOnboarding = async (status: OnboardingStatus, nextStep = onboardingStep) => {
    if (!partner) return;
    const validationError = status === "completed" ? validateOnboardingForCompletion() : null;
    if (validationError) {
      toast({ title: "Onboarding incomplete", description: validationError, variant: "destructive" });
      return;
    }

    setOnboardingSaving(true);
    try {
      await uploadOnboardingDocuments();
      const onboardingClient = supabase as unknown as OnboardingDataClient;
      let { data, error } = await onboardingClient.rpc("save_academic_partner_onboarding", onboardingRpcPayload(status, nextStep));
      const tanDeferred = Boolean(error && isTanSchemaCacheError(error));
      if (tanDeferred) {
        const retry = await onboardingClient.rpc("save_academic_partner_onboarding", onboardingRpcPayload(status, nextStep, false));
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      if (!data) throw new Error("Academic partner profile was not returned.");

      const updatedPartner = data;
      setPartner(updatedPartner);
      setOnboardingForm(onboardingFormFromPartner(updatedPartner));
      setOnboardingStep(Math.min(Number(updatedPartner.onboarding_step || 0), ONBOARDING_STEPS.length - 1));
      setShowOnboarding(status !== "completed" && status !== "skipped");
      toast({
        title: status === "completed" ? "Onboarding completed" : status === "skipped" ? "Onboarding skipped" : "Onboarding saved",
        description: tanDeferred && onboardingForm.tan_number.trim()
          ? "TAN was not saved because the database migration is not applied yet."
          : status === "skipped" ? "You can resume it from this dashboard anytime." : undefined,
      });
    } catch (error: unknown) {
      toast({ title: "Onboarding not saved", description: errorMessage(error), variant: "destructive" });
    } finally {
      setOnboardingSaving(false);
    }
  };

  const goToOnboardingStep = async (step: number) => {
    const safeStep = Math.max(0, Math.min(step, ONBOARDING_STEPS.length - 1));
    setOnboardingStep(safeStep);
    if (partner) await saveOnboarding("in_progress", safeStep);
  };

  const saveCallingAgentPhone = async () => {
    if (!user?.id) return;
    const normalized = agentPhone.trim();
    const digits = normalized.replace(/\D/g, "");

    if (digits.length < 10) {
      toast({
        title: "Enter a valid number",
        description: "Cloud calls need a reachable calling agent number before connecting to the lead.",
        variant: "destructive",
      });
      return;
    }

    setSavingAgentPhone(true);
    const { error } = await supabase
      .from("profiles")
      .update({ phone: normalized })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Calling number not saved", description: error.message, variant: "destructive" });
    } else {
      setAgentPhone(normalized);
      toast({
        title: "Calling agent number saved",
        description: "Cloud calls will ring this number first, then connect to the lead.",
      });
    }
    setSavingAgentPhone(false);
  };

  const handleAddLead = async () => {
    if (!partner || !leadForm.name.trim() || !leadForm.phone.trim() || !leadForm.course_id) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("submit_lead_association_request", {
      _requester_type: "academic_partner",
      _name: leadForm.name.trim(),
      _phone: leadForm.phone.trim(),
      _email: leadForm.email.trim() || null,
      _course_id: leadForm.course_id,
      _campus_id: null,
      _notes: leadForm.notes.trim() || null,
      _consultant_id: null,
      _academic_partner_id: partner.id,
      _share_with_nimt: leadForm.share_with_nimt,
    });

    if (error) {
      toast({ title: "Lead not added", description: error.message, variant: "destructive" });
    } else {
      const result = data as { status?: string } | null;
      toast({
        title: result?.status === "pending" ? "Duplicate sent for approval" : "Lead added",
        description: result?.status === "pending"
          ? "This phone already exists in CRM. It will show as associated only after superadmin approval."
          : undefined,
      });
      setLeadForm({ name: "", phone: "", email: "", course_id: "", notes: "", share_with_nimt: false });
      setShowAddLead(false);
      await fetchPortal(partner.id);
    }
    setSaving(false);
  };

  const placeCloudCall = async (lead: Lead) => {
    if (!lead.phone) {
      toast({ title: "Call unavailable", description: "This lead has no phone number.", variant: "destructive" });
      return;
    }
    setCallingLeadId(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: lead.id },
      });
      if (error || data?.error) {
        toast({
          title: "Call failed",
          description: data?.error || error?.message || "Unable to start cloud call.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Calling you",
        description: data?.message || `Pick up your phone to connect to ${lead.name}.`,
      });
    } catch (error: unknown) {
      toast({ title: "Call failed", description: errorMessage(error) || "Unable to start cloud call.", variant: "destructive" });
    } finally {
      setCallingLeadId(null);
    }
  };

  if (loading) return <PageLoader />;
  if (!partner) return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No academic partner profile is linked to this account.</div>;

  const partnerInitials = getPartnerInitials(partner.company_name || partner.name);

  const renderPartnerLogo = () =>
    logoUrl ? (
      <img src={logoUrl} alt={`${partner.name} logo`} className="max-h-full max-w-full object-contain" />
    ) : (
      <span className="text-xl font-semibold uppercase tracking-wide text-muted-foreground">{partnerInitials}</span>
    );

  const renderLogoUploadButton = () => (
    <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground ${logoUploading ? "pointer-events-none opacity-70" : ""}`}>
      {logoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      {logoUploading ? "Uploading" : "Upload Logo"}
      <input
        type="file"
        accept="image/png"
        className="sr-only"
        disabled={logoUploading}
        onChange={(event) => {
          void uploadPartnerLogo(event.target.files?.[0] || null);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-16 w-40 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background p-2">
            {renderPartnerLogo()}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">Academic Partner Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">Welcome, {stats?.partner_name || partner.name}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowAddLead(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Lead
          </Button>
        </div>
      </div>

      {onboardingSkipped && !showOnboarding && (
        <Card className="border-warning/20 bg-warning/5/70 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-warning-foreground">Academic partner onboarding was skipped</p>
              <p className="mt-1 text-xs text-warning-foreground">Resume it anytime to add company, tax, signatory, and internal document details.</p>
            </div>
            <Button variant="outline" className="gap-2 bg-background" onClick={() => setShowOnboarding(true)}>
              <RotateCcw className="h-4 w-4" /> Resume Onboarding
            </Button>
          </CardContent>
        </Card>
      )}

      {onboardingNeedsAttention && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h2 className="text-base font-semibold text-foreground">Academic Partner Onboarding</h2>
                  <Badge variant="secondary" className="text-[10px]">
                    {partner.onboarding_status === "not_started" ? "Not Started" : partner.onboarding_status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Complete your company profile and upload documents for internal verification.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => saveOnboarding("skipped", onboardingStep)} disabled={onboardingSaving}>
                  Skip for now
                </Button>
                <Button variant="outline" size="sm" onClick={() => saveOnboarding("in_progress", onboardingStep)} disabled={onboardingSaving}>
                  Save Draft
                </Button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2">
              {ONBOARDING_STEPS.map((step, index) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setOnboardingStep(index)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                    index === onboardingStep
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {index + 1}. {step}
                </button>
              ))}
            </div>

            <div className="mt-5">
              {onboardingStep === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Partner Logo</p>
                        <p className="mt-1 text-xs text-muted-foreground">Upload a transparent PNG for the dashboard header.</p>
                      </div>
                      {renderLogoUploadButton()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Company Name *</label>
                    <input value={onboardingForm.company_name} onChange={(e) => updateOnboardingField("company_name", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Registered Email</label>
                    <input type="email" value={onboardingForm.authorised_signatory_email} onChange={(e) => updateOnboardingField("authorised_signatory_email", e.target.value)} className={inputCls} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Company Address *</label>
                    <textarea rows={3} value={onboardingForm.company_address} onChange={(e) => updateOnboardingField("company_address", e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              {onboardingStep === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">PAN</label>
                    <input value={onboardingForm.pan_number} onChange={(e) => updateOnboardingField("pan_number", e.target.value.toUpperCase())} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">GST</label>
                    <input value={onboardingForm.gst_number} onChange={(e) => updateOnboardingField("gst_number", e.target.value.toUpperCase())} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">TAN</label>
                    <input value={onboardingForm.tan_number} onChange={(e) => updateOnboardingField("tan_number", e.target.value.toUpperCase())} className={inputCls} />
                  </div>
                </div>
              )}

              {onboardingStep === 2 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Authorised Signatory Name *</label>
                    <input value={onboardingForm.authorised_signatory_name} onChange={(e) => updateOnboardingField("authorised_signatory_name", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Contact No. *</label>
                    <PhoneInput value={onboardingForm.authorised_signatory_contact} onChange={(phone) => updateOnboardingField("authorised_signatory_contact", phone)} />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email *</label>
                    <input type="email" value={onboardingForm.authorised_signatory_email} onChange={(e) => updateOnboardingField("authorised_signatory_email", e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              {onboardingStep === 3 && (
                <div className="space-y-4">
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <EyeOff className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>Uploaded documents are visible only to the internal admissions/admin team. They are not listed back in the academic partner portal.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ONBOARDING_DOC_TYPES.map((doc) => (
                      <div key={doc.value} className="rounded-xl border border-border/60 p-3">
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          {doc.label}{doc.required ? " *" : ""}
                        </label>
                        <input
                          type="file"
                          multiple
                          onChange={(e) => setOnboardingDocuments(doc.value, e.target.files)}
                          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary-foreground"
                        />
                        {onboardingFiles[doc.value].length > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">{onboardingFiles[doc.value].length} file(s) selected</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-border/60 pt-4">
              <Button variant="outline" onClick={() => goToOnboardingStep(onboardingStep - 1)} disabled={onboardingSaving || onboardingStep === 0}>
                Previous
              </Button>
              <div className="flex flex-wrap gap-2">
                {onboardingStep < ONBOARDING_STEPS.length - 1 ? (
                  <Button onClick={() => goToOnboardingStep(onboardingStep + 1)} disabled={onboardingSaving} className="gap-2">
                    {onboardingSaving && <Loader2 className="h-4 w-4 animate-spin" />} Save & Continue
                  </Button>
                ) : (
                  <Button onClick={() => saveOnboarding("completed", ONBOARDING_STEPS.length - 1)} disabled={onboardingSaving} className="gap-2">
                    {onboardingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Complete Onboarding
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {[
          { label: "Courses", value: stats?.assigned_courses || 0, icon: BookOpen, bg: "bg-pastel-blue" },
          { label: "Batches", value: stats?.assigned_batches || 0, icon: GraduationCap, bg: "bg-pastel-purple" },
          { label: "Leads", value: stats?.total_leads || 0, icon: Users, bg: "bg-pastel-orange" },
          { label: "Candidates", value: stats?.total_candidates || 0, icon: TrendingUp, bg: "bg-pastel-green" },
          { label: "Fee Collected", value: fmt(stats?.total_fee_collected), icon: IndianRupee, bg: "bg-pastel-mint" },
          { label: "Pending Payout", value: fmt(stats?.pending_payout), icon: IndianRupee, bg: "bg-pastel-yellow" },
        ].map((item) => (
          <Card key={item.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${item.bg}`}>
                <item.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setSearchParams(value === "leads" ? {} : { tab: value })}
        className="w-full"
      >
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start overflow-x-auto">
          {PORTAL_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="leads" className="mt-4 space-y-4">
          <LeadPipeline
            stageCounts={stageCounts}
            activeStage={leadFunnelStage}
            onStageClick={setLeadFunnelStage}
          />
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Lead</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Lead Stage</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Actions</th>
              </tr></thead>
              <tbody>
                {visibleLeads.map((lead) => (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3"><div className="font-medium">{lead.name}</div><div className="text-xs text-muted-foreground">{lead.phone}</div></td>
                    <td className="px-4 py-3"><div>{lead.course_name}</div><div className="text-xs text-muted-foreground">{lead.campus_name}</div></td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(lead.stage)}`}>{STAGE_LABELS[lead.stage] || lead.stage}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                      <ApplyMagicLinkButton
                        leadId={lead.id}
                        leadName={lead.name}
                        leadPhone={lead.phone}
                        mode="academic_partner_on_behalf"
                        label={lead.application_id ? "Continue Application" : "Complete Application"}
                        directOpen
                      />
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => placeCloudCall(lead)} disabled={callingLeadId === lead.id}>
                        {callingLeadId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
                        Call
                      </Button>
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => setPayLinkLead({ id: lead.id, name: lead.name })}>
                        <LinkIcon className="h-3.5 w-3.5" />
                        Payment Link
                      </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleLeads.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{leadFunnelStage ? "No leads at this stage" : "No leads added yet"}</td></tr>}
              </tbody>
            </table>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="applications" className="mt-4 space-y-4">
          <ApplicationFunnelStrip
            items={applicationFunnelItems}
            activeStage={appFunnelStage}
            onStageClick={setAppFunnelStage}
          />
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Candidate</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Application</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Attribution</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Application Stage</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Payment</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Submitted</th>
              </tr></thead>
              <tbody>
                {visibleApplicationLeads.map((lead) => {
                  const completed = isCompletedApplication(lead);
                  const isPartnerAttributed = lead.academic_partner_id === partner.id;
                  return (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3"><div className="font-medium">{lead.name}</div><div className="text-xs text-muted-foreground">{lead.phone}</div></td>
                    <td className="px-4 py-3"><div>{lead.course_name}</div><div className="text-xs text-muted-foreground">{lead.campus_name}</div></td>
                    <td className="px-4 py-3 min-w-[300px]">
                      <div className="font-medium">{lead.application_id || "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        Status: {lead.application_status || "not started"}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {/* Primary action: the partner's own on-behalf application flow. */}
                        {isPartnerAttributed && (
                          <ApplyMagicLinkButton
                            leadId={lead.id}
                            leadName={lead.name}
                            leadPhone={lead.phone}
                            mode="academic_partner_on_behalf"
                            label={completed ? "Open Application" : lead.application_id ? "Continue Application" : "Complete Application"}
                            directOpen
                          />
                        )}
                        {isPartnerAttributed && (
                          <Button size="sm" variant="outline" className="gap-2" onClick={() => placeCloudCall(lead)} disabled={callingLeadId === lead.id}>
                            {callingLeadId === lead.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
                            Call
                          </Button>
                        )}
                        {canIssueOfferLetters && lead.application_id && lead.course_id && (
                          <Button size="sm" className="gap-2 bg-teal-600 hover:bg-teal-700" onClick={() => setOfferLead(lead)}>
                            <Gift className="h-3.5 w-3.5" />
                            {lead.has_offer ? "View Offer" : "Issue Offer"}
                          </Button>
                        )}
                        {/* Everything secondary collapses into one compact menu. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="gap-1 px-2">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              More
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onSelect={() => setDetailsLead(lead)}>
                              <FileText className="h-3.5 w-3.5" /> View details
                            </DropdownMenuItem>
                            {completed && lead.application_form_pdf_url && (
                              <DropdownMenuItem asChild>
                                <a href={lead.application_form_pdf_url} target="_blank" rel="noreferrer">
                                  <FileText className="h-3.5 w-3.5" /> View/Download PDF
                                </a>
                              </DropdownMenuItem>
                            )}
                            {isPartnerAttributed && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={!lead.phone}
                                  onSelect={() => setLoginLinkLead({ id: lead.id, name: lead.name, phone: lead.phone })}
                                >
                                  <LinkIcon className="h-3.5 w-3.5" /> Send login link to candidate
                                </DropdownMenuItem>
                                {completed && (
                                  <ApplyMagicLinkButton
                                    leadId={lead.id}
                                    leadName={lead.name}
                                    leadPhone={lead.phone}
                                    mode="academic_partner_on_behalf"
                                    label="Start New Application"
                                    startNew
                                    directOpen
                                    asMenuItem
                                  />
                                )}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`border-0 text-[10px] ${attributionBadge(lead.attribution_type)}`}>
                        {attributionLabel(lead, partner.id)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`border-0 text-[10px] ${statusBadge(lead.application_status || lead.application_stage || "")}`}>
                        {lead.application_stage || "Not Started"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`border-0 text-[10px] ${statusBadge(lead.application_payment_status || "pending")}`}>
                        {lead.application_payment_status || "pending"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {lead.application_submitted_at ? new Date(lead.application_submitted_at).toLocaleDateString("en-IN") : "-"}
                    </td>
                  </tr>
                  );
                })}
                {visibleApplicationLeads.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{appFunnelStage ? "No applications at this stage" : canIssueOfferLetters ? "No paid applications found for assigned courses" : "No applications found for assigned leads"}</td></tr>}
              </tbody>
            </table>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Batch</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Fee Paid</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Attendance</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {students.map((student) => {
                  const fee = feeByStudent.get(student.id);
                  const att = attendanceByStudent.get(student.id);
                  const receiptCount = student.lead_id ? (receiptsByLead.get(student.lead_id)?.length || 0) : 0;
                  return (
                    <tr key={student.id} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admission_no || student.phone || "-"}</div></td>
                      <td className="px-4 py-3">{student.course_name}</td>
                      <td className="px-4 py-3">{student.batch_name}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">{fmt(fee?.paid)}</div>
                        {receiptCount > 0 ? (
                          <button onClick={() => setFeeDetailsStudentId(student.id)} className="text-xs text-primary hover:underline">
                            {receiptCount} receipt{receiptCount === 1 ? "" : "s"}
                          </button>
                        ) : (
                          <div className="text-xs text-muted-foreground">Balance {fmt(fee?.balance)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center"><div className="font-medium">{attendancePercent(att?.present || 0, att?.total || 0)}</div><div className="text-xs text-muted-foreground">{att?.present || 0}/{att?.total || 0} present</div></td>
                      <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(student.status)}`}>{student.status}</Badge></td>
                    </tr>
                  );
                })}
                {students.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No assigned students found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="fees" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden mb-4"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Total Fee</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Collected</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Balance</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Terms</th>
              </tr></thead>
              <tbody>
                {Array.from(feeByStudent.entries()).map(([studentId, summary]) => {
                  const fee = fees.find((row) => row.student_id === studentId);
                  return (
                    <tr key={studentId} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{fee?.student_name || "-"}</div><div className="text-xs text-muted-foreground">{fee?.student_admission_no || "-"}</div></td>
                      <td className="px-4 py-3 text-right">{fmt(summary.total)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-success">{fmt(summary.paid)}</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.balance)}</td>
                      <td className="px-4 py-3 text-center">
                        <Button size="sm" variant="outline" onClick={() => setFeeDetailsStudentId(studentId)}>
                          View {summary.rows}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {feeByStudent.size === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No fee collection found for assigned candidates</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden mb-4"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Batch</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Present</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Absent</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Late</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Attendance %</th>
              </tr></thead>
              <tbody>
                {students.map((student) => {
                  const att = attendanceByStudent.get(student.id) || { total: 0, present: 0, absent: 0, late: 0 };
                  return (
                    <tr key={student.id} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{student.name}</div><div className="text-xs text-muted-foreground">{student.admission_no || student.phone || "-"}</div></td>
                      <td className="px-4 py-3">{student.batch_name}</td>
                      <td className="px-4 py-3 text-center text-success font-medium">{att.present}</td>
                      <td className="px-4 py-3 text-center text-destructive font-medium">{att.absent}</td>
                      <td className="px-4 py-3 text-center text-warning-foreground font-medium">{att.late}</td>
                      <td className="px-4 py-3 text-center">{attendancePercent(att.present, att.total)}</td>
                    </tr>
                  );
                })}
                {students.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No assigned students found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>

          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Subject</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {attendance.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(row.date).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3"><div className="font-medium">{row.student_name}</div><div className="text-xs text-muted-foreground">{row.student_admission_no || row.batch_name}</div></td>
                    <td className="px-4 py-3">{row.subject || "-"}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(row.status)}`}>{row.status}</Badge></td>
                  </tr>
                ))}
                {attendance.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No attendance records found</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="payouts" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <Card className="shadow-none"><CardContent className="p-4 text-center"><p className="text-xl font-bold text-primary">{fmt(stats?.total_payout)}</p><p className="text-[11px] text-muted-foreground">Total Payout</p></CardContent></Card>
            <Card className="shadow-none"><CardContent className="p-4 text-center"><p className="text-xl font-bold text-warning">{fmt(stats?.pending_payout)}</p><p className="text-[11px] text-muted-foreground">Pending</p></CardContent></Card>
            <Card className="shadow-none"><CardContent className="p-4 text-center"><p className="text-xl font-bold text-success">{fmt(stats?.paid_payout)}</p><p className="text-[11px] text-muted-foreground">Paid</p></CardContent></Card>
          </div>
          <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Candidate</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Fee Paid</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Payout %</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Payout</th>
                <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{payout.student_name || payout.lead_name || "-"}</td>
                    <td className="px-4 py-3">{payout.course_name || "-"}</td>
                    <td className="px-4 py-3 text-right">{fmt(payout.fee_paid)}</td>
                    <td className="px-4 py-3 text-center">{Number(payout.payout_percentage || 0)}%</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(payout.payout_amount)}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(payout.status)}`}>{payout.status}</Badge></td>
                  </tr>
                ))}
                {payouts.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No payouts recorded yet</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="batches" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {assignments.map((assignment) => (
              <Card key={assignment.id} className="border-border/60 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{assignment.batch_name || "All Batches"}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{assignment.course_name}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{assignment.effective_payout_percentage}% payout</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-lg font-bold">{assignment.candidates}</p><p className="text-xs text-muted-foreground">Candidates</p></div>
                    <div><p className="text-lg font-bold">{fmt(assignment.fee_collected)}</p><p className="text-xs text-muted-foreground">Fee Collected</p></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          <LeadAssociationRequestsPanel requesterType="academic_partner" />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-5">
              <div className="max-w-xl space-y-6">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Partner Logo</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Displayed in the academic partner dashboard. Upload a PNG with a transparent background.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-border/60 bg-background p-2">
                      {renderPartnerLogo()}
                    </div>
                    {renderLogoUploadButton()}
                  </div>
                </div>
                <div className="border-t border-border/60 pt-5">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Cloud Call Settings</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cloud calls ring this calling agent number first, then bridge the lead or application candidate.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="academic-partner-agent-phone" className="text-xs font-medium uppercase text-muted-foreground">
                    Calling agent number
                  </label>
                  <PhoneInput
                    id="academic-partner-agent-phone"
                    value={agentPhone}
                    onChange={setAgentPhone}
                    placeholder="Enter calling agent number"
                    disabled={profileLoading || savingAgentPhone}
                    aria-label="Calling agent number"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the phone number where Plivo should connect the academic partner before calling the candidate.
                  </p>
                </div>
                <Button onClick={saveCallingAgentPhone} disabled={profileLoading || savingAgentPhone} className="gap-2">
                  {savingAgentPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                  Save Calling Number
                </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!detailsLead} onOpenChange={(open) => !open && setDetailsLead(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Application Details</DialogTitle>
            <DialogDescription>
              {detailsLead?.name || "Candidate"} {detailsLead?.application_id ? `- ${detailsLead.application_id}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailsLead && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application ID</p>
                <p className="mt-1 font-medium">{detailsLead.application_id || "Not started"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application Stage</p>
                <p className="mt-1 font-medium">{detailsLead.application_stage || "Not Started"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application Status</p>
                <p className="mt-1 font-medium">{detailsLead.application_status || "not started"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Payment Status</p>
                <p className="mt-1 font-medium">{detailsLead.application_payment_status || "pending"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Attribution</p>
                <Badge className={`mt-1 border-0 text-[10px] ${attributionBadge(detailsLead.attribution_type)}`}>
                  {attributionLabel(detailsLead, partner.id)}
                </Badge>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Application Fee</p>
                <p className="mt-1 font-medium">{fmt(detailsLead.application_fee_amount)}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Form Progress</p>
                <p className="mt-1 font-medium">
                  {completedCount(detailsLead.application_completed_sections)}/{totalCount(detailsLead.application_completed_sections)} sections
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Course</p>
                <p className="mt-1 font-medium">{detailsLead.course_name}</p>
                <p className="text-xs text-muted-foreground">{detailsLead.campus_name}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Candidate Contact</p>
                <p className="mt-1 font-medium">{detailsLead.phone}</p>
                <p className="text-xs text-muted-foreground">{detailsLead.email || "-"}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Started</p>
                <p className="mt-1 font-medium">
                  {detailsLead.application_created_at ? new Date(detailsLead.application_created_at).toLocaleString("en-IN") : "-"}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">Submitted</p>
                <p className="mt-1 font-medium">
                  {detailsLead.application_submitted_at ? new Date(detailsLead.application_submitted_at).toLocaleString("en-IN") : "-"}
                </p>
              </div>
            </div>
          )}
          {detailsLead && (
            <DialogFooter className="gap-2 sm:gap-2">
              {detailsLead.academic_partner_id === partner.id && (
                <>
                  <Button variant="outline" className="gap-2" onClick={() => placeCloudCall(detailsLead)} disabled={callingLeadId === detailsLead.id}>
                    {callingLeadId === detailsLead.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                    Cloud Call
                  </Button>
                  <ApplyMagicLinkButton leadId={detailsLead.id} leadName={detailsLead.name} leadPhone={detailsLead.phone} directOpen />
                  <ApplyMagicLinkButton leadId={detailsLead.id} leadName={detailsLead.name} leadPhone={detailsLead.phone} />
                </>
              )}
              {canIssueOfferLetters && detailsLead.application_id && detailsLead.course_id && (
                <Button className="gap-2 bg-teal-600 hover:bg-teal-700" onClick={() => setOfferLead(detailsLead)}>
                  <Gift className="h-4 w-4" />
                  {detailsLead.has_offer ? "View Offer" : "Issue Offer"}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!feeDetailsStudentId} onOpenChange={(open) => { if (!open) setFeeDetailsStudentId(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Fee Terms &amp; Receipts</DialogTitle>
            <DialogDescription>
              {(() => {
                const s = students.find((st) => st.id === feeDetailsStudentId);
                const name = feeDetailsStudent?.student_name || s?.name || "Candidate";
                const idNo = feeDetailsStudent?.student_admission_no || s?.admission_no || "No admission number";
                return `${name} · ${idNo}`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Total Fee</p>
              <p className="mt-1 text-lg font-semibold">{fmt(feeDetailsSummary?.total)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Collected</p>
              <p className="mt-1 text-lg font-semibold text-success">{fmt(feeDetailsSummary?.paid)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] uppercase text-muted-foreground">Balance</p>
              <p className="mt-1 text-lg font-semibold">{fmt(feeDetailsSummary?.balance)}</p>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="border-b">
                  <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Term</th>
                  <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Due Date</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Total</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Paid</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Balance</th>
                  <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {feeDetailsRows.map((fee) => (
                  <tr key={fee.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{fee.fee_code_name ? `${fee.fee_code_name} - ${defaultFeeTermLabel(fee.term)}` : defaultFeeTermLabel(fee.term)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fee.due_date ? new Date(fee.due_date).toLocaleDateString("en-IN") : "-"}</td>
                    <td className="px-4 py-3 text-right">{fmt(fee.total_amount)}</td>
                    <td className="px-4 py-3 text-right">{fmt(fee.paid_amount)}</td>
                    <td className="px-4 py-3 text-right">{fmt(fee.balance)}</td>
                    <td className="px-4 py-3 text-center"><Badge className={`border-0 text-[10px] ${statusBadge(fee.status)}`}>{fee.status}</Badge></td>
                  </tr>
                ))}
                {feeDetailsRows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No fee terms found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Actual payment receipts (lead_payments) — what the candidate has
              paid, with downloadable receipts. */}
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-foreground">
              Fee Receipts{feeDetailsReceipts.length > 0 ? ` (${feeDetailsReceipts.length})` : ""}
            </p>
            <div className="max-h-[40vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Receipt No.</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Type</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Date</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Mode</th>
                    <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Amount</th>
                    <th className="px-4 py-3 text-center text-xs uppercase text-muted-foreground">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {feeDetailsReceipts.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{r.receipt_no || "—"}</td>
                      <td className="px-4 py-3 capitalize">{(r.type || "").replace(/_/g, " ") || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{(r.payment_date || r.created_at) ? new Date(r.payment_date || r.created_at).toLocaleDateString("en-IN") : "-"}</td>
                      <td className="px-4 py-3 text-xs capitalize">{(r.payment_mode || "").replace(/_/g, " ") || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(r.amount)}</td>
                      <td className="px-4 py-3 text-center">
                        {r.receipt_url ? (
                          <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" /> View
                          </a>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                  {feeDetailsReceipts.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No fee receipts recorded yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {offerLead && (
        <OfferLetterDialog
          open={!!offerLead}
          onOpenChange={(open) => !open && setOfferLead(null)}
          leadId={offerLead.id}
          leadName={offerLead.name}
          applicationId={offerLead.application_id}
          academicPartnerId={partner.id}
          courseId={offerLead.course_id}
          courseName={offerLead.course_name}
          campusId={offerLead.campus_id}
          onSuccess={() => {
            setOfferLead(null);
            void fetchPortal(partner.id);
          }}
        />
      )}

      {payLinkLead && (
        <SendPaymentLinkDialog
          open={!!payLinkLead}
          onOpenChange={(open) => !open && setPayLinkLead(null)}
          leadId={payLinkLead.id}
          defaultPurpose="pre_admission_token"
          onCreated={() => { void fetchPortal(partner.id); }}
        />
      )}

      {loginLinkLead && (
        <ApplyMagicLinkButton
          leadId={loginLinkLead.id}
          leadName={loginLinkLead.name}
          leadPhone={loginLinkLead.phone}
          controlledOpen={!!loginLinkLead}
          onControlledOpenChange={(open) => !open && setLoginLinkLead(null)}
        />
      )}

      <Dialog open={showAddLead} onOpenChange={setShowAddLead}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
            <DialogDescription>Capture a lead for one of your assigned courses.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="academic-partner-lead-name" className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input id="academic-partner-lead-name" value={leadForm.name} onChange={(e) => setLeadForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label htmlFor="academic-partner-lead-phone" className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
                <PhoneInput id="academic-partner-lead-phone" aria-label="Phone" value={leadForm.phone} onChange={(phone) => setLeadForm((p) => ({ ...p, phone }))} required />
              </div>
            </div>
            <div>
              <label htmlFor="academic-partner-lead-email" className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
              <input id="academic-partner-lead-email" type="email" value={leadForm.email} onChange={(e) => setLeadForm((p) => ({ ...p, email: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label htmlFor="academic-partner-lead-course" className="block text-[11px] font-medium text-muted-foreground mb-1">Course *</label>
              <select id="academic-partner-lead-course" value={leadForm.course_id} onChange={(e) => setLeadForm((p) => ({ ...p, course_id: e.target.value }))} className={inputCls}>
                <option value="">Select course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="academic-partner-lead-notes" className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea id="academic-partner-lead-notes" rows={2} value={leadForm.notes} onChange={(e) => setLeadForm((p) => ({ ...p, notes: e.target.value }))} className={inputCls} />
            </div>
            <label htmlFor="academic-partner-lead-share" className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 cursor-pointer">
              <input
                id="academic-partner-lead-share"
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={leadForm.share_with_nimt}
                onChange={(e) => setLeadForm((p) => ({ ...p, share_with_nimt: e.target.checked }))}
              />
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Share with NIMT admissions team</span>
                <br />
                Let NIMT counsellors call this lead. This also enables the automated AI call and WhatsApp
                follow-ups. Leave unchecked to keep the lead private to your portal (no calls or messages).
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLead(false)}>Cancel</Button>
            <Button onClick={handleAddLead} disabled={saving || !leadForm.name.trim() || !leadForm.phone.trim() || !leadForm.course_id} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Add Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

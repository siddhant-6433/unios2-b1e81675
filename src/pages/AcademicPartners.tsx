import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  IndianRupee,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { LeadAssociationRequestsPanel } from "@/components/admissions/LeadAssociationRequestsPanel";

type Partner = {
  id: string;
  user_id: string | null;
  name: string;
  organization: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  default_payout_percentage: number;
  minimum_guarantee_year1: number;
  minimum_guarantee_year2: number;
  minimum_guarantee_year3: number;
  lock_in_years: number;
  lock_in_start_date: string | null;
  notes: string | null;
  logo_url: string | null;
  company_name: string | null;
  company_address: string | null;
  pan_number: string | null;
  gst_number: string | null;
  tan_number: string | null;
  authorised_signatory_name: string | null;
  authorised_signatory_contact: string | null;
  authorised_signatory_email: string | null;
  onboarding_status: string;
  onboarding_step: number;
  logo_file_path: string | null;
  logo_uploaded_at: string | null;
};

type Dashboard = {
  partner_id: string;
  partner_name: string;
  organization: string | null;
  status: string;
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
  minimum_guarantee_year1: number;
  minimum_guarantee_year2: number;
  minimum_guarantee_year3: number;
  lock_in_years: number;
  lock_in_start_date: string | null;
};

type PartnerStudent = {
  partner_id: string;
  student_id: string;
  lead_id: string | null;
  student_name: string;
  admission_no: string | null;
  status: string;
  course_name: string | null;
  batch_name: string | null;
  fee_total: number;
  fee_paid: number;
  fee_balance: number;
};
type PartnerStudentsClient = {
  from: (
    table: "academic_partner_students",
  ) => {
    select: (columns: string) => {
      order: (
        column: string,
        options?: { ascending?: boolean },
      ) => Promise<{ data: PartnerStudent[] | null; error: { message: string } | null }>;
    };
  };
};

type Assignment = {
  id: string;
  partner_id: string;
  course_id: string;
  course_name: string;
  batch_id: string | null;
  batch_name: string | null;
  effective_payout_percentage: number;
  candidates: number;
  fee_collected: number;
};

type PartnerRole = { user_id: string };
type PartnerDocument = {
  id: string;
  partner_id: string;
  document_type: string;
  title: string;
  file_name: string;
  file_path: string;
  created_at: string;
};
type PartnerDocumentsClient = {
  from: (
    table: "academic_partner_documents",
  ) => {
    select: (columns: string) => {
      order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: PartnerDocument[] | null; error: { message: string } | null }>;
    };
  };
};
type OnboardingStatus = "not_started" | "in_progress" | "skipped" | "completed";
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
type PayoutConfirmation = {
  kind: "partner" | "assignment" | "assignment_update";
  title: string;
  description: string;
};
type AdminOnboardingUpdate = {
  company_name: string | null;
  company_address: string | null;
  pan_number: string | null;
  gst_number: string | null;
  tan_number?: string | null;
  authorised_signatory_name: string | null;
  authorised_signatory_contact: string | null;
  authorised_signatory_email: string | null;
  onboarding_status: OnboardingStatus;
  onboarding_step: number;
  onboarding_skipped_at?: string | null;
  onboarding_completed_at?: string | null;
  updated_at: string;
};
type AdminOnboardingClient = {
  from: {
    (table: "academic_partners"): {
      update: (row: AdminOnboardingUpdate) => { eq: (column: "id", value: string) => Promise<{ error: OperationError | null }> };
    };
    (table: "academic_partner_documents"): {
      insert: (row: {
        partner_id: string;
        document_type: OnboardingDocType;
        title: string;
        file_name: string;
        file_path: string;
        content_type: string | null;
        file_size_bytes: number;
        visibility: "internal";
        uploaded_by: string | null;
      }) => Promise<{ error: OperationError | null }>;
    };
  };
};
type LeadOption = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  stage: string;
  course_id: string | null;
  academic_partner_id: string | null;
  consultant_id: string | null;
  courses?: { name: string } | null;
};
type AssignOwnerRpcClient = {
  rpc: (
    fn: "assign_lead_external_owner",
    args: {
      _lead_id: string;
      _owner_type: "academic_partner";
      _consultant_id: null;
      _academic_partner_id: string;
    },
  ) => Promise<{ error: { message: string } | null }>;
};

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
const fmt = (n: number | string | null | undefined) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const getPartnerInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};
const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Please try again.";
};
const docTypeLabel: Record<string, string> = {
  agreement: "Agreement",
  gst: "GST",
  pan: "PAN",
  tan: "TAN",
  fee_structure: "Fee Structure",
  brochure: "Brochure",
  additional: "Additional",
};
const humanize = (value: string | null | undefined) =>
  (value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown";
const stageBadgeClass = (stage: string | null | undefined) => {
  if (stage === "admitted") return "bg-success/10 text-success";
  if (stage === "rejected" || stage === "lost") return "bg-destructive/10 text-destructive";
  return "bg-sky-100 text-sky-700";
};
const studentStatusBadgeClass = (status: string | null | undefined) => {
  if (status === "active") return "bg-success/10 text-success";
  if (status === "inactive" || status === "dropped") return "bg-destructive/10 text-destructive";
  return "bg-warning/10 text-warning-foreground";
};
const ONBOARDING_STEPS = ["Company", "Tax", "Signatory", "Documents"] as const;
const ONBOARDING_DOC_TYPES: { value: OnboardingDocType; label: string; required?: boolean }[] = [
  { value: "agreement", label: "Agreement", required: true },
  { value: "gst", label: "GST Certificate" },
  { value: "pan", label: "PAN Card", required: true },
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
  company_name: partner?.company_name || partner?.organization || "",
  company_address: partner?.company_address || "",
  pan_number: partner?.pan_number || "",
  gst_number: partner?.gst_number || "",
  tan_number: partner?.tan_number || "",
  authorised_signatory_name: partner?.authorised_signatory_name || "",
  authorised_signatory_contact: partner?.authorised_signatory_contact || partner?.phone || "",
  authorised_signatory_email: partner?.authorised_signatory_email || partner?.email || "",
});
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
const isTanSchemaCacheError = (error: OperationError | null) =>
  Boolean(error?.message && /tan_number|_tan_number|schema cache/i.test(error.message));
const isTanDocumentTypeConstraintError = (error: OperationError | null) =>
  Boolean(error?.message && /document_type|academic_partner_documents_document_type_check|check constraint/i.test(error.message));
const normalizeStatus = (status: string | null | undefined): OnboardingStatus => {
  if (status === "in_progress" || status === "skipped" || status === "completed") return status;
  return "not_started";
};
const onboardingActionLabel = (status: string | null | undefined) => {
  const safeStatus = normalizeStatus(status);
  if (safeStatus === "not_started") return "Start Onboarding";
  if (safeStatus === "completed") return "Edit Onboarding";
  return "Resume Onboarding";
};

export default function AcademicPartners() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const canManagePayout = role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [partnerDocuments, setPartnerDocuments] = useState<PartnerDocument[]>([]);
  const [partnerStudents, setPartnerStudents] = useState<PartnerStudent[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string; course_id: string }[]>([]);
  const [partnerUsers, setPartnerUsers] = useState<{ user_id: string; display_name: string | null; email: string | null }[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showAssignment, setShowAssignment] = useState(false);
  const [showLeadAssignment, setShowLeadAssignment] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPayoutEdit, setShowPayoutEdit] = useState(false);
  const [detailPartnerId, setDetailPartnerId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignmentPartnerId, setAssignmentPartnerId] = useState<string | null>(null);
  const [leadAssignmentPartnerId, setLeadAssignmentPartnerId] = useState<string | null>(null);
  const [onboardingPartnerId, setOnboardingPartnerId] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>(() => onboardingFormFromPartner(null));
  const [onboardingFiles, setOnboardingFiles] = useState<OnboardingFiles>(() => emptyOnboardingFiles());
  const [payoutConfirmation, setPayoutConfirmation] = useState<PayoutConfirmation | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    organization: "",
    phone: "",
    email: "",
    status: "active",
    default_payout_percentage: "0",
    minimum_guarantee_year1: "0",
    minimum_guarantee_year2: "0",
    minimum_guarantee_year3: "0",
    user_id: "",
    notes: "",
    logo_url: "",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [assignmentForm, setAssignmentForm] = useState({ course_id: "", batch_id: "", payout_percentage: "" });
  const [leadAssignmentForm, setLeadAssignmentForm] = useState({ lead_id: "" });
  const [payoutEditAssignment, setPayoutEditAssignment] = useState<Assignment | null>(null);
  const [payoutEditValue, setPayoutEditValue] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    const [partnersRes, dashboardRes, assignmentsRes, coursesRes, batchesRes, rolesRes, leadsRes, documentsRes, studentsRes] = await Promise.all([
      supabase.from("academic_partners").select("*").order("created_at", { ascending: false }),
      supabase.from("academic_partner_dashboard").select("*").order("partner_name"),
      supabase.from("academic_partner_assignment_summary").select("*").order("course_name"),
      supabase.from("courses").select("id, name").order("name"),
      supabase.from("batches").select("id, name, course_id").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "academic_partner"),
      supabase
        .from("leads")
        .select("id, name, phone, email, stage, course_id, academic_partner_id, consultant_id, courses:course_id(name)")
        .order("created_at", { ascending: false })
        .limit(500),
      (supabase as unknown as PartnerDocumentsClient)
        .from("academic_partner_documents")
        .select("id, partner_id, document_type, title, file_name, file_path, created_at")
        .order("created_at", { ascending: false }),
      (supabase as unknown as PartnerStudentsClient)
        .from("academic_partner_students")
        .select("partner_id, student_id, lead_id, student_name, admission_no, status, course_name, batch_name, fee_total, fee_paid, fee_balance")
        .order("created_at", { ascending: false }),
    ]);

    const roleUserIds = ((rolesRes.data || []) as PartnerRole[]).map((r) => r.user_id);
    let profiles: { user_id: string; display_name: string | null; email: string | null }[] = [];
    if (roleUserIds.length > 0) {
      const { data } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", roleUserIds);
      profiles = data || [];
    }

    setPartners((partnersRes.data || []) as Partner[]);
    setDashboard((dashboardRes.data || []) as Dashboard[]);
    setAssignments((assignmentsRes.data || []) as Assignment[]);
    setPartnerDocuments((documentsRes.data || []) as PartnerDocument[]);
    setPartnerStudents((studentsRes.data || []) as PartnerStudent[]);
    setLeads((leadsRes.data || []) as LeadOption[]);
    setCourses(coursesRes.data || []);
    setBatches((batchesRes.data || []) as { id: string; name: string; course_id: string }[]);
    setPartnerUsers(profiles);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const dashboardByPartner = useMemo(() => {
    const map = new Map<string, Dashboard>();
    dashboard.forEach((d) => map.set(d.partner_id, d));
    return map;
  }, [dashboard]);

  const documentsByPartner = useMemo(() => {
    const map = new Map<string, PartnerDocument[]>();
    partnerDocuments.forEach((document) => {
      map.set(document.partner_id, [...(map.get(document.partner_id) || []), document]);
    });
    return map;
  }, [partnerDocuments]);

  const studentsByPartner = useMemo(() => {
    const map = new Map<string, PartnerStudent[]>();
    partnerStudents.forEach((student) => {
      map.set(student.partner_id, [...(map.get(student.partner_id) || []), student]);
    });
    return map;
  }, [partnerStudents]);

  const leadsByPartner = useMemo(() => {
    const map = new Map<string, LeadOption[]>();
    leads.forEach((lead) => {
      if (!lead.academic_partner_id) return;
      map.set(lead.academic_partner_id, [...(map.get(lead.academic_partner_id) || []), lead]);
    });
    return map;
  }, [leads]);

  const filtered = partners.filter((partner) => {
    const q = search.toLowerCase();
    return !q || partner.name.toLowerCase().includes(q) || (partner.organization || "").toLowerCase().includes(q) || (partner.email || "").toLowerCase().includes(q);
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(null);
    setForm({ name: "", organization: "", phone: "", email: "", status: "active", default_payout_percentage: "0", minimum_guarantee_year1: "0", minimum_guarantee_year2: "0", minimum_guarantee_year3: "0", user_id: "", notes: "", logo_url: "" });
  };

  const openEdit = (partner: Partner) => {
    setEditingId(partner.id);
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(partner.logo_url || null);
    setForm({
      name: partner.name,
      organization: partner.organization || "",
      phone: partner.phone || "",
      email: partner.email || "",
      status: partner.status,
      default_payout_percentage: String(partner.default_payout_percentage || 0),
      minimum_guarantee_year1: String(partner.minimum_guarantee_year1 || 0),
      minimum_guarantee_year2: String(partner.minimum_guarantee_year2 || 0),
      minimum_guarantee_year3: String(partner.minimum_guarantee_year3 || 0),
      user_id: partner.user_id || "",
      notes: partner.notes || "",
      logo_url: partner.logo_url || "",
    });
    setShowForm(true);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const handleLogoPick = (file: File | null) => {
    if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(file ? URL.createObjectURL(file) : form.logo_url || null);
  };

  const uploadLogo = async () => {
    if (!logoFile) return form.logo_url || null;
    if (logoFile.type !== "image/png") {
      throw new Error("Please upload a transparent PNG logo.");
    }
    const safeName = (form.organization || form.name || "academic-partner")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      || "academic-partner";
    const path = `academic-partner-logos/${safeName}-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("application-documents")
      .upload(path, logoFile, { contentType: "image/png", upsert: true });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from("application-documents").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSave = async (confirmedPayoutChange = false) => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const currentPartner = editingId ? partners.find((partner) => partner.id === editingId) : null;
    const nextDefaultPayout = Number(form.default_payout_percentage) || 0;
    const currentDefaultPayout = Number(currentPartner?.default_payout_percentage || 0);
    const isPayoutChange = canManagePayout && (
      editingId ? nextDefaultPayout !== currentDefaultPayout : nextDefaultPayout > 0
    );
    if (isPayoutChange && !confirmedPayoutChange) {
      setPayoutConfirmation({
        kind: "partner",
        title: editingId ? "Confirm default payout change" : "Confirm default payout",
        description: editingId
          ? `Change default payout from ${currentDefaultPayout}% to ${nextDefaultPayout}% for ${form.name.trim()}?`
          : `Create ${form.name.trim()} with a ${nextDefaultPayout}% default payout?`,
      });
      return;
    }
    setSaving(true);
    try {
      const logoUrl = await uploadLogo();
      const payload = {
        name: form.name.trim(),
        organization: form.organization.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        status: form.status,
        default_payout_percentage: canManagePayout ? nextDefaultPayout : currentDefaultPayout,
        minimum_guarantee_year1: canManagePayout ? Number(form.minimum_guarantee_year1) || 0 : (currentPartner?.minimum_guarantee_year1 ?? 0),
        minimum_guarantee_year2: canManagePayout ? Number(form.minimum_guarantee_year2) || 0 : (currentPartner?.minimum_guarantee_year2 ?? 0),
        minimum_guarantee_year3: canManagePayout ? Number(form.minimum_guarantee_year3) || 0 : (currentPartner?.minimum_guarantee_year3 ?? 0),
        user_id: form.user_id || null,
        notes: form.notes.trim() || null,
        logo_url: logoUrl,
      };
      const { error } = editingId
        ? await supabase.from("academic_partners").update(payload).eq("id", editingId)
        : await supabase.from("academic_partners").insert(payload);
      if (error) throw error;
      toast({ title: editingId ? "Academic partner updated" : "Academic partner added" });
      resetForm();
      await fetchAll();
    } catch (error: unknown) {
      toast({ title: "Save failed", description: errorMessage(error), variant: "destructive" });
    }
    setSaving(false);
  };

  const openAssignment = (partnerId: string) => {
    setAssignmentPartnerId(partnerId);
    setAssignmentForm({ course_id: "", batch_id: "", payout_percentage: "" });
    setShowAssignment(true);
  };

  const openLeadAssignment = (partnerId: string) => {
    setLeadAssignmentPartnerId(partnerId);
    setLeadAssignmentForm({ lead_id: "" });
    setShowLeadAssignment(true);
  };

  const openPayoutEdit = (assignment: Assignment) => {
    if (!canManagePayout) return;
    setPayoutEditAssignment(assignment);
    setPayoutEditValue(String(Number(assignment.effective_payout_percentage || 0)));
    setShowPayoutEdit(true);
  };

  const openOnboarding = (partner: Partner, step?: number) => {
    setOnboardingPartnerId(partner.id);
    setOnboardingForm(onboardingFormFromPartner(partner));
    setOnboardingStep(Math.max(0, Math.min(step ?? Number(partner.onboarding_step || 0), ONBOARDING_STEPS.length - 1)));
    setOnboardingFiles(emptyOnboardingFiles());
    setShowOnboarding(true);
  };

  const openAssignmentFromForm = () => {
    if (!editingId) return;
    const partnerId = editingId;
    resetForm();
    openAssignment(partnerId);
  };

  const openLeadAssignmentFromForm = () => {
    if (!editingId) return;
    const partnerId = editingId;
    resetForm();
    openLeadAssignment(partnerId);
  };

  const handleAddAssignment = async (confirmedPayoutChange = false) => {
    if (!assignmentPartnerId || !assignmentForm.course_id) return;
    const payoutOverride = assignmentForm.payout_percentage ? Number(assignmentForm.payout_percentage) : null;
    if (canManagePayout && payoutOverride !== null && !confirmedPayoutChange) {
      setPayoutConfirmation({
        kind: "assignment",
        title: "Confirm payout override",
        description: `Set a ${payoutOverride}% payout override for this course or batch assignment?`,
      });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("academic_partner_assignments").insert({
      partner_id: assignmentPartnerId,
      course_id: assignmentForm.course_id,
      batch_id: assignmentForm.batch_id || null,
      payout_percentage: canManagePayout ? payoutOverride : null,
      is_active: true,
    });
    if (error) {
      toast({ title: "Assignment failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Assignment added" });
      setShowAssignment(false);
      await fetchAll();
    }
    setSaving(false);
  };

  const handleUpdateAssignmentPayout = async (confirmedPayoutChange = false) => {
    if (!canManagePayout || !payoutEditAssignment) return;
    const nextPayout = payoutEditValue.trim() ? Number(payoutEditValue) : null;
    const currentPayout = Number(payoutEditAssignment.effective_payout_percentage || 0);
    if (!confirmedPayoutChange) {
      setPayoutConfirmation({
        kind: "assignment_update",
        title: "Confirm assignment payout change",
        description: `Change payout from ${currentPayout}% to ${nextPayout ?? "partner default"} for ${payoutEditAssignment.batch_name || "all batches"}?`,
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("academic_partner_assignments")
      .update({ payout_percentage: nextPayout })
      .eq("id", payoutEditAssignment.id);
    if (error) {
      toast({ title: "Payout not updated", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Payout updated" });
      setShowPayoutEdit(false);
      setPayoutEditAssignment(null);
      setPayoutEditValue("");
      await fetchAll();
    }
    setSaving(false);
  };

  const handleAssignLead = async () => {
    if (!leadAssignmentPartnerId || !leadAssignmentForm.lead_id) return;
    setSaving(true);
    const assignOwnerClient = supabase as unknown as AssignOwnerRpcClient;
    const { error } = await assignOwnerClient.rpc("assign_lead_external_owner", {
      _lead_id: leadAssignmentForm.lead_id,
      _owner_type: "academic_partner",
      _consultant_id: null,
      _academic_partner_id: leadAssignmentPartnerId,
    });
    if (error) {
      toast({ title: "Lead assignment failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Lead assigned to academic partner" });
      setShowLeadAssignment(false);
      await fetchAll();
    }
    setSaving(false);
  };

  const openPartnerDocument = async (document: PartnerDocument) => {
    const { data, error } = await supabase.storage
      .from("academic-partner-documents")
      .createSignedUrl(document.file_path, 60 * 30);
    if (error || !data?.signedUrl) {
      toast({ title: "Document unavailable", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const updateOnboardingField = (field: keyof OnboardingForm, value: string) => {
    setOnboardingForm((current) => ({ ...current, [field]: value }));
  };

  const setOnboardingDocuments = (documentType: OnboardingDocType, fileList: FileList | null) => {
    setOnboardingFiles((current) => ({ ...current, [documentType]: Array.from(fileList || []) }));
  };

  const validateOnboardingForCompletion = () => {
    if (!onboardingForm.company_name.trim()) return "Company name is required.";
    if (!onboardingForm.company_address.trim()) return "Company address is required.";
    if (!onboardingForm.pan_number.trim()) return "PAN is required.";
    if (!onboardingForm.authorised_signatory_name.trim()) return "Authorised signatory name is required.";
    if (!onboardingForm.authorised_signatory_contact.trim()) return "Authorised signatory contact number is required.";
    if (!onboardingForm.authorised_signatory_email.trim()) return "Authorised signatory email is required.";
    return null;
  };

  const uploadOnboardingDocuments = async (partnerId: string) => {
    const selected = ONBOARDING_DOC_TYPES.flatMap(({ value, label }) =>
      onboardingFiles[value].map((file) => ({ file, documentType: value, label })),
    );
    if (selected.length === 0) return;

    const onboardingClient = supabase as unknown as AdminOnboardingClient;
    for (const { file, documentType, label } of selected) {
      const path = `${partnerId}/${Date.now()}-${documentType}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("academic-partner-documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (uploadError) throw uploadError;

      const documentRecord = {
        partner_id: partnerId,
        document_type: documentType,
        title: label,
        file_name: file.name,
        file_path: path,
        content_type: file.type || null,
        file_size_bytes: file.size,
        visibility: "internal",
        uploaded_by: user?.id || null,
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

  const adminOnboardingPayload = (status: OnboardingStatus, nextStep: number, now: string, includeTan = true): AdminOnboardingUpdate => ({
    company_name: onboardingForm.company_name.trim() || null,
    company_address: onboardingForm.company_address.trim() || null,
    pan_number: onboardingForm.pan_number.trim().toUpperCase() || null,
    gst_number: onboardingForm.gst_number.trim().toUpperCase() || null,
    ...(includeTan ? { tan_number: onboardingForm.tan_number.trim().toUpperCase() || null } : {}),
    authorised_signatory_name: onboardingForm.authorised_signatory_name.trim() || null,
    authorised_signatory_contact: onboardingForm.authorised_signatory_contact.trim() || null,
    authorised_signatory_email: onboardingForm.authorised_signatory_email.trim().toLowerCase() || null,
    onboarding_status: status,
    onboarding_step: Math.max(0, Math.min(nextStep, ONBOARDING_STEPS.length - 1)),
    onboarding_skipped_at: status === "skipped" ? now : undefined,
    onboarding_completed_at: status === "completed" ? now : undefined,
    updated_at: now,
  });

  const saveAdminOnboarding = async (status: OnboardingStatus, closeAfterSave = false, nextStep = onboardingStep) => {
    if (!onboardingPartnerId) return;
    const validationError = status === "completed" ? validateOnboardingForCompletion() : null;
    if (validationError) {
      toast({ title: "Onboarding incomplete", description: validationError, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await uploadOnboardingDocuments(onboardingPartnerId);
      const now = new Date().toISOString();
      const onboardingClient = supabase as unknown as AdminOnboardingClient;
      let { error } = await onboardingClient.from("academic_partners")
        .update(adminOnboardingPayload(status, nextStep, now))
        .eq("id", onboardingPartnerId);
      const tanDeferred = Boolean(error && isTanSchemaCacheError(error));
      if (tanDeferred) {
        const retry = await onboardingClient.from("academic_partners")
          .update(adminOnboardingPayload(status, nextStep, now, false))
          .eq("id", onboardingPartnerId);
        error = retry.error;
      }
      if (error) throw error;

      toast({
        title: status === "completed" ? "Onboarding completed" : status === "skipped" ? "Onboarding skipped" : "Onboarding saved",
        description: tanDeferred && onboardingForm.tan_number.trim()
          ? "TAN was not saved because the database migration is not applied yet."
          : undefined,
      });
      await fetchAll();
      if (closeAfterSave) setShowOnboarding(false);
    } catch (error: unknown) {
      toast({ title: "Onboarding not saved", description: errorMessage(error), variant: "destructive" });
    }
    setSaving(false);
  };

  const goToOnboardingStep = async (step: number) => {
    const safeStep = Math.max(0, Math.min(step, ONBOARDING_STEPS.length - 1));
    setOnboardingStep(safeStep);
    await saveAdminOnboarding("in_progress", false, safeStep);
  };

  const filteredBatches = batches.filter((batch) => batch.course_id === assignmentForm.course_id);
  const editingAssignments = editingId ? assignments.filter((a) => a.partner_id === editingId) : [];
  const selectedAssignmentPartner = assignmentPartnerId ? partners.find((partner) => partner.id === assignmentPartnerId) : null;
  const selectedLeadPartner = leadAssignmentPartnerId ? partners.find((partner) => partner.id === leadAssignmentPartnerId) : null;
  const selectedOnboardingPartner = onboardingPartnerId ? partners.find((partner) => partner.id === onboardingPartnerId) : null;
  const selectedLead = leads.find((lead) => lead.id === leadAssignmentForm.lead_id);
  const assignableLeads = leads.filter((lead) => !leadAssignmentPartnerId || lead.academic_partner_id !== leadAssignmentPartnerId);
  const totals = {
    partners: partners.length,
    candidates: dashboard.reduce((sum, row) => sum + Number(row.total_candidates || 0), 0),
    fee: dashboard.reduce((sum, row) => sum + Number(row.total_fee_collected || 0), 0),
    payout: dashboard.reduce((sum, row) => sum + Number(row.pending_payout || 0), 0),
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Academic Partners</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage batch ownership, admissions access, and partner payouts</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Add Partner</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Partners", value: totals.partners, icon: Users, bg: "bg-pastel-blue" },
          { label: "Candidates", value: totals.candidates, icon: GraduationCap, bg: "bg-pastel-green" },
          { label: "Fee Collected", value: fmt(totals.fee), icon: IndianRupee, bg: "bg-pastel-mint" },
          { label: "Pending Payout", value: fmt(totals.payout), icon: IndianRupee, bg: "bg-pastel-yellow" },
        ].map((item) => (
          <Card key={item.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${item.bg}`}>
                <item.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search partners..." className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
      </div>

      <Card className="border-border/60 shadow-none">
        <CardContent className="p-5">
          <LeadAssociationRequestsPanel requesterType="academic_partner" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filtered.map((partner) => {
          const row = dashboardByPartner.get(partner.id);
          const partnerAssignments = assignments.filter((a) => a.partner_id === partner.id);
          const partnerDocs = documentsByPartner.get(partner.id) || [];
          return (
            <Card key={partner.id} className="border-border/60 shadow-none">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 p-2">
                      {partner.logo_url ? (
                        <img src={partner.logo_url} alt={`${partner.name} logo`} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-sm font-semibold uppercase text-muted-foreground">
                          {getPartnerInitials(partner.company_name || partner.organization || partner.name)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">{partner.name}</h3>
                        {partner.user_id && <Badge className="border-0 bg-success/10 text-success text-[10px]">Linked</Badge>}
                        <Badge className={`border-0 text-[10px] ${partner.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{partner.status}</Badge>
                        {canManagePayout && <Badge variant="secondary" className="text-[10px]">{Number(partner.default_payout_percentage || 0)}% payout</Badge>}
                      </div>
                      {partner.organization && <p className="mt-0.5 text-sm text-primary">{partner.organization}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">{partner.email || partner.phone || "No contact details"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openAssignment(partner.id)}>
                      <Link2 className="h-3.5 w-3.5" /> Assign Course/Batch
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openLeadAssignment(partner.id)}>
                      <UserPlus className="h-3.5 w-3.5" /> Assign Lead
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDetailPartnerId(partner.id)}>
                      <Users className="h-3.5 w-3.5" /> Leads &amp; Students
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(partner)}><Pencil className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
                  <div><p className="text-lg font-bold">{row?.total_leads || 0}</p><p className="text-xs text-muted-foreground">Leads</p></div>
                  <div><p className="text-lg font-bold text-sky-600">{row?.pipeline || 0}</p><p className="text-xs text-muted-foreground">In Pipeline</p></div>
                  <div><p className="text-lg font-bold text-success">{row?.conversions || 0}</p><p className="text-xs text-muted-foreground">Admitted</p></div>
                  <div><p className="text-lg font-bold">{row?.total_candidates || 0}</p><p className="text-xs text-muted-foreground">Students</p></div>
                  <div><p className="text-lg font-bold">{fmt(row?.total_fee_collected)}</p><p className="text-xs text-muted-foreground">Fee</p></div>
                  <div><p className="text-lg font-bold">{fmt(row?.pending_payout)}</p><p className="text-xs text-muted-foreground">Pending Payout</p></div>
                </div>

                {canManagePayout && Number(partner.minimum_guarantee_year1 || 0) + Number(partner.minimum_guarantee_year2 || 0) + Number(partner.minimum_guarantee_year3 || 0) > 0 && (
                  <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">Minimum Guarantee · {Number(partner.default_payout_percentage || 0)}% payout</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Yr 1</span><p className="font-semibold">{fmt(partner.minimum_guarantee_year1)}</p></div>
                      <div><span className="text-muted-foreground">Yr 2</span><p className="font-semibold">{fmt(partner.minimum_guarantee_year2)}</p></div>
                      <div><span className="text-muted-foreground">Yr 3</span><p className="font-semibold">{fmt(partner.minimum_guarantee_year3)}</p></div>
                    </div>
                  </div>
                )}

                <div className="mt-4 border-t border-border/50 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> Onboarding
                    <Badge variant="secondary" className="ml-auto text-[10px]">{partner.onboarding_status || "not_started"}</Badge>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => openOnboarding(partner)}>
                      {normalizeStatus(partner.onboarding_status) === "not_started" ? <Plus className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                      {onboardingActionLabel(partner.onboarding_status)}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-border/60 px-3 py-2">
                      <p className="text-[11px] uppercase text-muted-foreground">Company</p>
                      <p className="mt-1 font-medium">{partner.company_name || partner.organization || "Not submitted"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{partner.company_address || "No registered address"}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 px-3 py-2">
                      <p className="text-[11px] uppercase text-muted-foreground">Tax IDs</p>
                      <p className="mt-1 text-xs"><span className="font-medium">PAN:</span> {partner.pan_number || "Not submitted"}</p>
                      <p className="mt-0.5 text-xs"><span className="font-medium">GST:</span> {partner.gst_number || "Not submitted"}</p>
                      <p className="mt-0.5 text-xs"><span className="font-medium">TAN:</span> {partner.tan_number || "Not submitted"}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 px-3 py-2 md:col-span-2">
                      <p className="text-[11px] uppercase text-muted-foreground">Authorised Signatory</p>
                      <p className="mt-1 font-medium">{partner.authorised_signatory_name || "Not submitted"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[partner.authorised_signatory_contact, partner.authorised_signatory_email].filter(Boolean).join(" · ") || "No contact details"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-border/60 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase text-muted-foreground">Internal documents</p>
                      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" onClick={() => openOnboarding(partner, 3)}>
                        <Upload className="h-3 w-3" /> Upload Documents
                      </Button>
                    </div>
                    {partnerDocs.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">No documents uploaded yet.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {partnerDocs.map((document) => (
                          <Button key={document.id} variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openPartnerDocument(document)}>
                            <FileText className="h-3.5 w-3.5" />
                            {docTypeLabel[document.document_type] || document.title}: {document.file_name}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t border-border/50 pt-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" /> Assignments
                    <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5 px-2 text-[11px]" onClick={() => openAssignment(partner.id)}>
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  </div>
                  {partnerAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No course or batch assignments yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {partnerAssignments.map((assignment) => (
                        <div key={assignment.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">{assignment.batch_name || "All batches"}</p>
                              <p className="text-xs text-muted-foreground">{assignment.course_name}</p>
                            </div>
                            {canManagePayout && (
                              <div className="flex items-center gap-1">
                                <Badge variant="secondary" className="text-[10px]">{Number(assignment.effective_payout_percentage || 0)}%</Badge>
                                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => openPayoutEdit(assignment)}>
                                  <Pencil className="h-3 w-3" /> Edit Payout
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{assignment.candidates} candidates</span>
                            <span>{fmt(assignment.fee_collected)} collected</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="col-span-full py-12 text-center text-sm text-muted-foreground">No academic partners found</div>}
      </div>

      <Dialog open={showForm} onOpenChange={(open) => { if (!open && !saving) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Academic Partner" : "Add Academic Partner"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Organization</label>
                <input value={form.organization} onChange={(e) => setForm((p) => ({ ...p, organization: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone</label>
                <PhoneInput value={form.phone} onChange={(phone) => setForm((p) => ({ ...p, phone }))} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {canManagePayout && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Default Payout %</label>
                  <input type="number" min="0" value={form.default_payout_percentage} onChange={(e) => setForm((p) => ({ ...p, default_payout_percentage: e.target.value }))} className={inputCls} />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            {canManagePayout && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground">Minimum Guarantee (per agreement)</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Lock-in guarantee of academic revenue share over the agreement term.</p>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  {([1, 2, 3] as const).map((year) => {
                    const field = `minimum_guarantee_year${year}` as const;
                    return (
                      <div key={year}>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Year {year} (₹)</label>
                        <input
                          type="number"
                          min="0"
                          value={form[field]}
                          onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Linked User Account</label>
              <select value={form.user_id} onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value }))} className={inputCls}>
                <option value="">No account linked</option>
                {partnerUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name || "Unnamed"} {u.email ? `(${u.email})` : ""}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">Create or assign a user with the Academic Partner role first.</p>
            </div>
            {editingId && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Assignments</p>
                    <p className="text-xs text-muted-foreground">
                      {editingAssignments.length} course/batch assignment{editingAssignments.length === 1 ? "" : "s"} linked to this partner.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openAssignmentFromForm}>
                      <Link2 className="h-3.5 w-3.5" /> Assign Course/Batch
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={openLeadAssignmentFromForm}>
                      <UserPlus className="h-3.5 w-3.5" /> Assign Lead
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Partner Logo</label>
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-3">
                <div className="flex h-14 w-24 items-center justify-center rounded-lg border border-border bg-background p-2">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Partner logo preview" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    id="academic-partner-logo"
                    type="file"
                    accept="image/png"
                    className="hidden"
                    onChange={(event) => handleLogoPick(event.target.files?.[0] || null)}
                  />
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <label htmlFor="academic-partner-logo" className="cursor-pointer">
                      <ImageIcon className="h-4 w-4" /> Upload PNG
                    </label>
                  </Button>
                  <p className="mt-1 text-[10px] text-muted-foreground">Transparent PNG recommended for clean dashboard branding.</p>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={() => handleSave()} disabled={saving || !form.name.trim()} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showOnboarding} onOpenChange={(open) => { if (!open && !saving) setShowOnboarding(false); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{onboardingActionLabel(selectedOnboardingPartner?.onboarding_status)}{selectedOnboardingPartner ? ` - ${selectedOnboardingPartner.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {selectedOnboardingPartner && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Status: <span className="font-medium text-foreground">{selectedOnboardingPartner.onboarding_status || "not_started"}</span>
                </span>
                <span>
                  Documents: <span className="font-medium text-foreground">{(documentsByPartner.get(selectedOnboardingPartner.id) || []).length}</span>
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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

            {onboardingStep === 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">PAN *</label>
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Uploaded files stay in the private academic partner documents bucket and are visible to internal admissions/admin users.
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {ONBOARDING_DOC_TYPES.map((doc) => (
                    <div key={doc.value} className="rounded-xl border border-border/60 p-3">
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        {doc.label}{doc.required ? " *" : ""}
                      </label>
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.txt,.doc,.docx,.xls,.xlsx"
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

            <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-4">
              <Button variant="outline" onClick={() => goToOnboardingStep(onboardingStep - 1)} disabled={saving || onboardingStep === 0}>
                Previous
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => saveAdminOnboarding("skipped", true)} disabled={saving}>
                  Skip
                </Button>
                <Button variant="outline" onClick={() => saveAdminOnboarding("in_progress", false)} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Draft
                </Button>
                {onboardingStep < ONBOARDING_STEPS.length - 1 ? (
                  <Button onClick={() => goToOnboardingStep(onboardingStep + 1)} disabled={saving} className="gap-2">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save & Continue
                  </Button>
                ) : (
                  <Button onClick={() => saveAdminOnboarding("completed", true, ONBOARDING_STEPS.length - 1)} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Complete Onboarding
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignment} onOpenChange={setShowAssignment}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Course or Batch Assignment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {selectedAssignmentPartner && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Academic partner: <span className="font-medium text-foreground">{selectedAssignmentPartner.name}</span>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course *</label>
              <select value={assignmentForm.course_id} onChange={(e) => setAssignmentForm({ course_id: e.target.value, batch_id: "", payout_percentage: assignmentForm.payout_percentage })} className={inputCls}>
                <option value="">Select course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Batch</label>
              <select value={assignmentForm.batch_id} onChange={(e) => setAssignmentForm((p) => ({ ...p, batch_id: e.target.value }))} className={inputCls} disabled={!assignmentForm.course_id}>
                <option value="">All batches for course</option>
                {filteredBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
              </select>
            </div>
            {canManagePayout && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payout Override %</label>
                <input type="number" min="0" value={assignmentForm.payout_percentage} onChange={(e) => setAssignmentForm((p) => ({ ...p, payout_percentage: e.target.value }))} placeholder="Use partner default" className={inputCls} />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAssignment(false)}>Cancel</Button>
              <Button onClick={() => handleAddAssignment()} disabled={saving || !assignmentForm.course_id} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Add Assignment</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPayoutEdit} onOpenChange={(open) => {
        if (!open && !saving) {
          setShowPayoutEdit(false);
          setPayoutEditAssignment(null);
          setPayoutEditValue("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Assignment Payout</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {payoutEditAssignment && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{payoutEditAssignment.batch_name || "All batches"}</span>
                <span> · {payoutEditAssignment.course_name}</span>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payout %</label>
              <input
                type="number"
                min="0"
                value={payoutEditValue}
                onChange={(e) => setPayoutEditValue(e.target.value)}
                placeholder="Leave blank to use partner default"
                className={inputCls}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Clear this value to use the partner default payout.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowPayoutEdit(false)}>Cancel</Button>
              <Button onClick={() => handleUpdateAssignmentPayout()} disabled={saving || !payoutEditAssignment} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save Payout
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showLeadAssignment} onOpenChange={setShowLeadAssignment}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign Lead to Academic Partner</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {selectedLeadPartner && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Academic partner: <span className="font-medium text-foreground">{selectedLeadPartner.name}</span>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Lead *</label>
              <select value={leadAssignmentForm.lead_id} onChange={(e) => setLeadAssignmentForm({ lead_id: e.target.value })} className={inputCls}>
                <option value="">Select lead</option>
                {assignableLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} - {lead.phone || lead.email || "No contact"}{lead.courses?.name ? ` - ${lead.courses.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedLead?.academic_partner_id && selectedLead.academic_partner_id !== leadAssignmentPartnerId && (
              <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning-foreground">
                This lead is currently assigned to another academic partner. Saving will replace that owner.
              </div>
            )}
            {selectedLead?.consultant_id && (
              <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning-foreground">
                This lead currently has a consultant owner. Saving will replace it with this academic partner.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowLeadAssignment(false)}>Cancel</Button>
              <Button onClick={handleAssignLead} disabled={saving || !leadAssignmentForm.lead_id} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Assign Lead
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(payoutConfirmation)} onOpenChange={(open) => { if (!open && !saving) setPayoutConfirmation(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{payoutConfirmation?.title || "Confirm payout change"}</AlertDialogTitle>
            <AlertDialogDescription>
              {payoutConfirmation?.description || "This changes payout terms for an academic partner."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                const pending = payoutConfirmation;
                if (!pending) return;
                setPayoutConfirmation(null);
                if (pending.kind === "partner") {
                  void handleSave(true);
                } else if (pending.kind === "assignment") {
                  void handleAddAssignment(true);
                } else {
                  void handleUpdateAssignmentPayout(true);
                }
              }}
            >
              Confirm payout change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(detailPartnerId)} onOpenChange={(open) => { if (!open) setDetailPartnerId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {(() => {
            const partner = detailPartnerId ? partners.find((p) => p.id === detailPartnerId) : null;
            if (!partner) return null;
            const row = dashboardByPartner.get(partner.id);
            const detailLeads = leadsByPartner.get(partner.id) || [];
            const detailStudents = studentsByPartner.get(partner.id) || [];
            const detailStats = [
              { label: "Leads", value: row?.total_leads ?? detailLeads.length },
              { label: "In Pipeline", value: row?.pipeline ?? 0 },
              { label: "Admitted", value: row?.conversions ?? 0 },
              { label: "Students", value: detailStudents.length },
              { label: "Fee Collected", value: fmt(row?.total_fee_collected) },
              ...(canManagePayout ? [{ label: "Pending Payout", value: fmt(row?.pending_payout) }] : []),
            ];
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{partner.name} · Leads &amp; Students</DialogTitle>
                </DialogHeader>
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {detailStats.map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                        <p className="text-base font-bold text-foreground">{stat.value}</p>
                        <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <UserPlus className="h-3.5 w-3.5" /> Leads ({detailLeads.length})
                    </p>
                    {detailLeads.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No leads owned by this partner yet.</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-border/60">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Name</th>
                              <th className="px-3 py-2 font-medium">Contact</th>
                              <th className="px-3 py-2 font-medium">Course</th>
                              <th className="px-3 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {detailLeads.map((lead) => (
                              <tr key={lead.id}>
                                <td className="px-3 py-2 font-medium text-foreground">{lead.name}</td>
                                <td className="px-3 py-2 text-muted-foreground">{lead.phone || lead.email || "—"}</td>
                                <td className="px-3 py-2 text-muted-foreground">{lead.courses?.name || "—"}</td>
                                <td className="px-3 py-2">
                                  <Badge className={`border-0 text-[10px] ${stageBadgeClass(lead.stage)}`}>{humanize(lead.stage)}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <GraduationCap className="h-3.5 w-3.5" /> Students ({detailStudents.length})
                    </p>
                    {detailStudents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No enrolled students from this partner yet.</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-border/60">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Name</th>
                              <th className="px-3 py-2 font-medium">Course / Batch</th>
                              <th className="px-3 py-2 font-medium">Status</th>
                              <th className="px-3 py-2 font-medium text-right">Fee Paid</th>
                              <th className="px-3 py-2 font-medium text-right">Balance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {detailStudents.map((student) => (
                              <tr key={student.student_id}>
                                <td className="px-3 py-2">
                                  <p className="font-medium text-foreground">{student.student_name || "Unnamed"}</p>
                                  {student.admission_no && <p className="text-[11px] text-muted-foreground">{student.admission_no}</p>}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {student.course_name || "—"}
                                  {student.batch_name ? ` · ${student.batch_name}` : ""}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge className={`border-0 text-[10px] ${studentStatusBadgeClass(student.status)}`}>{humanize(student.status)}</Badge>
                                </td>
                                <td className="px-3 py-2 text-right text-foreground">{fmt(student.fee_paid)}</td>
                                <td className="px-3 py-2 text-right text-muted-foreground">{fmt(student.fee_balance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/state-fields";
import { Plus, Search, Users, Phone, Mail, IndianRupee, MapPin, ChevronRight, FileText, RotateCcw, CheckCircle2, GitMerge } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { CourseCommissions } from "@/components/consultant/CourseCommissions";
import { LeadCommissions } from "@/components/consultant/LeadCommissions";
import { CommissionApprovalPanel } from "@/components/consultant/CommissionApprovalPanel";
import { ConsultantPerformanceTab } from "@/components/consultant/ConsultantPerformanceTab";
import { ConsultantPayoutsTab } from "@/components/consultant/ConsultantPayoutsTab";
import { ConsultantDetailDialog } from "@/components/consultant/ConsultantDetailDialog";
import { useAuth } from "@/contexts/AuthContext";
import { LeadAssociationRequestsPanel } from "@/components/admissions/LeadAssociationRequestsPanel";
import { BankDetailsFields, type BankVerification } from "@/components/bank/BankDetailsFields";
import { isValidIfsc } from "@/lib/bankDetails";

const STAGES = ["new", "contacted", "onboarded", "active", "inactive"] as const;
const stageLabels: Record<string, string> = { new: "New", contacted: "Contacted", onboarded: "Onboarded", active: "Active", inactive: "Inactive" };
const stageColors: Record<string, string> = { new: "bg-pastel-blue", contacted: "bg-pastel-orange", onboarded: "bg-pastel-purple", active: "bg-pastel-green", inactive: "bg-muted" };

interface Consultant {
  id: string; name: string; organization: string | null; phone: string | null; email: string | null;
  city: string | null; stage: string; commission_type: string | null; commission_value: number | null;
  notes: string | null; created_at: string; user_id: string | null; payout_model: string | null;
  company_name: string | null; company_address: string | null; pan_number: string | null; gst_number: string | null; tan_number: string | null;
  authorised_signatory_name: string | null; authorised_signatory_contact: string | null; authorised_signatory_email: string | null;
  onboarding_status: string; onboarding_step: number;
  bank_account_name: string | null; bank_account_number: string | null; bank_ifsc: string | null; bank_name: string | null; bank_upi: string | null;
}

type ConsultantDocument = {
  id: string;
  consultant_id: string;
  document_type: string;
  title: string;
  file_name: string;
  file_path: string;
  created_at: string;
};
type ConsultantDocumentsClient = {
  from: (
    table: "consultant_documents",
  ) => {
    select: (columns: string) => {
      order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: ConsultantDocument[] | null; error: { message: string } | null }>;
    };
    insert: (row: {
      consultant_id: string;
      document_type: OnboardingDocType;
      title: string;
      file_name: string;
      file_path: string;
      content_type: string | null;
      file_size_bytes: number;
      visibility: "internal";
      uploaded_by: string | null;
    }) => Promise<{ error: { message: string } | null }>;
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
type OnboardingDocType = "agreement" | "gst" | "pan" | "tan" | "bank_details" | "fee_structure" | "brochure" | "additional";
type OnboardingFiles = Record<OnboardingDocType, File[]>;
type OperationError = { message: string };
type AdminOnboardingUpdate = {
  company_name: string | null;
  company_address: string | null;
  pan_number: string | null;
  gst_number: string | null;
  tan_number: string | null;
  authorised_signatory_name: string | null;
  authorised_signatory_contact: string | null;
  authorised_signatory_email: string | null;
  onboarding_status: OnboardingStatus;
  onboarding_step: number;
  onboarding_skipped_at?: string | null;
  onboarding_completed_at?: string | null;
  updated_at: string;
};
type ConsultantSavePayload = {
  name: string;
  organization: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  stage: string;
  commission_type: string;
  commission_value: number;
  notes: string | null;
  user_id: string | null;
  payout_model: string;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  bank_upi: string | null;
};

type FeeCollectionRemittance = {
  id: string;
  amount_collected: number | null;
  amount_remitted: number;
  remittance_ref: string | null;
  note: string | null;
  created_at: string;
};
type AdminOnboardingClient = {
  from: {
    (table: "consultants"): {
      update: (row: AdminOnboardingUpdate) => { eq: (column: "id", value: string) => Promise<{ error: OperationError | null }> };
    };
    (table: "consultant_documents"): {
      insert: (row: {
        consultant_id: string;
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

const ONBOARDING_STEPS = ["Company", "Tax", "Signatory", "Documents"] as const;
const ONBOARDING_DOC_TYPES: { value: OnboardingDocType; label: string; required?: boolean }[] = [
  { value: "agreement", label: "Consultant Agreement", required: true },
  { value: "pan", label: "PAN Card" },
  { value: "gst", label: "GST Certificate" },
  { value: "tan", label: "TAN Certificate" },
  { value: "bank_details", label: "Bank Details" },
  { value: "fee_structure", label: "Commission / Fee Structure" },
  { value: "brochure", label: "Brochures" },
  { value: "additional", label: "Additional Documents" },
];
const docTypeLabel: Record<string, string> = {
  agreement: "Agreement",
  pan: "PAN",
  gst: "GST",
  tan: "TAN",
  bank_details: "Bank Details",
  fee_structure: "Fee Structure",
  brochure: "Brochure",
  additional: "Additional",
};
const emptyOnboardingFiles = (): OnboardingFiles => ({
  agreement: [],
  pan: [],
  gst: [],
  tan: [],
  bank_details: [],
  fee_structure: [],
  brochure: [],
  additional: [],
});
const onboardingFormFromConsultant = (consultant: Consultant | null): OnboardingForm => ({
  company_name: consultant?.company_name || consultant?.organization || consultant?.name || "",
  company_address: consultant?.company_address || "",
  pan_number: consultant?.pan_number || "",
  gst_number: consultant?.gst_number || "",
  tan_number: consultant?.tan_number || "",
  authorised_signatory_name: consultant?.authorised_signatory_name || consultant?.name || "",
  authorised_signatory_contact: consultant?.authorised_signatory_contact || consultant?.phone || "",
  authorised_signatory_email: consultant?.authorised_signatory_email || consultant?.email || "",
});
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
// Match phones ignoring +, spaces and a leading country code so "+91 98717..."
// and "098717..." collapse to the same key. Last 10 digits = the Indian number.
const phoneKey = (phone: string | null | undefined) => {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};
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
const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Please try again.";
};

const Consultants = () => {
  const { toast } = useToast();
  const { role, user, hasPermission } = useAuth();
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [consultantDocuments, setConsultantDocuments] = useState<ConsultantDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [tab, setTab] = useState<"list" | "performance" | "payouts" | "requests" | "association_requests">("list");
  const canSeeRequests = ["super_admin", "principal", "admission_head", "campus_admin"].includes(role || "");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingConsultantId, setOnboardingConsultantId] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>(() => onboardingFormFromConsultant(null));
  const [onboardingFiles, setOnboardingFiles] = useState<OnboardingFiles>(() => emptyOnboardingFiles());
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", organization: "", phone: "", email: "", city: "",
    stage: "new", commission_type: "percentage", commission_value: "0", notes: "", user_id: "",
    payout_model: "commission_pct_first_year",
    bank_account_name: "", bank_account_number: "", bank_ifsc: "", bank_name: "", bank_upi: "",
  });
  const [bankVerified, setBankVerified] = useState<BankVerification | null>(null);
  const [feeRemittances, setFeeRemittances] = useState<FeeCollectionRemittance[]>([]);
  const [remittanceForm, setRemittanceForm] = useState({ amount_remitted: "", amount_collected: "", remittance_ref: "", note: "" });
  const [remittanceSaving, setRemittanceSaving] = useState(false);
  const [consultantUsers, setConsultantUsers] = useState<{ user_id: string; display_name: string | null; email: string | null }[]>([]);
  const [mergeGroup, setMergeGroup] = useState<Consultant[] | null>(null);
  const [mergeKeepId, setMergeKeepId] = useState<string>("");
  const [merging, setMerging] = useState(false);
  const [detailConsultant, setDetailConsultant] = useState<Consultant | null>(null);
  const isSuperAdmin = role === "super_admin";
  const canLinkLeads = role === "super_admin" || role === "principal";
  const canAccessConsultantOnboarding =
    role === "super_admin"
    || ((role === "principal" || role === "counsellor") && hasPermission("consultants:view"));

  const fetchConsultants = async () => {
    setLoading(true);
    const [consultantsRes, documentsRes] = await Promise.all([
      supabase.from("consultants").select("*").order("created_at", { ascending: false }),
      (supabase as unknown as ConsultantDocumentsClient)
        .from("consultant_documents")
        .select("id, consultant_id, document_type, title, file_name, file_path, created_at")
        .order("created_at", { ascending: false }),
    ]);
    const data = consultantsRes.data;
    if (data) setConsultants(data as unknown as Consultant[]);
    setConsultantDocuments((documentsRes.data || []) as ConsultantDocument[]);
    setLoading(false);
  };

  useEffect(() => { fetchConsultants(); }, []);

  // Fetch users with consultant role (for linking)
  const fetchConsultantUsers = async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "consultant");
    if (!roles || roles.length === 0) { setConsultantUsers([]); return; }
    const userIds = roles.map(r => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", userIds);
    setConsultantUsers(profiles || []);
  };

  const filtered = consultants.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.organization || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.city || "").toLowerCase().includes(search.toLowerCase());
    const matchStage = stageFilter === "all" || c.stage === stageFilter;
    return matchSearch && matchStage;
  });

  // Phone keys that occur on more than one consultant → flag those cards as dups.
  const dupPhoneKeys = new Set(
    Object.entries(
      consultants.reduce((acc, c) => {
        const k = phoneKey(c.phone);
        if (k.length >= 10) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    ).filter(([, n]) => n > 1).map(([k]) => k),
  );

  const documentsByConsultant = consultantDocuments.reduce((map, document) => {
    map.set(document.consultant_id, [...(map.get(document.consultant_id) || []), document]);
    return map;
  }, new Map<string, ConsultantDocument[]>());

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    // Block duplicate mobile numbers — root cause of the same consultant appearing twice.
    const key = phoneKey(form.phone);
    if (key.length >= 10) {
      const clash = consultants.find(c => c.id !== editingId && phoneKey(c.phone) === key);
      if (clash) {
        toast({ title: "Duplicate mobile number", description: `A consultant "${clash.name}" already uses this number. Edit that record instead of creating a new one.`, variant: "destructive" });
        return;
      }
    }
    // An account number needs a well-formed IFSC (was previously unvalidated).
    if (form.bank_account_number.trim() && !isValidIfsc(form.bank_ifsc)) {
      toast({ title: "Check the IFSC", description: "An account number needs a valid IFSC (e.g. HDFC0001234).", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: ConsultantSavePayload = {
      name: form.name.trim(),
      organization: form.organization.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      stage: form.stage,
      commission_type: form.commission_type,
      commission_value: Number(form.commission_value) || 0,
      notes: form.notes.trim() || null,
      user_id: form.user_id || null,
      payout_model: form.payout_model,
      bank_account_name: form.bank_account_name.trim() || null,
      bank_account_number: form.bank_account_number.trim() || null,
      bank_ifsc: form.bank_ifsc.trim().toUpperCase() || null,
      bank_name: form.bank_name.trim() || null,
      bank_upi: form.bank_upi.trim() || null,
      bank_verified_name: bankVerified?.name ?? null,
      bank_verified_at: bankVerified?.at ?? null,
      bank_verification_ref: bankVerified?.ref ?? null,
      bank_verification_status: bankVerified?.status ?? "unverified",
    } as ConsultantSavePayload;

    const { error } = editingId
      ? await supabase.from("consultants").update(payload as any).eq("id", editingId)
      : await supabase.from("consultants").insert(payload as any);

    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editingId ? "Updated" : "Consultant added" }); resetForm(); fetchConsultants(); }
    setSaving(false);
  };

  const resetForm = () => {
    setShowForm(false); setEditingId(null);
    setForm({ name: "", organization: "", phone: "", email: "", city: "", stage: "new", commission_type: "percentage", commission_value: "0", notes: "", user_id: "", payout_model: "commission_pct_first_year", bank_account_name: "", bank_account_number: "", bank_ifsc: "", bank_name: "", bank_upi: "" });
    setBankVerified(null);
    setFeeRemittances([]);
    setRemittanceForm({ amount_remitted: "", amount_collected: "", remittance_ref: "", note: "" });
  };

  const editConsultant = (c: Consultant) => {
    const cv = c as any;
    setBankVerified({
      status: cv.bank_verification_status || "unverified",
      name: cv.bank_verified_name || null,
      ref: cv.bank_verification_ref || null,
      at: cv.bank_verified_at || null,
    });
    setForm({
      name: c.name, organization: c.organization || "", phone: c.phone || "", email: c.email || "",
      city: c.city || "", stage: c.stage, commission_type: c.commission_type || "percentage",
      commission_value: String(c.commission_value || 0), notes: c.notes || "", user_id: c.user_id || "",
      payout_model: c.payout_model || "commission_pct_first_year",
      bank_account_name: c.bank_account_name || "", bank_account_number: c.bank_account_number || "",
      bank_ifsc: c.bank_ifsc || "", bank_name: c.bank_name || "", bank_upi: c.bank_upi || "",
    });
    setEditingId(c.id);
    setShowForm(true);
    fetchConsultantUsers();
    if ((c.payout_model || "commission_pct_first_year") === "fee_collection") fetchFeeRemittances(c.id);
  };

  const openMerge = (c: Consultant) => {
    const key = phoneKey(c.phone);
    const group = consultants.filter(x => phoneKey(x.phone) === key);
    if (group.length < 2) return;
    setMergeGroup(group);
    // Default keeper: prefer a portal-linked record, else the most complete.
    const linked = group.find(x => x.user_id);
    setMergeKeepId((linked || group[0]).id);
  };

  const doMerge = async () => {
    if (!mergeGroup || !mergeKeepId) return;
    const losers = mergeGroup.filter(c => c.id !== mergeKeepId);
    if (losers.length === 0) return;
    setMerging(true);
    for (const loser of losers) {
      const { error } = await (supabase.rpc as any)("merge_consultants", { _keep_id: mergeKeepId, _remove_id: loser.id });
      if (error) {
        toast({ title: "Merge failed", description: error.message, variant: "destructive" });
        setMerging(false);
        return;
      }
    }
    toast({ title: `Merged ${losers.length} duplicate${losers.length > 1 ? "s" : ""}` });
    setMergeGroup(null);
    setMergeKeepId("");
    setMerging(false);
    fetchConsultants();
  };

  const fetchFeeRemittances = async (consultantId: string) => {
    const { data, error } = await (supabase.from("consultant_fee_collection_remittances" as any) as any)
      .select("id, amount_collected, amount_remitted, remittance_ref, note, created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false });
    if (error) { toast({ title: "Error loading remittances", description: error.message, variant: "destructive" }); return; }
    setFeeRemittances((data || []) as FeeCollectionRemittance[]);
  };

  const recordFeeRemittance = async () => {
    if (!editingId) return;
    const amountRemitted = Number(remittanceForm.amount_remitted);
    if (!remittanceForm.amount_remitted || Number.isNaN(amountRemitted)) {
      toast({ title: "Amount remitted is required", variant: "destructive" });
      return;
    }
    setRemittanceSaving(true);
    const { error } = await (supabase.rpc as any)("record_consultant_fee_remittance", {
      _consultant_id: editingId,
      _amount_remitted: amountRemitted,
      _amount_collected: remittanceForm.amount_collected ? Number(remittanceForm.amount_collected) : null,
      _remittance_ref: remittanceForm.remittance_ref.trim() || null,
      _note: remittanceForm.note.trim() || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Remittance recorded" });
      setRemittanceForm({ amount_remitted: "", amount_collected: "", remittance_ref: "", note: "" });
      fetchFeeRemittances(editingId);
    }
    setRemittanceSaving(false);
  };

  const openOnboarding = (consultant: Consultant, step?: number) => {
    setOnboardingConsultantId(consultant.id);
    setOnboardingForm(onboardingFormFromConsultant(consultant));
    setOnboardingStep(Math.max(0, Math.min(step ?? Number(consultant.onboarding_step || 0), ONBOARDING_STEPS.length - 1)));
    setOnboardingFiles(emptyOnboardingFiles());
    setShowOnboarding(true);
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
    if (!onboardingForm.authorised_signatory_name.trim()) return "Authorised signatory name is required.";
    if (!onboardingForm.authorised_signatory_contact.trim()) return "Authorised signatory contact number is required.";
    if (!onboardingForm.authorised_signatory_email.trim()) return "Authorised signatory email is required.";
    return null;
  };

  const uploadOnboardingDocuments = async (consultantId: string) => {
    const selected = ONBOARDING_DOC_TYPES.flatMap(({ value, label }) =>
      onboardingFiles[value].map((file) => ({ file, documentType: value, label })),
    );
    if (selected.length === 0) return;

    const onboardingClient = supabase as unknown as AdminOnboardingClient;
    for (const { file, documentType, label } of selected) {
      const path = `${consultantId}/${Date.now()}-${documentType}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("consultant-documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (uploadError) throw uploadError;

      const { error: recordError } = await onboardingClient.from("consultant_documents").insert({
        consultant_id: consultantId,
        document_type: documentType,
        title: label,
        file_name: file.name,
        file_path: path,
        content_type: file.type || null,
        file_size_bytes: file.size,
        visibility: "internal",
        uploaded_by: user?.id || null,
      });
      if (recordError) throw recordError;
    }
    setOnboardingFiles(emptyOnboardingFiles());
  };

  const adminOnboardingPayload = (status: OnboardingStatus, nextStep: number, now: string): AdminOnboardingUpdate => ({
    company_name: onboardingForm.company_name.trim() || null,
    company_address: onboardingForm.company_address.trim() || null,
    pan_number: onboardingForm.pan_number.trim().toUpperCase() || null,
    gst_number: onboardingForm.gst_number.trim().toUpperCase() || null,
    tan_number: onboardingForm.tan_number.trim().toUpperCase() || null,
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
    if (!onboardingConsultantId) return;
    const validationError = status === "completed" ? validateOnboardingForCompletion() : null;
    if (validationError) {
      toast({ title: "Onboarding incomplete", description: validationError, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await uploadOnboardingDocuments(onboardingConsultantId);
      const now = new Date().toISOString();
      const onboardingClient = supabase as unknown as AdminOnboardingClient;
      const { error } = await onboardingClient.from("consultants")
        .update(adminOnboardingPayload(status, nextStep, now))
        .eq("id", onboardingConsultantId);
      if (error) throw error;

      toast({ title: status === "completed" ? "Onboarding completed" : status === "skipped" ? "Onboarding skipped" : "Onboarding saved" });
      await fetchConsultants();
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

  const openConsultantDocument = async (document: ConsultantDocument) => {
    const { data, error } = await supabase.storage
      .from("consultant-documents")
      .createSignedUrl(document.file_path, 60 * 30);
    if (error || !data?.signedUrl) {
      toast({ title: "Document unavailable", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const stats = [
    { label: "Total", value: consultants.length, color: "bg-pastel-blue" },
    { label: "Active", value: consultants.filter(c => c.stage === "active").length, color: "bg-pastel-green" },
    { label: "Onboarded", value: consultants.filter(c => c.stage === "onboarded").length, color: "bg-pastel-purple" },
    { label: "New", value: consultants.filter(c => c.stage === "new").length, color: "bg-pastel-orange" },
  ];
  const selectedOnboardingConsultant = onboardingConsultantId ? consultants.find((c) => c.id === onboardingConsultantId) : null;

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultants</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage admission consultants & referral agents</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2"><Plus className="h-4 w-4" />Add Consultant</Button>
      </div>

      {canSeeRequests && (
        <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit">
          <button
            onClick={() => setTab("list")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              tab === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Consultants
          </button>
          <button
            onClick={() => setTab("performance")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              tab === "performance" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Performance
          </button>
          <button
            onClick={() => setTab("payouts")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              tab === "payouts" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Payouts
          </button>
          <button
            onClick={() => setTab("requests")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              tab === "requests" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Commission Edit Requests
          </button>
          <button
            onClick={() => setTab("association_requests")}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              tab === "association_requests" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Lead Association Requests
          </button>
        </div>
      )}

      {tab === "performance" ? (
        <ConsultantPerformanceTab />
      ) : tab === "payouts" ? (
        <ConsultantPayoutsTab />
      ) : tab === "requests" ? (
        <CommissionApprovalPanel />
      ) : tab === "association_requests" ? (
        <LeadAssociationRequestsPanel requesterType="consultant" />
      ) : (<>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <Card
            key={s.label}
            className="border-border/60 shadow-none transition-all duration-280 ease-standard hover:elevation-mid hover:-translate-y-1 animate-rs-slide-up"
            style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          >
            <CardContent className="p-4">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.color} mb-2`}>
                <Users className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold text-foreground mt-1.5">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search consultants..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <SelectField
          value={stageFilter}
          onValueChange={setStageFilter}
          options={[
            { value: "all", label: "All Stages" },
            ...STAGES.map(s => ({ value: s, label: stageLabels[s] })),
          ]}
          hideLabel
          placeholder="All Stages"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(c => {
          const docs = documentsByConsultant.get(c.id) || [];
          return (
          <Card key={c.id} className="border-border/60 shadow-none hover:shadow-sm transition-shadow cursor-pointer group" onClick={() => setDetailConsultant(c)}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{c.name}</h3>
                  {c.organization && <p className="text-xs text-primary font-medium mt-0.5">{c.organization}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {dupPhoneKeys.has(phoneKey(c.phone)) && (
                    <>
                      <Badge className="text-[9px] border-0 bg-warning/15 text-warning">Duplicate #</Badge>
                      {isSuperAdmin && (
                        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px]"
                          onClick={(e) => { e.stopPropagation(); openMerge(c); }}>
                          <GitMerge className="h-3 w-3" />Merge
                        </Button>
                      )}
                    </>
                  )}
                  {c.user_id && <Badge className="text-[9px] border-0 bg-success/10 text-success dark:bg-success/80/30 dark:text-success">Linked</Badge>}
                  <Badge className={`text-[10px] border-0 ${stageColors[c.stage] || "bg-muted"}`}>{stageLabels[c.stage] || c.stage}</Badge>
                </div>
              </div>
              <div className="flex flex-col gap-1 mt-3 text-xs text-muted-foreground">
                {c.city && <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{c.city}</span>}
                {c.phone && <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{c.phone}</span>}
                {c.email && <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{c.email}</span>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="flex items-center gap-1">
                    <IndianRupee className="h-3 w-3" />
                    {c.commission_value}{c.commission_type === "percentage" ? "%" : " flat"} commission
                  </span>
                  <Badge variant="outline" className="text-[9px] font-normal">
                    {c.payout_model === "fee_collection" ? "Fee Collection" : c.payout_model === "commission_fixed" ? "Fixed" : "% First-Year"}
                  </Badge>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {canAccessConsultantOnboarding && (
              <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">Onboarding</p>
                    <p className="mt-0.5 text-xs text-foreground">{normalizeStatus(c.onboarding_status).replace(/_/g, " ")}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      openOnboarding(c);
                    }}
                  >
                    {normalizeStatus(c.onboarding_status) === "not_started" ? <Plus className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                    {onboardingActionLabel(c.onboarding_status)}
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {docs.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">No documents uploaded</span>
                  ) : docs.slice(0, 3).map((document) => (
                    <Button
                      key={document.id}
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-[11px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openConsultantDocument(document);
                      }}
                    >
                      <FileText className="h-3 w-3" />
                      {docTypeLabel[document.document_type] || document.title}
                    </Button>
                  ))}
                  {docs.length > 3 && <span className="self-center text-[11px] text-muted-foreground">+{docs.length - 3} more</span>}
                </div>
              </div>
              )}
            </CardContent>
          </Card>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-muted-foreground">No consultants found</div>
        )}
      </div>
      </>)}

      <Dialog open={showForm} onOpenChange={o => { if (!saving) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Consultant" : "Add Consultant"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Organization</label>
                <input value={form.organization} onChange={e => setForm(p => ({ ...p, organization: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone</label>
                <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">City</label>
                <input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Stage</label>
                <select value={form.stage} onChange={e => setForm(p => ({ ...p, stage: e.target.value }))} className={inputCls}>
                  {STAGES.map(s => <option key={s} value={s}>{stageLabels[s]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Commission Type</label>
                <select value={form.commission_type} onChange={e => setForm(p => ({ ...p, commission_type: e.target.value }))} className={inputCls}>
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat Amount</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Commission Value</label>
                <input type="number" value={form.commission_value} onChange={e => setForm(p => ({ ...p, commission_value: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payout Model</label>
              <select
                value={form.payout_model}
                onChange={e => {
                  const payout_model = e.target.value;
                  setForm(p => ({ ...p, payout_model }));
                  if (editingId && payout_model === "fee_collection") fetchFeeRemittances(editingId);
                }}
                className={inputCls}
              >
                <option value="commission_pct_first_year">Commission — % of First-Year Fee</option>
                <option value="commission_fixed">Commission — Fixed Amount</option>
                <option value="fee_collection">Fee-Collection Consultant</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {form.payout_model === "fee_collection"
                  ? "Fee-collection consultant: the consultant collects fees directly from students and remits a discounted/fixed amount to the college. The college waives the student's fee (via the existing waiver approval) and pays the consultant NO commission. Record what the college receives under \"Remittances\" below."
                  : form.payout_model === "commission_fixed"
                  ? "Commission — fixed amount: college pays a fixed rupee amount per admission, released proportionally as the student pays their first-year fee."
                  : "Commission — % of first-year fee: college pays the consultant a percentage of the student's first-year fee, released proportionally as the student pays. (Percentage comes from the commission rate below / per-course rates.)"}
              </p>
            </div>
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-semibold uppercase text-muted-foreground">Bank / Payout Account</label>
                <span className="text-[10px] text-muted-foreground">Used on the accountant payout sheet</span>
              </div>
              <BankDetailsFields
                value={{
                  holderName: form.bank_account_name, accountNumber: form.bank_account_number,
                  ifsc: form.bank_ifsc, bankName: form.bank_name, upi: form.bank_upi,
                }}
                onChange={v => setForm(p => ({
                  ...p, bank_account_name: v.holderName, bank_account_number: v.accountNumber,
                  bank_ifsc: v.ifsc, bank_name: v.bankName, bank_upi: v.upi || "",
                }))}
                verification={bankVerified ? { status: bankVerified.status, name: bankVerified.name } : undefined}
                onVerification={setBankVerified}
              />
            </div>
            {editingId && (
              <div className="border-t border-border pt-4">
                <CourseCommissions consultantId={editingId} />
              </div>
            )}
            {editingId && (
              <div className="border-t border-border pt-4">
                <LeadCommissions consultantId={editingId} />
              </div>
            )}
            {editingId && form.payout_model === "fee_collection" && (
              <div className="border-t border-border pt-4 space-y-3">
                <label className="block text-[11px] font-medium text-muted-foreground">Fee-Collection Remittances</label>
                <div className="space-y-2">
                  {feeRemittances.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No remittances recorded.</p>
                  ) : feeRemittances.map(r => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs">
                      <div>
                        <p className="font-medium text-foreground">
                          ₹{Number(r.amount_remitted).toLocaleString("en-IN")} remitted
                          {r.amount_collected != null && ` (of ₹${Number(r.amount_collected).toLocaleString("en-IN")} collected)`}
                        </p>
                        <p className="text-muted-foreground">
                          {r.remittance_ref || "No ref"} · {new Date(r.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Amount remitted *"
                    value={remittanceForm.amount_remitted}
                    onChange={e => setRemittanceForm(p => ({ ...p, amount_remitted: e.target.value }))}
                    className={inputCls}
                  />
                  <input
                    type="number"
                    placeholder="Amount collected"
                    value={remittanceForm.amount_collected}
                    onChange={e => setRemittanceForm(p => ({ ...p, amount_collected: e.target.value }))}
                    className={inputCls}
                  />
                  <input
                    placeholder="Remittance ref"
                    value={remittanceForm.remittance_ref}
                    onChange={e => setRemittanceForm(p => ({ ...p, remittance_ref: e.target.value }))}
                    className={inputCls}
                  />
                  <input
                    placeholder="Note"
                    value={remittanceForm.note}
                    onChange={e => setRemittanceForm(p => ({ ...p, note: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <Button size="sm" onClick={recordFeeRemittance} disabled={remittanceSaving} className="gap-1.5">
                  {remittanceSaving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />}
                  Record
                </Button>
              </div>
            )}
            {editingId && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Linked User Account</label>
                <select value={form.user_id} onChange={e => setForm(p => ({ ...p, user_id: e.target.value }))} className={inputCls}>
                  <option value="">No account linked</option>
                  {consultantUsers.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.display_name || "Unnamed"} {u.email ? `(${u.email})` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Link a user with "Consultant" role to enable portal access. Create the user first in User Management.
                </p>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />}
                {editingId ? "Update" : "Add"} Consultant
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showOnboarding} onOpenChange={(open) => { if (!open && !saving) setShowOnboarding(false); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{onboardingActionLabel(selectedOnboardingConsultant?.onboarding_status)}{selectedOnboardingConsultant ? ` - ${selectedOnboardingConsultant.name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {selectedOnboardingConsultant && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Status: <span className="font-medium text-foreground">{normalizeStatus(selectedOnboardingConsultant.onboarding_status).replace(/_/g, " ")}</span>
                </span>
                <span>
                  Documents: <span className="font-medium text-foreground">{(documentsByConsultant.get(selectedOnboardingConsultant.id) || []).length}</span>
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
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Company / Agency Name *</label>
                  <input value={onboardingForm.company_name} onChange={(e) => updateOnboardingField("company_name", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Registered Email</label>
                  <input type="email" value={onboardingForm.authorised_signatory_email} onChange={(e) => updateOnboardingField("authorised_signatory_email", e.target.value)} className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Registered Address *</label>
                  <textarea rows={3} value={onboardingForm.company_address} onChange={(e) => updateOnboardingField("company_address", e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            {onboardingStep === 1 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                  Uploaded files stay in the private consultant documents bucket and are visible only to superadmins, principals, and counsellors with consultant access.
                </div>
                {selectedOnboardingConsultant && (documentsByConsultant.get(selectedOnboardingConsultant.id) || []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(documentsByConsultant.get(selectedOnboardingConsultant.id) || []).map((document) => (
                      <Button key={document.id} variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openConsultantDocument(document)}>
                        <FileText className="h-3.5 w-3.5" />
                        {docTypeLabel[document.document_type] || document.title}: {document.file_name}
                      </Button>
                    ))}
                  </div>
                )}
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
                  {saving && <ButtonOrb state="working" />} Save Draft
                </Button>
                {onboardingStep < ONBOARDING_STEPS.length - 1 ? (
                  <Button onClick={() => goToOnboardingStep(onboardingStep + 1)} disabled={saving} className="gap-2">
                    {saving && <ButtonOrb state="working" onFilled />} Save & Continue
                  </Button>
                ) : (
                  <Button onClick={() => saveAdminOnboarding("completed", true, ONBOARDING_STEPS.length - 1)} disabled={saving} className="gap-2">
                    {saving ? <ButtonOrb state="working" onFilled /> : <CheckCircle2 className="h-4 w-4" />} Complete Onboarding
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConsultantDetailDialog
        consultant={detailConsultant}
        documents={detailConsultant ? (documentsByConsultant.get(detailConsultant.id) || []) : []}
        canLink={canLinkLeads}
        onEdit={() => { const c = detailConsultant; setDetailConsultant(null); if (c) editConsultant(c); }}
        onChanged={fetchConsultants}
        onClose={() => setDetailConsultant(null)}
      />

      <Dialog open={!!mergeGroup} onOpenChange={(o) => { if (!o && !merging) { setMergeGroup(null); setMergeKeepId(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge duplicate consultants</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <p className="text-xs text-muted-foreground">
              Pick the record to <span className="font-medium text-foreground">keep</span>. All leads, payouts, commissions,
              documents and remittances from the others are re-pointed to it, missing details are filled in from the
              duplicates, then the duplicates are deleted. This cannot be undone.
            </p>
            <div className="space-y-2">
              {(mergeGroup || []).map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${mergeKeepId === c.id ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/30"}`}>
                  <input type="radio" name="merge-keep" checked={mergeKeepId === c.id} onChange={() => setMergeKeepId(c.id)} className="mt-1" />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{c.name}</span>
                      {c.user_id && <Badge className="text-[9px] border-0 bg-success/10 text-success">Linked</Badge>}
                      {mergeKeepId === c.id && <Badge className="text-[9px] border-0 bg-primary/10 text-primary">Keep</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                      {c.organization && <span>{c.organization}</span>}
                      {c.email && <span>{c.email}</span>}
                      {c.bank_account_number && <span>Bank on file</span>}
                      <span>Added {new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setMergeGroup(null); setMergeKeepId(""); }} disabled={merging}>Cancel</Button>
              <Button onClick={doMerge} disabled={merging || !mergeKeepId} className="gap-1.5">
                {merging ? <ButtonOrb state="working" onFilled /> : <GitMerge className="h-4 w-4" />}
                Merge {(mergeGroup || []).length - 1} into selected
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Consultants;

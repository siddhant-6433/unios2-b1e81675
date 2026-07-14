import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { PhoneInput } from "@/components/ui/phone-input";
import { ReceiptDialog, ReceiptData } from "@/components/receipts/ReceiptDialog";
import {
  Loader2, Plus, Users, TrendingUp, IndianRupee, ArrowUpRight,
  Download, Clock, CreditCard, Eye,
  Building2, CheckCircle2, EyeOff, RotateCcw,
} from "lucide-react";
import { CourseInfoPanel } from "@/components/leads/CourseInfoPanel";
import { useNavigate } from "react-router-dom";
import { ConsultantTour } from "@/components/consultant/ConsultantTour";
import { VoiceMessageRecorder } from "@/components/consultant/VoiceMessageRecorder";
import { BookOpen } from "lucide-react";
import { LeadAssociationRequestsPanel } from "@/components/admissions/LeadAssociationRequestsPanel";
import { ConsultantFeesPanel } from "@/components/finance/ConsultantFeesPanel";

interface DashboardStats {
  consultant_id: string;
  consultant_name: string;
  total_leads: number;
  conversions: number;
  pipeline: number;
  total_fee_collected: number;
  total_commission: number;
  commission_paid: number;
  commission_pending: number;
}

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  course_name: string;
  campus_name: string;
  course_id: string | null;
  created_at: string;
}

interface Payment {
  id: string;
  lead_id: string;
  type: string;
  amount: number;
  payment_mode: string;
  transaction_ref: string | null;
  receipt_no: string | null;
  status: string;
  payment_date: string;
  lead_name?: string;
}

interface Payout {
  id: string;
  lead_id: string;
  payout_amount: number;
  student_fee_paid: number;
  fee_paid_pct: number;
  status: string;
  created_at: string;
  lead_name?: string;
  course_name?: string;
}

interface ConsultantProfile {
  id: string;
  name: string;
  organization: string | null;
  phone: string | null;
  email: string | null;
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
}

type OnboardingStatus = ConsultantProfile["onboarding_status"];
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
type ConsultantOnboardingClient = {
  from: (
    table: "consultant_documents",
  ) => {
    insert: (row: {
      consultant_id: string;
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
  rpc: (
    fn: "save_consultant_onboarding",
    args: {
      _consultant_id: string;
      _company_name: string;
      _company_address: string;
      _pan_number: string;
      _gst_number: string;
      _tan_number: string;
      _authorised_signatory_name: string;
      _authorised_signatory_contact: string;
      _authorised_signatory_email: string;
      _onboarding_status: OnboardingStatus;
      _onboarding_step: number;
    },
  ) => Promise<{ data: ConsultantProfile | null; error: OperationError | null }>;
};
type ConsultantLeadRow = Lead & {
  courses?: { name: string | null } | null;
  campuses?: { name: string | null } | null;
};
type ConsultantPaymentRow = Payment & {
  leads?: { name: string | null } | null;
};
type ConsultantPayoutRow = Payout & {
  leads?: { name: string | null } | null;
  courses?: { name: string | null } | null;
};
type ConsultantPortalDataClient = {
  from: {
    (table: "consultant_dashboard"): {
      select: (columns: string) => {
        eq: (column: "consultant_id", value: string) => {
          single: () => Promise<{ data: DashboardStats | null; error: OperationError | null }>;
        };
      };
    };
    (table: "lead_payments"): {
      select: (columns: string) => {
        in: (column: "lead_id", values: string[]) => {
          order: (column: "payment_date", options?: { ascending?: boolean }) => {
            limit: (count: number) => Promise<{ data: ConsultantPaymentRow[] | null; error: OperationError | null }>;
          };
        };
      };
      insert: (row: {
        lead_id: string;
        type: string;
        amount: number;
        payment_mode: string;
        transaction_ref: string | null;
        notes: string;
        recorded_by: string | null;
        status: "confirmed";
      }) => Promise<{ error: OperationError | null }>;
    };
    (table: "consultant_payouts"): {
      select: (columns: string) => {
        eq: (column: "consultant_id", value: string) => {
          order: (column: "created_at", options?: { ascending?: boolean }) => {
            limit: (count: number) => Promise<{ data: ConsultantPayoutRow[] | null; error: OperationError | null }>;
          };
        };
      };
    };
  };
};

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted",
  waitlisted: "Waitlisted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
};

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-gray-100 text-gray-700", admitted: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive", waitlisted: "bg-warning/10 text-warning-foreground",
};

const TYPE_LABELS: Record<string, string> = {
  application_fee: "Application Fee", token_fee: "Token Fee",
  registration_fee: "Registration Fee", other: "Other",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer",
  cheque: "Cheque / DD", online: "Online", gateway: "Gateway",
};

const PAYOUT_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-warning/10 text-warning-foreground" },
  approved: { label: "Approved", cls: "bg-info/10 text-info-foreground" },
  paid: { label: "Paid", cls: "bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/10 text-destructive" },
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
const onboardingFormFromConsultant = (consultant: ConsultantProfile | null): OnboardingForm => ({
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
const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Please try again.";
};

const ConsultantPortal = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { coursesByDepartment, getCampusesForCourse } = useCourseCampusLink();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentLeadId, setPaymentLeadId] = useState<string | null>(null);
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [consultant, setConsultant] = useState<ConsultantProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>(() => onboardingFormFromConsultant(null));
  const [onboardingFiles, setOnboardingFiles] = useState<OnboardingFiles>(() => emptyOnboardingFiles());
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [viewCourseId, setViewCourseId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", course_id: "", campus_id: "", notes: "",
  });

  const [payForm, setPayForm] = useState({
    type: "application_fee", amount: "", mode: "upi", transaction_ref: "", notes: "",
  });

  const fetchAll = async (cId: string) => {
    const portalClient = supabase as unknown as ConsultantPortalDataClient;
    const { data: leadIdRows } = await supabase.from("leads").select("id").eq("consultant_id", cId);
    const leadIds = ((leadIdRows || []) as Array<{ id: string }>).map((lead) => lead.id);
    const [statsRes, leadsRes, paymentsRes, payoutsRes] = await Promise.all([
      portalClient.from("consultant_dashboard").select("*").eq("consultant_id", cId).single(),
      supabase.from("leads")
        .select("id, name, phone, email, stage, course_id, created_at, courses:course_id(name), campuses:campus_id(name)")
        .eq("consultant_id", cId)
        .order("created_at", { ascending: false })
        .limit(200),
      portalClient.from("lead_payments")
        .select("*, leads:lead_id(name)")
        .in("lead_id", leadIds)
        .order("payment_date", { ascending: false })
        .limit(100),
      portalClient.from("consultant_payouts")
        .select("*, leads:lead_id(name), courses:course_id(name)")
        .eq("consultant_id", cId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (statsRes.data) setStats(statsRes.data);
    if (leadsRes.data) setLeads(((leadsRes.data || []) as unknown as ConsultantLeadRow[]).map(l => ({ ...l, course_name: l.courses?.name || "—", campus_name: l.campuses?.name || "—" })));
    if (paymentsRes.data) setPayments(paymentsRes.data.map(p => ({ ...p, lead_name: p.leads?.name || undefined })));
    if (payoutsRes.data) setPayouts(payoutsRes.data.map(p => ({ ...p, lead_name: p.leads?.name || undefined, course_name: p.courses?.name || undefined })));
  };

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      const { data: consultantData } = await supabase.from("consultants").select("*").eq("user_id", user.id).single();
      if (!consultantData) { setLoading(false); return; }
      const profile = consultantData as unknown as ConsultantProfile;
      setConsultant(profile);
      setConsultantId(profile.id);
      setOnboardingForm(onboardingFormFromConsultant(profile));
      setOnboardingStep(Math.min(Number(profile.onboarding_step || 0), ONBOARDING_STEPS.length - 1));
      setShowOnboarding(profile.onboarding_status !== "completed" && profile.onboarding_status !== "skipped");
      await fetchAll(profile.id);
      setLoading(false);
    })();
  }, [user?.id]);

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
    if (!consultantId || !user?.id) return;
    const selected = ONBOARDING_DOC_TYPES.flatMap(({ value, label }) =>
      onboardingFiles[value].map((file) => ({ file, documentType: value, label })),
    );
    if (selected.length === 0) return;

    const onboardingClient = supabase as unknown as ConsultantOnboardingClient;
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
        uploaded_by: user.id,
      });

      if (recordError) throw recordError;
    }
    setOnboardingFiles(emptyOnboardingFiles());
  };

  const saveOnboarding = async (status: OnboardingStatus, nextStep = onboardingStep) => {
    if (!consultantId) return;
    const validationError = status === "completed" ? validateOnboardingForCompletion() : null;
    if (validationError) {
      toast({ title: "Onboarding incomplete", description: validationError, variant: "destructive" });
      return;
    }

    setOnboardingSaving(true);
    try {
      await uploadOnboardingDocuments();
      const onboardingClient = supabase as unknown as ConsultantOnboardingClient;
      const { data, error } = await onboardingClient.rpc("save_consultant_onboarding", {
        _consultant_id: consultantId,
        _company_name: onboardingForm.company_name,
        _company_address: onboardingForm.company_address,
        _pan_number: onboardingForm.pan_number,
        _gst_number: onboardingForm.gst_number,
        _tan_number: onboardingForm.tan_number,
        _authorised_signatory_name: onboardingForm.authorised_signatory_name,
        _authorised_signatory_contact: onboardingForm.authorised_signatory_contact,
        _authorised_signatory_email: onboardingForm.authorised_signatory_email,
        _onboarding_status: status,
        _onboarding_step: nextStep,
      });

      if (error) throw error;
      if (!data) throw new Error("Consultant profile was not returned.");

      setConsultant(data);
      setOnboardingForm(onboardingFormFromConsultant(data));
      setOnboardingStep(Math.min(Number(data.onboarding_step || 0), ONBOARDING_STEPS.length - 1));
      setShowOnboarding(status !== "completed" && status !== "skipped");
      toast({
        title: status === "completed" ? "Onboarding completed" : status === "skipped" ? "Onboarding skipped" : "Onboarding saved",
        description: status === "skipped" ? "You can resume it from this dashboard anytime." : undefined,
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
    await saveOnboarding("in_progress", safeStep);
  };

  const handleCourseChange = (courseId: string) => {
    const campuses = getCampusesForCourse(courseId || null);
    setForm(p => ({ ...p, course_id: courseId, campus_id: campuses.length === 1 ? campuses[0].id : "" }));
  };

  const handleAddLead = async () => {
    if (!form.name.trim() || !form.phone.trim() || !consultantId) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("submit_lead_association_request", {
      _requester_type: "consultant",
      _name: form.name.trim(),
      _phone: form.phone.trim(),
      _email: form.email.trim() || null,
      _course_id: form.course_id || null,
      _campus_id: form.campus_id || null,
      _notes: form.notes.trim() || null,
      _consultant_id: consultantId,
      _academic_partner_id: null,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      const result = data as { status?: string } | null;
      toast({
        title: result?.status === "pending" ? "Duplicate sent for approval" : "Lead added",
        description: result?.status === "pending"
          ? "This phone already exists in CRM. It will show as associated only after superadmin approval."
          : undefined,
      });
      setForm({ name: "", phone: "", email: "", course_id: "", campus_id: "", notes: "" });
      setShowAdd(false);
      await fetchAll(consultantId);
    }
    setSaving(false);
  };

  const openPayment = (leadId: string) => {
    setPaymentLeadId(leadId);
    setPayForm({ type: "application_fee", amount: "", mode: "upi", transaction_ref: "", notes: "" });
    setShowPayment(true);
  };

  const handleRecordPayment = async () => {
    if (!paymentLeadId || !payForm.amount || !consultantId) return;
    setSaving(true);

    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    const portalClient = supabase as unknown as ConsultantPortalDataClient;
    const { error } = await portalClient.from("lead_payments").insert({
      lead_id: paymentLeadId,
      type: payForm.type,
      amount: parseFloat(payForm.amount),
      payment_mode: payForm.mode,
      transaction_ref: payForm.transaction_ref || null,
      notes: payForm.notes ? `Paid by consultant. ${payForm.notes}` : "Paid by consultant",
      recorded_by: profileId,
      status: "confirmed",
    });

    if (error) {
      toast({ title: "Payment failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Payment recorded", description: `₹${parseFloat(payForm.amount).toLocaleString("en-IN")} recorded` });
      setShowPayment(false);
      await fetchAll(consultantId);
    }
    setSaving(false);
  };

  const downloadReceipt = (p: Payment) => {
    const lead = leads.find(l => l.id === p.lead_id);
    setReceiptData({
      type: "student_fee",
      receipt_no: p.receipt_no || p.id.slice(0, 8).toUpperCase(),
      student_name: lead?.name || p.lead_name || "Unknown",
      amount: p.amount,
      payment_ref: p.transaction_ref,
      payment_date: p.payment_date,
      payment_mode: MODE_LABELS[p.payment_mode] || p.payment_mode,
      fee_description: TYPE_LABELS[p.type] || p.type,
      institution_name: "NIMT Educational Institutions",
      campus_name: lead?.campus_name,
    });
  };

  const filteredCampuses = getCampusesForCourse(form.course_id || null);
  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
  const fmt = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

  if (loading) return <PageLoader />;
  if (!consultantId) return <div className="flex h-64 items-center justify-center"><p className="text-sm text-muted-foreground">No consultant profile linked to your account.</p></div>;

  const onboardingComplete = consultant?.onboarding_status === "completed";
  const onboardingSkipped = consultant?.onboarding_status === "skipped";
  const onboardingNeedsAttention = Boolean(consultant && !onboardingComplete && showOnboarding);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* First-time tour overlay */}
      <ConsultantTour onDownloadGuide={() => navigate("/consultant-guide")} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultant Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome, {stats?.consultant_name || "Consultant"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/consultant-guide")}>
            <BookOpen className="h-3.5 w-3.5" /> View Guide
          </Button>
          <Button onClick={() => setShowAdd(true)} className="gap-2" data-tour="add-lead">
            <Plus className="h-4 w-4" /> Add Lead
          </Button>
        </div>
      </div>

      {onboardingSkipped && !showOnboarding && (
        <Card className="border-warning/20 bg-warning/5/70 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-warning-foreground">Consultant onboarding was skipped</p>
              <p className="mt-1 text-xs text-warning-foreground">Resume it anytime to add company, tax, signatory, agreement, and supporting documents.</p>
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
                  <h2 className="text-base font-semibold text-foreground">Consultant Onboarding</h2>
                  <Badge variant="secondary" className="text-[10px]">
                    {consultant.onboarding_status === "not_started" ? "Not Started" : consultant.onboarding_status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Complete your profile and upload the consultant agreement and verification documents.</p>
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

            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
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
                    <p>Uploaded documents are visible only to authorised internal users with consultant access.</p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Leads", value: stats?.total_leads || 0, icon: Users, bg: "bg-pastel-blue" },
          { label: "Pipeline", value: stats?.pipeline || 0, icon: ArrowUpRight, bg: "bg-pastel-orange" },
          { label: "Conversions", value: stats?.conversions || 0, icon: TrendingUp, bg: "bg-pastel-green" },
          { label: "Fee Collected", value: fmt(Number(stats?.total_fee_collected || 0)), icon: CreditCard, bg: "bg-pastel-mint" },
          { label: "Commission Earned", value: fmt(Number(stats?.total_commission || 0)), icon: IndianRupee, bg: "bg-pastel-purple" },
          { label: "Pending Payout", value: fmt(Number(stats?.commission_pending || 0)), icon: Clock, bg: "bg-pastel-yellow" },
        ].map(s => (
          <Card key={s.label} className="border-border/60 shadow-none">
            <CardContent className="p-4">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${s.bg} mb-2`}>
                <s.icon className="h-4 w-4 text-foreground/70" />
              </div>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Voice message to admission team */}
      <div data-tour="voice-message">
        {consultantId && <VoiceMessageRecorder consultantId={consultantId} />}
      </div>

      <Tabs defaultValue="leads" className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          {["Leads", "Payments", "Fees", "Commissions", "Requests"].map(t => (
            <TabsTrigger key={t} value={t.toLowerCase()} data-tour={`${t.toLowerCase()}-tab`}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* LEADS TAB */}
        <TabsContent value="leads" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Lead</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(l => (
                    <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{l.name}</div>
                        <div className="text-xs text-muted-foreground">{l.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-foreground">{l.course_name}</div>
                        <div className="text-xs text-muted-foreground">{l.campus_name}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`text-[10px] font-medium border-0 ${STAGE_COLORS[l.stage] || "bg-muted text-muted-foreground"}`}>
                          {STAGE_LABELS[l.stage] || l.stage}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(l.created_at).toLocaleDateString("en-IN")}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {l.course_id && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewCourseId(l.course_id)}>
                              <Eye className="h-3 w-3" /> Info
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openPayment(l.id)}>
                            <IndianRupee className="h-3 w-3" /> Pay Fee
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No leads added yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FEES TAB — consultant-managed fee visibility + pay/send-link */}
        <TabsContent value="fees" className="mt-4">
          <ConsultantFeesPanel />
        </TabsContent>

        {/* PAYMENTS TAB */}
        <TabsContent value="payments" className="mt-4">
          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{p.lead_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{TYPE_LABELS[p.type] || p.type}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmt(p.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{MODE_LABELS[p.payment_mode] || p.payment_mode}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(p.payment_date).toLocaleDateString("en-IN")}</td>
                      <td className="px-4 py-3 text-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadReceipt(p)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No payments recorded yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMMISSIONS TAB */}
        <TabsContent value="commissions" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold text-primary">{fmt(Number(stats?.total_commission || 0))}</p>
                <p className="text-[11px] text-muted-foreground">Total Earned</p>
              </CardContent>
            </Card>
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold text-success">{fmt(Number(stats?.commission_paid || 0))}</p>
                <p className="text-[11px] text-muted-foreground">Paid Out</p>
              </CardContent>
            </Card>
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold text-warning-foreground">{fmt(Number(stats?.commission_pending || 0))}</p>
                <p className="text-[11px] text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/60 shadow-none overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Fee Paid</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Fee %</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Payout</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map(p => {
                    const sc = PAYOUT_STATUS[p.status] || PAYOUT_STATUS.pending;
                    return (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{p.lead_name || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.course_name || "—"}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{fmt(p.student_fee_paid)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] border-0 ${Number(p.fee_paid_pct) >= 25 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                            {p.fee_paid_pct}%
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{fmt(p.payout_amount)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={`text-[10px] border-0 ${sc.cls}`}>{sc.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {payouts.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No commission payouts yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-[10px] text-muted-foreground">
            Commission payouts are released proportionally to student fee payments. Minimum 25% of annual fee must be paid by the student before payout is eligible.
          </p>
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          <LeadAssociationRequestsPanel requesterType="consultant" />
        </TabsContent>
      </Tabs>

      {/* Add Lead Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Lead</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Student name" className={inputCls} />
              </div>
              <div className="min-w-0">
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
                <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} required />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course</label>
                <select value={form.course_id} onChange={e => handleCourseChange(e.target.value)} className={inputCls}>
                  <option value="">Select course</option>
                  {coursesByDepartment.map(g => (
                    <optgroup key={g.department} label={g.department}>
                      {g.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
                <select value={form.campus_id} onChange={e => setForm(p => ({ ...p, campus_id: e.target.value }))} className={inputCls} disabled={filteredCampuses.length <= 1}>
                  {!form.course_id ? <option value="">Select course first</option> :
                    filteredCampuses.length === 1 ? <option value={filteredCampuses[0].id}>{filteredCampuses[0].name}</option> :
                      <><option value="">Select campus</option>{filteredCampuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</>}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAddLead} disabled={!form.name.trim() || !form.phone.trim() || saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Fee Dialog */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-primary" /> Record Payment
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {leads.find(l => l.id === paymentLeadId)?.name || "Student"}
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment Type</label>
                <select value={payForm.type} onChange={e => setPayForm(p => ({ ...p, type: e.target.value }))} className={inputCls}>
                  <option value="application_fee">Application Fee</option>
                  <option value="token_fee">Token Fee</option>
                  <option value="registration_fee">Registration Fee</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Amount *</label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input type="number" min="0" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" className={`${inputCls} pl-8`} />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Payment Mode</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[{ v: "cash", l: "Cash" }, { v: "upi", l: "UPI" }, { v: "bank_transfer", l: "Bank Transfer" }, { v: "cheque", l: "Cheque" }, { v: "online", l: "Online" }].map(m => (
                  <button key={m.v} onClick={() => setPayForm(p => ({ ...p, mode: m.v }))}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${payForm.mode === m.v ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                    {m.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Transaction Ref / UTR</label>
              <input value={payForm.transaction_ref} onChange={e => setPayForm(p => ({ ...p, transaction_ref: e.target.value }))} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(false)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={!payForm.amount || parseFloat(payForm.amount) <= 0 || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />} Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Course Info Dialog */}
      <Dialog open={!!viewCourseId} onOpenChange={(o) => { if (!o) setViewCourseId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Course Information</DialogTitle>
          </DialogHeader>
          {viewCourseId && <CourseInfoPanel courseId={viewCourseId} />}
        </DialogContent>
      </Dialog>

      {/* Receipt Download */}
      {receiptData && (
        <ReceiptDialog data={receiptData} onClose={() => setReceiptData(null)} />
      )}
    </div>
  );
};

export default ConsultantPortal;

import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  emptyPgdmCertificateDetails,
  generatePgdmCertificatePdf,
  normalizePgdmCertificateDetails,
  PGDM_CERTIFICATE_NAME_FONT_FAMILY,
  pgdmCertificateTemplateForCampus,
  pgdmCertificateFileName,
  type PgdmCertificateDetails,
} from "@/lib/pgdmCertificate";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField, TextField, FieldShell } from "@/components/ui/state-fields";
import { Shield, FileText, ExternalLink, CheckCircle, XCircle, Clock, Eye, Plus, Upload, X, Mail, Trash2, UserCheck, Download, Send, Printer, RotateCcw, IndianRupee } from "lucide-react";

// Offline payment modes — mirror the finance OfflinePaymentDialog labels so the
// experience is consistent across the app.
const OFFLINE_PAYMENT_MODES: { value: string; label: string }[] = [
  { value: "cash",          label: "Cash" },
  { value: "upi",           label: "UPI / Wallet / QR" },
  { value: "bank_transfer", label: "NEFT / IMPS / Bank Transfer" },
  { value: "cheque",        label: "Cheque / DD" },
  { value: "online",        label: "Online (Manual / Reconciled)" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending Payment", color: "bg-gray-100 text-gray-700" },
  paid: { label: "Pending Review", color: "bg-info/10 text-info-foreground" },
  under_review: { label: "Under Review", color: "bg-warning/10 text-warning-foreground" },
  verified: { label: "Completed", color: "bg-success/10 text-success" },
  rejected: { label: "Rejected", color: "bg-destructive/10 text-destructive" },
};

// For PGDM diploma requests the base `status` stays "under_review" through the
// whole certificate lifecycle, so a request awaiting approval, being printed,
// or already collected all looked identical ("Under Review"). Overlay the
// certificate stage onto the displayed status + tab so the stage is visible.
// `key` is the tab bucket it counts under; `label`/`color` drive the badge.
const isPgdmDiplomaReq = (req: any) => {
  const courseText = `${req?.course || ""} ${req?.course_code || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return req?.request_type === "diploma" && (
    courseText.includes("pgdm") || courseText.includes("postgraduatediplomainmanagement")
  );
};

const CERT_STAGE_CONFIG: Record<string, { key: string; label: string; color: string }> = {
  pending_approval: { key: "under_review", label: "Pending Approval", color: "bg-warning/10 text-warning-foreground" },
  approved: { key: "under_review", label: "Approved · Printing", color: "bg-info/10 text-info-foreground" },
  ready_notified: { key: "verified", label: "Ready · Candidate Notified", color: "bg-success/10 text-success" },
};

const statusMetaFor = (req: any): { key: string; label: string; color: string } => {
  if (isPgdmDiplomaReq(req)) {
    const stage = CERT_STAGE_CONFIG[req?.pgdm_certificate_status];
    if (stage) return stage;
  }
  const c = STATUS_CONFIG[req?.status] || STATUS_CONFIG.pending_payment;
  return { key: req?.status || "pending_payment", label: c.label, color: c.color };
};

const RESULT_LABELS: Record<string, { label: string; color: string }> = {
  confirmed: { label: "Confirmed", color: "bg-success/10 text-success" },
  discrepancy_marks: { label: "Discrepancy", color: "bg-warning/10 text-warning-foreground" },
  not_found: { label: "Not Found", color: "bg-destructive/10 text-destructive" },
};

const RESULT_OPTIONS = [
  { value: "confirmed", label: "Confirmed — Alumni record verified successfully" },
  { value: "discrepancy_marks", label: "Discrepancy — Student exists but marks/percentage/pass-fail status do not match (possible modification)" },
  { value: "not_found", label: "Not Found — No such alumni record exists in our database" },
];

export default function AlumniVerifications() {
  const { user, role, hasPermission } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = role === "super_admin";
  const canManageStudentServices = isSuperAdmin || hasPermission("alumni_verification:manage");
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [courses, setCourses] = useState<any[]>([]);
  const [handlers, setHandlers] = useState<any[]>([]);
  const [handlerRules, setHandlerRules] = useState<any[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [assigningHandler, setAssigningHandler] = useState(false);
  const [ruleDraft, setRuleDraft] = useState({
    service_type: "verification",
    course_id: "",
    course_text: "",
    batch_year: "",
    handler_user_id: "",
  });

  // Detail dialog
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [verificationResult, setVerificationResult] = useState("");
  const [issuanceDecision, setIssuanceDecision] = useState("verified");
  const [newStatus, setNewStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewDocFile, setReviewDocFile] = useState<File | null>(null);
  const [pgdmCertificateDetails, setPgdmCertificateDetails] = useState<PgdmCertificateDetails>(emptyPgdmCertificateDetails());
  const [pgdmCertificateSaving, setPgdmCertificateSaving] = useState(false);
  const [pgdmAudit, setPgdmAudit] = useState<any[]>([]);

  // Manual entry dialog
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualData, setManualData] = useState({
    request_type: "verification", alumni_name: "", course: "", year_of_passing: "",
    employer_name: "", contact_name: "", contact_email: "", contact_phone_spoc: "",
    enrollment_no: "", campus: "", fee_amount: "1500", status: "paid", course_id: "",
  });
  const [manualPaymentProof, setManualPaymentProof] = useState<File | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [showOfflinePay, setShowOfflinePay] = useState(false);
  const [offlinePayMode, setOfflinePayMode] = useState("cash");
  const [offlinePayRef, setOfflinePayRef] = useState("");

  // Email preview dialog
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [sendEmailEnabled, setSendEmailEnabled] = useState(true);

  const handleDelete = async (requestToDelete = selectedReq) => {
    if (!requestToDelete || !isSuperAdmin) return;
    if (!window.confirm(`Delete request ${requestToDelete.request_number}? This cannot be undone.`)) return;
    setDeleting(true);

    try {
      // Delete storage files
      const paths = [
        requestToDelete.diploma_certificate_url,
        requestToDelete.employee_review_doc_url,
        ...(requestToDelete.marksheet_urls || []),
        ...(requestToDelete.additional_doc_urls || []),
      ].filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from("alumni-verification-docs").remove(paths);
      }

      const { error } = await supabase
        .from("alumni_verification_requests" as any)
        .delete()
        .eq("id", requestToDelete.id);

      if (error) throw error;

      toast({ title: "Request deleted" });
      if (selectedReq?.id === requestToDelete.id) setSelectedReq(null);
      fetchRequests();
    } catch (error) {
      toast({
        title: "Failed to delete request",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const fetchRequests = async () => {
    const { data } = await supabase
      .from("alumni_verification_requests" as any)
      .select("*")
      .order("created_at", { ascending: false });
    setRequests(data || []);
    setLoading(false);
  };

  const fetchRoutingData = async () => {
    const [coursesRes, handlersRes, rulesRes] = await Promise.all([
      // Include inactive courses: alumni verification / degree / marksheet
      // requests routinely arrive for discontinued courses (e.g. the old
      // Ghaziabad-campus PGDM), so they must be selectable in handler rules and
      // manual entry. Active courses sort first.
      supabase.from("courses").select("id, name, code, is_active").order("is_active", { ascending: false }).order("name"),
      // Dedicated handler list gated on alumni_verification:manage (not
      // user_management:view) so Student Services managers who aren't super
      // admins still see names in the "Assign handler" dropdown.
      supabase.rpc("student_service_assignable_handlers" as any),
      supabase.from("student_service_handler_rules" as any).select("*").eq("is_active", true).order("updated_at", { ascending: false }),
    ]);
    setCourses((coursesRes.data || []) as any[]);

    if (handlersRes.error && isMissingRpcError(handlersRes.error)) {
      // Fallback (RPC not deployed yet): the admin directory, which only returns
      // rows for super_admin / user_management:view callers.
      const [directoryRes, employeeRes] = await Promise.all([
        supabase.rpc("admin_user_directory" as any, { _show_archived: false }),
        supabase.from("employee_profiles" as any).select("user_id, display_name, work_email, work_number, mobile_number"),
      ]);
      const employeeByUser = new Map((employeeRes.data || []).map((e: any) => [e.user_id, e]));
      const staff = ((directoryRes.data || []) as any[])
        .filter((u: any) => u.user_id && u.role && !["student", "parent", "consultant", "academic_partner", "publisher"].includes(u.role))
        .map((u: any) => {
          const emp = employeeByUser.get(u.user_id) || {};
          return {
            ...u,
            display_name: emp.display_name || u.display_name || u.email || u.user_id,
            work_email: emp.work_email || u.email || "",
            work_number: emp.work_number || "",
            personal_mobile: emp.mobile_number || u.phone || "",
          };
        });
      setHandlers(staff);
    } else {
      setHandlers((handlersRes.data || []) as any[]);
    }
    setHandlerRules((rulesRes.data || []) as any[]);
  };

  useEffect(() => { fetchRequests(); fetchRoutingData(); }, []);

  const filtered = statusFilter === "all" ? requests : requests.filter(r => statusMetaFor(r).key === statusFilter);
  const paidPending = requests.filter(r => ["paid", "under_review"].includes(statusMetaFor(r).key)).length;

  const fetchPgdmAudit = async (requestId: string) => {
    const { data } = await supabase
      .from("pgdm_certificate_audit" as any)
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });
    setPgdmAudit((data || []) as any[]);
  };

  const openDetail = (req: any) => {
    setSelectedReq(req);
    setReviewNotes(req.employee_review_notes || req.review_notes || "");
    setVerificationResult(req.employee_review_result || req.verification_result || "");
    setIssuanceDecision(
      req.status === "rejected"
        ? "rejected"
        : req.employee_review_result === "hold" ? "hold" : "verified"
    );
    setNewStatus(req.status);
    setReviewDocFile(null);
    setPgdmCertificateDetails(hydratePgdmDetails(req));
    setPgdmAudit([]);
    if (isPgdmDiplomaRequest(req)) fetchPgdmAudit(req.id);
  };

  const handleEmployeeReview = async () => {
    if (!selectedReq || !verificationResult) {
      toast({ title: "Please select a verification result", variant: "destructive" }); return;
    }
    if (!reviewDocFile) {
      toast({ title: "Please upload supporting document", variant: "destructive" }); return;
    }
    setSaving(true);

    // Upload review doc
    let docUrl = "";
    const ext = reviewDocFile.name.split(".").pop();
    const path = `${selectedReq.id}/review-doc.${ext}`;
    await supabase.storage.from("alumni-verification-docs").upload(path, reviewDocFile, { upsert: true });
    docUrl = path;

    // Generate draft email for super admin to review
    const resultForDraft = verificationResult === "recommended_approve" ? "confirmed" : "not_found";
    const draft = generateEmailDraft(selectedReq, resultForDraft);
    const draftText = `Subject: ${draft.subject}\n\n${draft.body}`;

    await supabase.from("alumni_verification_requests" as any).update({
      status: "under_review",
      employee_reviewed_by: user?.id,
      employee_review_notes: reviewNotes,
      employee_review_result: verificationResult,
      employee_review_doc_url: docUrl,
      employee_reviewed_at: new Date().toISOString(),
      employee_draft_email: draftText,
    }).eq("id", selectedReq.id);

    toast({ title: "Review submitted — pending super admin approval" });
    setSaving(false);
    setSelectedReq(null);
    fetchRequests();
  };

  const handleDetailsVerifiedForGeneration = async () => {
    if (!selectedReq || !isIssuanceRequest(selectedReq)) return;
    setSaving(true);

    try {
      let docUrl = selectedReq.employee_review_doc_url || "";
      if (reviewDocFile) {
        const ext = reviewDocFile.name.split(".").pop();
        const path = `${selectedReq.id}/details-verified-doc.${ext}`;
        await supabase.storage.from("alumni-verification-docs").upload(path, reviewDocFile, { upsert: true });
        docUrl = path;
      }

      const now = new Date().toISOString();
      const finalStatus = issuanceDecision === "rejected" ? "rejected" : "under_review";
      const reviewResult = issuanceDecision === "rejected"
        ? "recommended_reject"
        : issuanceDecision === "hold" ? "hold" : "recommended_approve";
      const updatePayload: Record<string, any> = {
        status: finalStatus,
        review_notes: reviewNotes,
        reviewed_by: user?.id,
        reviewed_at: now,
      };

      if (isSuperAdmin) {
        updatePayload.admin_approved_by = user?.id;
        updatePayload.admin_approval_notes = reviewNotes;
        updatePayload.admin_approved_at = now;
        if (docUrl) updatePayload.employee_review_doc_url = docUrl;
      } else {
        updatePayload.employee_reviewed_by = user?.id;
        updatePayload.employee_review_notes = reviewNotes;
        updatePayload.employee_review_result = reviewResult;
        updatePayload.employee_reviewed_at = now;
        if (docUrl) updatePayload.employee_review_doc_url = docUrl;
      }

      const { error } = await supabase
        .from("alumni_verification_requests" as any)
        .update(updatePayload)
        .eq("id", selectedReq.id);
      if (error) throw error;

      toast({
        title: issuanceDecision === "verified" ? "Details verified" : "Details not verified",
        description: issuanceActionLabel(selectedReq, issuanceDecision),
      });
      // On "verified", keep the dialog open with the updated status so the
      // PGDM certificate generator (gated on canWorkOnPgdmCertificate) renders
      // inline — otherwise "proceed to generate" appears to do nothing.
      if (issuanceDecision === "verified") {
        setSelectedReq((prev: any) => (prev ? { ...prev, ...updatePayload } : prev));
      } else {
        setSelectedReq(null);
      }
      fetchRequests();
    } catch (error) {
      toast({
        title: "Failed to update request",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const SERVICE_LABELS: Record<string, string> = {
    verification: "Student Verification", marksheet: "Marksheet Request",
    diploma: "Degree/Diploma Request", transcript: "Transcript Request",
  };
  const ISSUANCE_SERVICE_LABELS: Record<string, string> = {
    marksheet: "marksheet",
    diploma: "diploma",
    transcript: "transcript",
  };
  // Transcript is an issuance request (a document is issued to the candidate),
  // like marksheet/diploma — not an employer verification. Without this it fell
  // through to the verification review flow (Confirmed/Discrepancy/Not Found).
  const isIssuanceRequest = (req: any) => ["marksheet", "diploma", "transcript"].includes(req?.request_type);
  const issuanceDocumentName = (req: any) => ISSUANCE_SERVICE_LABELS[req?.request_type] || "document";
  const ISSUANCE_DECISION_OPTIONS = [
    { value: "verified", label: "Details verified - proceed to generate" },
    { value: "rejected", label: "Details not verified - Reject" },
    { value: "hold", label: "Details not verified - Hold" },
  ];
  const issuanceActionLabel = (req: any, decision = issuanceDecision) => {
    if (decision === "rejected") return "Details not verified - Reject";
    if (decision === "hold") return "Details not verified - Hold";
    return `Details verified - proceed to generate ${issuanceDocumentName(req)}`;
  };

  const handlerByUserId = new Map(handlers.map((h: any) => [h.user_id, h]));
  const courseById = new Map(courses.map((c: any) => [c.id, c]));
  const fallbackContact = {
    name: "Student Services Team",
    email: "umesh@nimt.ac.in",
    phone: "+91-7428477664",
  };
  // The stored assigned_handler_official_phone is a snapshot from assignment
  // time; prefer the handler's CURRENT number from the directory so a work
  // number added/changed after assignment shows immediately (work > mobile).
  const handlerPhoneFor = (req: any): string => {
    const h = handlerByUserId.get(req?.assigned_handler_user_id);
    return h?.work_number || h?.personal_mobile || req?.assigned_handler_official_phone || "";
  };
  const contactFor = (req: any) => ({
    name: req.assigned_handler_name || fallbackContact.name,
    email: req.assigned_handler_email || fallbackContact.email,
    phone: handlerPhoneFor(req) || fallbackContact.phone,
  });

  const isPgdmDiplomaRequest = (req: any) => {
    const courseText = `${req?.course || ""} ${req?.course_code || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return req?.request_type === "diploma" && (
      courseText.includes("pgdm") || courseText.includes("postgraduatediplomainmanagement")
    );
  };

  const canWorkOnPgdmCertificate = (req: any) => (
    isPgdmDiplomaRequest(req)
    && ["paid", "under_review", "verified"].includes(req?.status)
    && (
      isSuperAdmin
      || canManageStudentServices
      || req?.assigned_handler_user_id === user?.id
    )
  );

  const hydratePgdmDetails = (req: any): PgdmCertificateDetails => {
    const existing = normalizePgdmCertificateDetails(req?.pgdm_certificate_details);
    return {
      studentName: existing.studentName || req?.alumni_name || "",
      completedYear: existing.completedYear || (req?.year_of_passing ? String(req.year_of_passing) : ""),
      fileNo: existing.fileNo,
      enrollmentNo: existing.enrollmentNo || req?.enrollment_no || "",
      cgpa: existing.cgpa,
      equivalentPercentage: existing.equivalentPercentage,
      issueDay: existing.issueDay,
      issueMonthYear: existing.issueMonthYear,
    };
  };

  const updatePgdmDetail = (key: keyof PgdmCertificateDetails, value: string) => {
    setPgdmCertificateDetails(prev => ({ ...prev, [key]: value }));
  };

  const validatePgdmDetails = (details: PgdmCertificateDetails) => {
    const required: Array<[keyof PgdmCertificateDetails, string]> = [
      ["studentName", "Candidate name"],
      ["completedYear", "Completed year"],
      ["fileNo", "File no"],
      ["enrollmentNo", "Enrollment no"],
      ["cgpa", "CGPA"],
      ["equivalentPercentage", "Equivalent percentage"],
      ["issueDay", "Issue day"],
      ["issueMonthYear", "Issue month and year"],
    ];
    const missing = required.find(([key]) => !details[key]?.trim());
    if (missing) {
      toast({ title: `${missing[1]} is required`, variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleCreateRule = async () => {
    if (!ruleDraft.handler_user_id) {
      toast({ title: "Select a handler", variant: "destructive" }); return;
    }
    if (!ruleDraft.course_id && !ruleDraft.course_text && ruleDraft.batch_year) {
      toast({ title: "Batch-specific rules need a course", variant: "destructive" }); return;
    }
    setRuleSaving(true);
    const selectedCourse = courses.find((c: any) => c.id === ruleDraft.course_id);
    const { error } = await supabase.from("student_service_handler_rules" as any).insert({
      service_type: ruleDraft.service_type,
      course_id: ruleDraft.course_id || null,
      course_text: ruleDraft.course_id ? selectedCourse?.name || null : ruleDraft.course_text || null,
      batch_year: ruleDraft.batch_year ? parseInt(ruleDraft.batch_year) : null,
      handler_user_id: ruleDraft.handler_user_id,
      created_by: user?.id || null,
      updated_by: user?.id || null,
    });
    if (error) {
      toast({ title: "Failed to save rule", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Handler rule saved" });
      setRuleDraft({ service_type: "verification", course_id: "", course_text: "", batch_year: "", handler_user_id: "" });
      setShowRuleForm(false);
      fetchRoutingData();
    }
    setRuleSaving(false);
  };

  const handleDeactivateRule = async (ruleId: string) => {
    const { error } = await supabase
      .from("student_service_handler_rules" as any)
      .update({ is_active: false, updated_by: user?.id || null })
      .eq("id", ruleId);
    if (error) toast({ title: "Failed to remove rule", description: error.message, variant: "destructive" });
    else { toast({ title: "Handler rule removed" }); fetchRoutingData(); }
  };

  const isMissingRpcError = (error: any) => (
    error?.code === "PGRST202"
    || /Could not find the function|schema cache/i.test(error?.message || "")
  );

  const assignRequestDirectly = async (handlerUserId: string) => {
    if (!selectedReq) return;
    const handler = handlerByUserId.get(handlerUserId) || {};
    const { data: profile } = await supabase
      .from("profiles" as any)
      .select("id, user_id, display_name, email")
      .eq("user_id", handlerUserId)
      .maybeSingle();

    const displayName = handler.display_name || (profile as any)?.display_name || (profile as any)?.email || "Assigned handler";
    const workEmail = handler.work_email || (profile as any)?.email || "";
    const officialPhone = handler.work_number || handler.personal_mobile || "";

    const { error } = await supabase
      .from("alumni_verification_requests" as any)
      .update({
        assigned_handler_user_id: handlerUserId,
        assigned_handler_profile_id: (profile as any)?.id || null,
        assigned_handler_name: displayName,
        assigned_handler_email: workEmail,
        assigned_handler_official_phone: officialPhone,
        assigned_at: new Date().toISOString(),
        assignment_rule_id: null,
        assignment_status: "manual",
      })
      .eq("id", selectedReq.id);
    if (error) throw error;

    await supabase.from("notifications" as any).insert({
      user_id: handlerUserId,
      type: "student_service_assigned",
      title: "Student Services request assigned",
      body: `${selectedReq.request_number || "Request"} - ${selectedReq.alumni_name || "Student"} | ${selectedReq.course || "Course"} batch ${selectedReq.year_of_passing || "-"}`,
      link: "/alumni-verifications",
    });
  };

  const handleAssignRequest = async (handlerUserId: string) => {
    if (!selectedReq || !handlerUserId) return;
    setAssigningHandler(true);
    try {
      const { error } = await supabase.rpc("admin_assign_student_service_request" as any, {
        _request_id: selectedReq.id,
        _handler_user_id: handlerUserId,
      });
      if (error) {
        if (!isMissingRpcError(error)) throw error;
        await assignRequestDirectly(handlerUserId);
        toast({
          title: "Handler assigned",
          description: "Assigned directly because the backend RPC is not deployed yet. Official Allotted No was used.",
        });
      } else {
        toast({ title: "Handler assigned", description: "TAT email and WhatsApp will use the official allotted number." });
      }
      setSelectedReq(null);
      fetchRequests();
    } catch (error) {
      toast({
        title: "Assignment failed",
        description: error instanceof Error ? error.message : "Please apply the Student Services routing migration and try again.",
        variant: "destructive",
      });
    } finally {
      setAssigningHandler(false);
    }
  };

  const generateEmailDraft = (req: any, result: string) => {
    const serviceName = SERVICE_LABELS[req.request_type || "verification"] || "Alumni Service";
    const contactName = req.contact_name || "Sir/Madam";

    if (result === "confirmed") {
      return {
        subject: `${serviceName} Confirmed — ${req.request_number} — ${req.alumni_name}`,
        body: `Dear ${contactName},

Ref: ${req.request_number}
Service: ${serviceName}

This is to inform that the student ${req.alumni_name} is a bonafide alumnus of NIMT Institute of Management & Technology, Greater Noida, Uttar Pradesh batch ${req.year_of_passing} of ${req.course} Course.${req.enrollment_no ? ` The Candidate's enrollment number during the course tenure had been ${req.enrollment_no}.` : ""}

${req.request_type === "verification" ? `This verification has been done as per the request received from ${req.employer_name}.` : ""}

	For any further queries, please contact ${contactFor(req).name} at ${contactFor(req).email} or call ${contactFor(req).phone}.

Regards,
Office of the Registrar
NIMT Educational Institutions
Knowledge Park-1, Greater Noida, UP - 201310
registrar@nimt.ac.in`,
      };
    } else if (result === "discrepancy_marks") {
      return {
        subject: `${serviceName} — Discrepancy Found — ${req.request_number} — ${req.alumni_name}`,
        body: `Dear ${contactName},

Ref: ${req.request_number}
Service: ${serviceName}

With reference to your verification request for ${req.alumni_name} (${req.course}, Batch ${req.year_of_passing}), we wish to inform that while the student's enrollment record exists in our database, certain academic details such as marks/percentage/pass-fail status in the documents provided do not match our official records.

This indicates a possible modification or discrepancy in the documents submitted for verification.${req.enrollment_no ? ` The student's enrollment number on our records is ${req.enrollment_no}.` : ""}

	We recommend further investigation at your end. For any clarification, please contact ${contactFor(req).name} at ${contactFor(req).email} or call ${contactFor(req).phone}.

Regards,
Office of the Registrar
NIMT Educational Institutions
Knowledge Park-1, Greater Noida, UP - 201310
registrar@nimt.ac.in`,
      };
    } else {
      return {
        subject: `${serviceName} — Record Not Found — ${req.request_number} — ${req.alumni_name}`,
        body: `Dear ${contactName},

Ref: ${req.request_number}
Service: ${serviceName}

With reference to your verification request for ${req.alumni_name} (${req.course}, Batch ${req.year_of_passing}), we wish to inform that no matching alumni record exists in our database for the details provided.

The student does not appear in our enrollment records. The documents submitted for verification could not be authenticated.

	For any clarification, please contact ${contactFor(req).name} at ${contactFor(req).email} or call ${contactFor(req).phone}.

Regards,
Office of the Registrar
NIMT Educational Institutions
Knowledge Park-1, Greater Noida, UP - 201310
registrar@nimt.ac.in`,
      };
    }
  };

  // Step 1: Admin clicks approve/reject → shows email preview
  const handlePrepareResult = (approve: boolean) => {
    if (!selectedReq) return;

    const result = verificationResult || (approve ? "confirmed" : "not_found");
    if (!result) {
      toast({ title: "Please select a verification result", variant: "destructive" }); return;
    }

    // For direct review (no employee review), require document
    if (!selectedReq.employee_reviewed_at && !selectedReq.employee_review_doc_url && !reviewDocFile) {
      toast({ title: "Please upload a supporting document", variant: "destructive" }); return;
    }

    const draft = generateEmailDraft(selectedReq, result);
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
    setSendEmailEnabled(true);
    setShowEmailPreview(true);
  };

  // Step 2: Confirm and send email from preview dialog
  const handleConfirmAndSend = async () => {
    if (!selectedReq) return;
    setEmailSending(true);

    const result = verificationResult || "confirmed";
    const finalStatus = "verified"; // Request is processed regardless of result (confirmed/discrepancy/not_found)

    // Upload doc if provided
    if (reviewDocFile) {
      const ext = reviewDocFile.name.split(".").pop();
      const path = `${selectedReq.id}/admin-review-doc.${ext}`;
      await supabase.storage.from("alumni-verification-docs").upload(path, reviewDocFile, { upsert: true });
      await supabase.from("alumni_verification_requests" as any)
        .update({ employee_review_doc_url: path }).eq("id", selectedReq.id);
    }

    const approvedAt = new Date().toISOString();

    // Update status + store the approved email text for audit (only when it's
    // actually sent, so the "Final Email Sent" record isn't misleading).
    await supabase.from("alumni_verification_requests" as any).update({
      status: finalStatus,
      verification_result: result,
      review_notes: reviewNotes,
      reviewed_by: user?.id,
      reviewed_at: approvedAt,
      admin_approved_by: user?.id,
      admin_approval_notes: reviewNotes,
      admin_approved_at: approvedAt,
      ...(sendEmailEnabled ? { sent_email_subject: emailSubject, sent_email_body: emailBody } : {}),
    }).eq("id", selectedReq.id);

    // Send email (skipped when the "send email" toggle is off)
    if (sendEmailEnabled && selectedReq.contact_email) {
      try {
        const htmlBody = emailBody.replace(/\n/g, "<br/>");
        const { error: emailErr } = await supabase.functions.invoke("send-email", {
          body: {
            to_email: selectedReq.contact_email,
            custom_subject: emailSubject,
            custom_body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">${htmlBody}</div>`,
            cc: "academics@nimt.ac.in",
          },
        });
        if (emailErr) {
          toast({ title: "Status updated but email failed", description: emailErr.message, variant: "destructive" });
        }
      } catch (e) {
        console.error("Email failed:", e);
      }
    }

    // Send WhatsApp (plain text, not template) — only when emailing, since the
    // message tells the requestor to check their email.
    try {
      const waPhone = selectedReq.requestor_phone?.replace(/[^0-9]/g, "");
      if (sendEmailEnabled && waPhone) {
        const whatsappToken = (await supabase.functions.invoke("alumni-payment", { body: { action: "noop" } })); // dummy to get env
        // Use direct Graph API via alumni-payment or just call whatsapp-send with a custom approach
        // For now, send via the webhook's plain text pattern
        const msg = `Dear ${selectedReq.contact_name || selectedReq.alumni_name},\n\nThe result of your Student Services request (${selectedReq.request_number}) has been emailed to ${selectedReq.contact_email}.\n\nPlease do not reply or call back on this number. This is an automated notification.\n\n— NIMT Educational Institutions`;

        // Use whatsapp-send function but pass as a plain text via a workaround
        // Actually, let's call the Graph API directly through alumni-payment function
        await fetch(`${window.location.origin.replace(':8081', ':54321')}/functions/v1/alumni-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send-wa", phone: selectedReq.requestor_phone, message: msg }),
        }).catch(() => {});
        // Fallback: the email is the primary notification channel
      }
    } catch (e) {
      console.error("WhatsApp error:", e);
    }

    toast({
      title: sendEmailEnabled
        ? `Result sent to ${selectedReq.contact_email}`
        : "Result recorded (email not sent)",
    });
    setEmailSending(false);
    setShowEmailPreview(false);
    setSelectedReq(null);
    fetchRequests();
  };

  const handleManualEntry = async () => {
    if (!manualData.alumni_name || !manualData.course || !manualData.year_of_passing || !manualData.contact_name) {
      toast({ title: "Fill required fields", variant: "destructive" }); return;
    }
    setManualSaving(true);

    const { data: req, error } = await supabase
      .from("alumni_verification_requests" as any)
      .insert({
        request_type: manualData.request_type,
        course_id: manualData.course_id || null,
        requestor_phone: manualData.contact_phone_spoc || "+910000000000",
        contact_name: manualData.contact_name,
        contact_phone_spoc: manualData.contact_phone_spoc || "",
        contact_email: manualData.contact_email || "",
        employer_name: manualData.employer_name || "Manual Entry",
        alumni_name: manualData.alumni_name,
        course: manualData.course,
        year_of_passing: parseInt(manualData.year_of_passing),
        enrollment_no: manualData.enrollment_no || null,
        campus: manualData.campus || null,
        fee_amount: parseFloat(manualData.fee_amount),
        status: manualData.status,
        paid_at: manualData.status === "paid" ? new Date().toISOString() : null,
        payment_method: manualData.status === "paid" ? "manual" : null,
        batch_number: "BACKLOG",
      })
      .select("id, request_number")
      .single();

    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      setManualSaving(false); return;
    }

    // Upload payment proof
    if (manualPaymentProof && req) {
      const ext = manualPaymentProof.name.split(".").pop();
      const path = `${(req as any).id}/payment-proof.${ext}`;
      await supabase.storage.from("alumni-verification-docs").upload(path, manualPaymentProof, { upsert: true });
      await supabase.from("alumni_verification_requests" as any)
        .update({ additional_doc_urls: [path] })
        .eq("id", (req as any).id);
    }

    toast({ title: "Request created", description: `${(req as any).request_number}` });
    setManualSaving(false);
    setShowManualEntry(false);
    setManualData({ request_type: "verification", alumni_name: "", course: "", year_of_passing: "",
      employer_name: "", contact_name: "", contact_email: "", contact_phone_spoc: "",
      enrollment_no: "", campus: "", fee_amount: "1500", status: "paid", course_id: "" });
    setManualPaymentProof(null);
    fetchRequests();
  };

  const openOfflinePayDialog = () => {
    setOfflinePayMode("cash");
    setOfflinePayRef("");
    setShowOfflinePay(true);
  };

  const submitOfflinePayment = async () => {
    if (!selectedReq || selectedReq.status !== "pending_payment" || !canManageStudentServices) return;
    // UPI / bank / cheque are reference-bearing modes — require it like the
    // finance dialog does; cash needs none.
    if (["upi", "bank_transfer", "cheque"].includes(offlinePayMode) && !offlinePayRef.trim()) {
      toast({ title: "Reference / transaction number is required for this mode", variant: "destructive" });
      return;
    }
    const method = OFFLINE_PAYMENT_MODES.find(m => m.value === offlinePayMode)?.label || offlinePayMode;
    const reference = offlinePayRef.trim() || null;
    setMarkingPaid(true);
    try {
      const { error } = await supabase.rpc("mark_alumni_request_paid_offline" as any, {
        _request_id: selectedReq.id,
        _method: method,
        _reference: reference,
      });
      if (error) throw error;
      toast({ title: "Payment recorded", description: "Request moved to Pending Review." });
      const patch = { status: "paid", paid_at: new Date().toISOString(), payment_method: method, payment_ref: reference };
      setSelectedReq((prev: any) => prev ? { ...prev, ...patch } : prev);
      setShowOfflinePay(false);
      fetchRequests();
    } catch (error) {
      toast({
        title: "Failed to record payment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setMarkingPaid(false);
    }
  };

  const getDocUrl = async (path: string) => {
    const { data } = await supabase.storage.from("alumni-verification-docs").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const uploadPgdmCertificatePdf = async (req: any, details: PgdmCertificateDetails) => {
    const pdfBlob = await generatePgdmCertificatePdf(details, req?.campus);
    const path = `${req.id}/pgdm-certificate.pdf`;
    const { error } = await supabase.storage
      .from("alumni-verification-docs")
      .upload(path, pdfBlob, { contentType: "application/pdf", upsert: true });
    if (error) throw error;
    return path;
  };

  const handleSubmitPgdmCertificate = async () => {
    if (!selectedReq || !validatePgdmDetails(pgdmCertificateDetails)) return;
    setPgdmCertificateSaving(true);
    try {
      const path = await uploadPgdmCertificatePdf(selectedReq, pgdmCertificateDetails);
      const { error } = await supabase.rpc("submit_pgdm_certificate_for_approval" as any, {
        _request_id: selectedReq.id,
        _details: pgdmCertificateDetails as any,
        _pdf_path: path,
      });
      if (error) throw error;
      toast({ title: "PGDM certificate submitted", description: "Superadmin has been notified for approval." });
      // Advance the open dialog to pending_approval so the approve step is
      // reachable without reopening the request.
      setSelectedReq((prev: any) => prev ? {
        ...prev,
        pgdm_certificate_status: "pending_approval",
        pgdm_certificate_details: pgdmCertificateDetails,
        pgdm_certificate_pdf_path: path,
        pgdm_certificate_submitted_at: new Date().toISOString(),
        status: prev.status === "paid" ? "under_review" : prev.status,
      } : prev);
      fetchRequests();
      fetchPgdmAudit(selectedReq.id);
    } catch (error) {
      toast({
        title: "Failed to submit certificate",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPgdmCertificateSaving(false);
    }
  };

  const handleApprovePgdmCertificate = async () => {
    if (!selectedReq) return;
    setPgdmCertificateSaving(true);
    try {
      const { error } = await supabase.rpc("approve_pgdm_certificate" as any, {
        _request_id: selectedReq.id,
        _approval_notes: reviewNotes || null,
      });
      if (error) throw error;
      toast({ title: "PGDM certificate approved", description: "The assigned handler has been notified." });
      // Advance the open dialog to approved so Download for Print appears inline.
      setSelectedReq((prev: any) => prev ? {
        ...prev,
        pgdm_certificate_status: "approved",
        pgdm_certificate_approved_at: new Date().toISOString(),
        pgdm_certificate_approval_notes: reviewNotes || null,
      } : prev);
      fetchRequests();
      fetchPgdmAudit(selectedReq.id);
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPgdmCertificateSaving(false);
    }
  };

  const handleDownloadPgdmCertificate = async () => {
    if (!selectedReq) return;
    if (!["approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)) {
      toast({ title: "Approval required before download", variant: "destructive" });
      return;
    }
    setPgdmCertificateSaving(true);
    try {
      if (selectedReq.pgdm_certificate_pdf_path) {
        await getDocUrl(selectedReq.pgdm_certificate_pdf_path);
      } else {
        const pdfBlob = await generatePgdmCertificatePdf(pgdmCertificateDetails, selectedReq.campus);
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = pgdmCertificateFileName(selectedReq.request_number, pgdmCertificateDetails.studentName);
        link.click();
        URL.revokeObjectURL(url);
      }
      await supabase.rpc("mark_pgdm_certificate_downloaded" as any, { _request_id: selectedReq.id });
      setSelectedReq((prev: any) => prev ? { ...prev, pgdm_certificate_downloaded_at: prev.pgdm_certificate_downloaded_at || new Date().toISOString() } : prev);
      fetchRequests();
      fetchPgdmAudit(selectedReq.id);
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPgdmCertificateSaving(false);
    }
  };

  const handleNotifyPgdmReady = async () => {
    if (!selectedReq) return;
    setPgdmCertificateSaving(true);
    try {
      const { error } = await supabase.rpc("notify_pgdm_diploma_ready_for_collection" as any, {
        _request_id: selectedReq.id,
      });
      if (error) throw error;
      toast({ title: "Student notified", description: "WhatsApp collection message has been queued." });
      setSelectedReq(null);
      fetchRequests();
    } catch (error) {
      toast({
        title: "Failed to notify student",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPgdmCertificateSaving(false);
    }
  };

  // Reopen a submitted/approved certificate for correction. Regenerating a new
  // PDF must go back through approval, so this clears the approval + submission
  // stamps and returns the certificate to an editable draft.
  const handleRegeneratePgdmCertificate = async () => {
    if (!selectedReq) return;
    // Regenerate reverts a submitted/approved certificate to draft and pulls it
    // out of the approval queue — a submitted cert was lost this way before, so
    // confirm the intent explicitly.
    if (["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)) {
      const label = selectedReq.pgdm_certificate_status === "pending_approval" ? "pending approval" : selectedReq.pgdm_certificate_status;
      if (!window.confirm(`This certificate is ${label.replace(/_/g, " ")}. Reopening returns it to draft and removes it from the approval queue until you submit again. Continue?`)) return;
    }
    setPgdmCertificateSaving(true);
    try {
      const { error } = await supabase.rpc("regenerate_pgdm_certificate" as any, {
        _request_id: selectedReq.id,
      });
      if (error) throw error;
      const cleared = {
        pgdm_certificate_status: "draft",
        pgdm_certificate_submitted_by: null,
        pgdm_certificate_submitted_at: null,
        pgdm_certificate_approved_by: null,
        pgdm_certificate_approved_at: null,
        pgdm_certificate_approval_notes: null,
        pgdm_certificate_downloaded_at: null,
      };
      toast({ title: "Certificate reopened", description: "Edit the details, then Generate & Submit for approval again." });
      setSelectedReq((prev: any) => prev ? { ...prev, ...cleared } : prev);
      fetchRequests();
      if (selectedReq) fetchPgdmAudit(selectedReq.id);
    } catch (error) {
      toast({
        title: "Failed to reopen certificate",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPgdmCertificateSaving(false);
    }
  };

  // Pagination
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedRequests = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [statusFilter]);

  if (loading) return <PageLoader />;

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Student Services</h1>
          <p className="text-sm text-muted-foreground mt-1">Review, assign, and manage service requests</p>
        </div>
        <div className="flex items-center gap-3">
          {paidPending > 0 && (
            <Badge className="bg-destructive/10 text-destructive border-0 text-sm font-bold gap-1">
              <Clock className="h-3.5 w-3.5" /> {paidPending} Pending
            </Badge>
          )}
          <Button variant="outline" className="gap-1.5" onClick={() => setShowManualEntry(true)}>
            <Plus className="h-4 w-4" /> Add Manual Request
          </Button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex rounded-xl border border-input bg-card p-0.5 w-fit overflow-x-auto">
        {[{ key: "all", label: `All (${requests.length})` }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({
          key: k, label: `${v.label.split(" —")[0]} (${requests.filter(r => statusMetaFor(r).key === k).length})`,
        }))].map(t => (
          <button key={t.key} onClick={() => setStatusFilter(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${statusFilter === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {canManageStudentServices && (
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Handler Allocation</h2>
                <p className="text-xs text-muted-foreground">Assign Student Services requests by service, course, and batch. WhatsApp uses Official Allotted No.</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowRuleForm(v => !v)}>
                <UserCheck className="h-4 w-4" /> {showRuleForm ? "Hide" : "Add Rule"}
              </Button>
            </div>

            {showRuleForm && (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 rounded-xl border border-border bg-muted/20 p-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Service</label>
                  <select value={ruleDraft.service_type} onChange={e => setRuleDraft(p => ({ ...p, service_type: e.target.value }))} className={inputCls}>
                    {Object.entries(SERVICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Course</label>
                  <select value={ruleDraft.course_id} onChange={e => {
                    const selected = courses.find((c: any) => c.id === e.target.value);
                    setRuleDraft(p => ({ ...p, course_id: e.target.value, course_text: selected?.name || "" }));
                  }} className={inputCls}>
                    <option value="">Global / text fallback</option>
                    {courses.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}{c.is_active === false ? " · inactive" : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Course Text</label>
                  <input value={ruleDraft.course_text} onChange={e => setRuleDraft(p => ({ ...p, course_text: e.target.value, course_id: "" }))} placeholder="Legacy course name" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Batch Year</label>
                  <input type="number" value={ruleDraft.batch_year} onChange={e => setRuleDraft(p => ({ ...p, batch_year: e.target.value }))} placeholder="Optional" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Handler</label>
                  <select value={ruleDraft.handler_user_id} onChange={e => setRuleDraft(p => ({ ...p, handler_user_id: e.target.value }))} className={inputCls}>
                    <option value="">Select</option>
                    {handlers.map((h: any) => (
                      <option key={h.user_id} value={h.user_id}>{h.display_name} {(h.work_number || h.personal_mobile) ? "" : "(no phone on file)"}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-5 flex justify-end">
                  <Button size="sm" onClick={handleCreateRule} disabled={ruleSaving} className="gap-1.5">
                    {ruleSaving ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
                    Save Rule
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-left font-semibold">Service</th>
                    <th className="py-2 text-left font-semibold">Course</th>
                    <th className="py-2 text-left font-semibold">Batch</th>
                    <th className="py-2 text-left font-semibold">Handler</th>
                    <th className="py-2 text-left font-semibold">Official No</th>
                    <th className="py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {handlerRules.length === 0 ? (
                    <tr><td colSpan={6} className="py-3 text-muted-foreground">No handler rules yet. Paid requests without a rule will notify admins as unassigned.</td></tr>
                  ) : handlerRules.map((rule: any) => {
                    const handler = handlerByUserId.get(rule.handler_user_id) || {};
                    const c = rule.course_id ? courseById.get(rule.course_id) : null;
                    return (
                      <tr key={rule.id} className="border-b border-border/40">
                        <td className="py-2">{SERVICE_LABELS[rule.service_type] || rule.service_type}</td>
                        <td className="py-2">{c?.name || rule.course_text || "Global"}</td>
                        <td className="py-2">{rule.batch_year || "Any"}</td>
                        <td className="py-2">{handler.display_name || rule.handler_user_id}</td>
                        <td className="py-2">{handler.work_number || handler.personal_mobile || <span className="text-amber-600">Missing</span>}</td>
                        <td className="py-2 text-right">
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDeactivateRule(rule.id)}>Remove</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No requests found</div>
          ) : (
            <div className="overflow-x-auto">
              {/* Count + pagination header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-semibold text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</span> of <span className="font-semibold text-foreground">{filtered.length}</span>
                </p>
                {totalPages > 1 && (
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
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Request #</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Type</th>
	                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Alumni</th>
	                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
	                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Handler</th>
	                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Result</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Due / Completed</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">TAT</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRequests.map((req: any) => {
                    const cfg = statusMetaFor(req);
                    const isOverdue = req.due_date && new Date(req.due_date) < new Date() && ["paid", "under_review"].includes(req.status);
                    const daysLeft = req.due_date ? Math.ceil((new Date(req.due_date).getTime() - Date.now()) / 86400000) : null;
                    return (
                      <tr key={req.id} className={`border-b border-border/40 hover:bg-muted/20 cursor-pointer ${isOverdue ? "bg-destructive/5/50 dark:bg-destructive/90/10" : ""}`}
                        onClick={() => openDetail(req)}>
                        <td className="px-4 py-3 font-mono font-bold text-primary text-xs">{req.request_number}</td>
                        <td className="px-3 py-3 text-center">
                          <Badge className="border-0 text-[9px] font-semibold bg-muted text-foreground capitalize">{(req.request_type || "verification").replace("_", " ")}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{req.alumni_name}</div>
                          <div className="text-[10px] text-muted-foreground">{req.employer_name !== "Self" ? req.employer_name : ""}</div>
                        </td>
	                        <td className="px-4 py-3 text-muted-foreground">{req.course} ({req.year_of_passing})</td>
	                        <td className="px-4 py-3 text-xs">
	                          {req.assigned_handler_user_id ? (
	                            <div>
	                              <div className="font-medium text-foreground">{req.assigned_handler_name || "Assigned"}</div>
	                              <div className="text-[10px] text-muted-foreground">{handlerPhoneFor(req) || "Official no missing"}</div>
	                            </div>
	                          ) : (
	                            <span className="text-amber-600 font-medium">Unassigned</span>
	                          )}
	                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge className={`border-0 text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</Badge>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {req.verification_result ? (
                            <Badge className={`border-0 text-[10px] font-semibold ${(RESULT_LABELS[req.verification_result] || {}).color || "bg-muted"}`}>
                              {(RESULT_LABELS[req.verification_result] || {}).label || req.verification_result}
                            </Badge>
                          ) : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center text-xs">
                          {req.status === "verified" && req.reviewed_at ? (
                            <span className="text-success font-medium">{new Date(req.reviewed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                          ) : req.due_date ? (
                            <span>{new Date(req.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {daysLeft !== null && ["paid", "under_review"].includes(req.status) ? (
                            <span className={`text-[10px] font-bold ${isOverdue ? "text-destructive" : daysLeft <= 2 ? "text-warning-foreground" : "text-success"}`}>
                              {isOverdue ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                            </span>
                          ) : req.status === "verified" ? (
                            <span className="text-[10px] text-success font-medium">Done</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={(e) => { e.stopPropagation(); openDetail(req); }}
                            >
                              <Eye className="h-3 w-3" /> View
                            </Button>
                            {isSuperAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => { e.stopPropagation(); handleDelete(req); }}
                                disabled={deleting}
                              >
                                {deleting ? <ButtonOrb state="working" /> : <Trash2 className="h-3 w-3" />}
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail + Review Dialog */}
      <Dialog open={!!selectedReq} onOpenChange={(o) => { if (!o) setSelectedReq(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {selectedReq?.request_number}
              {selectedReq?.due_date && ["paid", "under_review"].includes(selectedReq?.status) && (
                <Badge className={`ml-2 border-0 text-[10px] ${
                  new Date(selectedReq.due_date) < new Date() ? "bg-destructive/10 text-destructive" : "bg-info/10 text-info-foreground"
                }`}>
                  Due: {new Date(selectedReq.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedReq && (
            <div className="space-y-4">
              {/* Requestor */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Requestor</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Contact:</span> <span className="font-medium">{selectedReq.contact_name}</span></div>
                  <div><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{selectedReq.contact_phone_spoc}</span></div>
                  <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{selectedReq.contact_email || "—"}</span></div>
                  <div><span className="text-muted-foreground">Employer:</span> <span className="font-medium">{selectedReq.employer_name}</span></div>
                  {selectedReq.third_party_company && (
                    <div className="col-span-2"><span className="text-muted-foreground">Agency:</span> <span className="font-medium">{selectedReq.third_party_company}</span></div>
                  )}
                </div>
              </div>

              {/* Alumni */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Alumni</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2"><span className="text-muted-foreground">Name:</span> <span className="font-bold">{selectedReq.alumni_name}</span></div>
                  <div><span className="text-muted-foreground">Course:</span> <span className="font-medium">{selectedReq.course}</span></div>
                  <div><span className="text-muted-foreground">Year:</span> <span className="font-medium">{selectedReq.year_of_passing}</span></div>
                  {selectedReq.enrollment_no && <div><span className="text-muted-foreground">Enrollment:</span> <span className="font-medium">{selectedReq.enrollment_no}</span></div>}
                  {selectedReq.campus && <div><span className="text-muted-foreground">Campus:</span> <span className="font-medium">{selectedReq.campus}</span></div>}
                </div>
              </div>

              {/* Documents */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Documents</p>
                <div className="space-y-1.5">
                  {selectedReq.diploma_certificate_url && (
                    <button onClick={() => getDocUrl(selectedReq.diploma_certificate_url)} className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Diploma <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                  {(selectedReq.marksheet_urls || []).map((u: string, i: number) => (
                    <button key={i} onClick={() => getDocUrl(u)} className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Marksheet {i + 1} <ExternalLink className="h-3 w-3" />
                    </button>
                  ))}
                  {(selectedReq.additional_doc_urls || []).map((u: string, i: number) => (
                    <button key={i} onClick={() => getDocUrl(u)} className="flex items-center gap-2 text-sm text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Additional Doc {i + 1} <ExternalLink className="h-3 w-3" />
                    </button>
                  ))}
                  {selectedReq.employee_review_doc_url && (
                    <button onClick={() => getDocUrl(selectedReq.employee_review_doc_url)} className="flex items-center gap-2 text-sm text-success hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Review Document <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Payment */}
              <div className="rounded-xl border border-border p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Payment</p>
                <div className="flex items-center justify-between text-sm">
                  <span>&#8377;{selectedReq.fee_amount} · {selectedReq.payment_method || "—"}</span>
                  {selectedReq.paid_at ? <Badge className="bg-success/10 text-success border-0 text-[10px]">Paid</Badge> : <Badge className="bg-gray-100 text-gray-600 border-0 text-[10px]">Unpaid</Badge>}
                </div>
                {selectedReq.payment_ref && <p className="text-[10px] text-muted-foreground">Ref: {selectedReq.payment_ref}</p>}
                {canManageStudentServices && selectedReq.status === "pending_payment" && (
                  <div className="pt-1">
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={openOfflinePayDialog} disabled={markingPaid}>
                      <IndianRupee className="h-3.5 w-3.5" />
                      Mark Offline Payment
                    </Button>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Use for cash/UPI/bank payments or to reconcile an online payment that didn't confirm.
                    </p>
                  </div>
                )}
              </div>

              {/* Handler assignment */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Student Services Handler</p>
                {selectedReq.assigned_handler_user_id ? (
                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{selectedReq.assigned_handler_name || "Assigned handler"}</span></p>
                    <p><span className="text-muted-foreground">Email:</span> <span className="font-medium">{selectedReq.assigned_handler_email || "—"}</span></p>
                    <p><span className="text-muted-foreground">Official Allotted No:</span> <span className="font-medium">{handlerPhoneFor(selectedReq) || "—"}</span></p>
                    <p className="text-[10px] text-muted-foreground">Assignment: {selectedReq.assignment_status || "assigned"}{selectedReq.assigned_at ? ` · ${new Date(selectedReq.assigned_at).toLocaleString("en-IN")}` : ""}</p>
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 font-medium">No handler assigned yet.</p>
                )}
                {canManageStudentServices && ["pending_payment", "paid", "under_review"].includes(selectedReq.status) && (
                  <div className="flex gap-2 pt-2">
                    <select
                      value={selectedReq.assigned_handler_user_id || ""}
                      onChange={e => handleAssignRequest(e.target.value)}
                      disabled={assigningHandler}
                      className={inputCls}
                    >
                      <option value="">Assign handler...</option>
                      {handlers.map((h: any) => (
                        <option key={h.user_id} value={h.user_id}>{h.display_name} {(h.work_number || h.personal_mobile) ? "" : "(no phone on file)"}</option>
                      ))}
                    </select>
                    {assigningHandler && <ButtonOrb state="working" />}
                  </div>
                )}
              </div>

              {canWorkOnPgdmCertificate(selectedReq) && (
                <div className="rounded-xl border border-border p-3 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase">PGDM Certificate</p>
                      <p className="text-xs text-muted-foreground">
                        Status: <span className="font-semibold text-foreground">{(selectedReq.pgdm_certificate_status || "not_started").replace(/_/g, " ")}</span>
                        {selectedReq.pgdm_certificate_submitted_at ? ` · Submitted ${new Date(selectedReq.pgdm_certificate_submitted_at).toLocaleString("en-IN")}` : ""}
                      </p>
                    </div>
                    {selectedReq.pgdm_certificate_approved_at && (
                      <Badge className="border-0 bg-emerald-100 text-emerald-700 text-[10px]">
                        Approved {new Date(selectedReq.pgdm_certificate_approved_at).toLocaleDateString("en-IN")}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2">
                          <label className="text-xs font-medium text-foreground mb-1 block">Candidate Name *</label>
                          <input
                            value={pgdmCertificateDetails.studentName}
                            onChange={e => updatePgdmDetail("studentName", e.target.value)}
                            disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)}
                            className={inputCls}
                          />
                        </div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">Completed Year *</label><input value={pgdmCertificateDetails.completedYear} onChange={e => updatePgdmDetail("completedYear", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} /></div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">File No *</label><input value={pgdmCertificateDetails.fileNo} onChange={e => updatePgdmDetail("fileNo", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} placeholder="Res/PGDM/2005/Vol.9" /></div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">Enrollment No *</label><input value={pgdmCertificateDetails.enrollmentNo} onChange={e => updatePgdmDetail("enrollmentNo", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} /></div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">CGPA *</label><input value={pgdmCertificateDetails.cgpa} onChange={e => updatePgdmDetail("cgpa", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} /></div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">Equivalent Percentage *</label><input value={pgdmCertificateDetails.equivalentPercentage} onChange={e => updatePgdmDetail("equivalentPercentage", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} /></div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">Issue Day *</label><input value={pgdmCertificateDetails.issueDay} onChange={e => updatePgdmDetail("issueDay", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} placeholder="30th" /></div>
                        <div><label className="text-xs font-medium text-foreground mb-1 block">Issue Month & Year *</label><input value={pgdmCertificateDetails.issueMonthYear} onChange={e => updatePgdmDetail("issueMonthYear", e.target.value)} disabled={["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status)} className={inputCls} placeholder="November 2005" /></div>
                      </div>

                      {selectedReq.pgdm_certificate_approval_notes && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          Approval notes: {selectedReq.pgdm_certificate_approval_notes}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {!["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status) && (
                          <Button onClick={handleSubmitPgdmCertificate} disabled={pgdmCertificateSaving} className="gap-2">
                            {pgdmCertificateSaving ? <ButtonOrb state="working" onFilled /> : <Send className="h-4 w-4" />}
                            Generate &amp; Submit for Approval
                          </Button>
                        )}
                        {isSuperAdmin && selectedReq.pgdm_certificate_status === "pending_approval" && (
                          <Button onClick={handleApprovePgdmCertificate} disabled={pgdmCertificateSaving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                            {pgdmCertificateSaving ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
                            Approve Certificate
                          </Button>
                        )}
                        {["approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status) && (
                          <Button variant="outline" onClick={handleDownloadPgdmCertificate} disabled={pgdmCertificateSaving} className="gap-2">
                            {pgdmCertificateSaving ? <ButtonOrb state="working" /> : <Download className="h-4 w-4" />}
                            Download for Print
                          </Button>
                        )}
                        {["approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status) && selectedReq.pgdm_certificate_downloaded_at && (
                          <Button onClick={handleNotifyPgdmReady} disabled={pgdmCertificateSaving || selectedReq.pgdm_certificate_status === "ready_notified"} className="gap-2">
                            {pgdmCertificateSaving ? <ButtonOrb state="working" onFilled /> : <Printer className="h-4 w-4" />}
                            {selectedReq.pgdm_certificate_status === "ready_notified" ? "Student Notified" : "Notify Student to Collect Diploma"}
                          </Button>
                        )}
                        {["pending_approval", "approved", "ready_notified"].includes(selectedReq.pgdm_certificate_status) && (
                          <Button variant="outline" onClick={handleRegeneratePgdmCertificate} disabled={pgdmCertificateSaving} className="gap-2">
                            {pgdmCertificateSaving ? <ButtonOrb state="working" /> : <RotateCcw className="h-4 w-4" />}
                            Regenerate
                          </Button>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="relative mx-auto overflow-hidden rounded border border-border bg-muted shadow-sm" style={{ aspectRatio: "1324 / 1872", maxWidth: 340 }}>
                        <img src={pgdmCertificateTemplateForCampus(selectedReq.campus)} alt="PGDM certificate preview" className="absolute inset-0 h-full w-full object-cover" />
                        <svg viewBox="0 0 1324 1872" className="absolute inset-0 h-full w-full" aria-hidden="true">
                          <text
                            x="792"
                            y="632"
                            textAnchor="middle"
                            dominantBaseline="alphabetic"
                            fontFamily={PGDM_CERTIFICATE_NAME_FONT_FAMILY}
                            fontSize={pgdmCertificateDetails.studentName.length > 24 ? 58 : 68}
                            fontStyle="italic"
                            fontWeight="400"
                            fill="#222"
                          >
                            {pgdmCertificateDetails.studentName || "Candidate Name"}
                          </text>
                          <g fill="#333" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontSize="24" fontWeight="700" letterSpacing="1">
                            <text x="930" y="1122">{pgdmCertificateDetails.completedYear}</text>
                            <text x="760" y="1154">{pgdmCertificateDetails.fileNo}</text>
                            <text x="785" y="1192">{pgdmCertificateDetails.enrollmentNo}</text>
                            <text x="987" y="1192">{pgdmCertificateDetails.cgpa}</text>
                            <text x="930" y="1225">{pgdmCertificateDetails.equivalentPercentage}</text>
                            <text x="700" y="1301">{pgdmCertificateDetails.issueDay}</text>
                            <text x="855" y="1301">{pgdmCertificateDetails.issueMonthYear}</text>
                          </g>
                        </svg>
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Preview only. Download is available after superadmin approval.
                      </p>
                    </div>
                  </div>

                  {pgdmAudit.length > 0 && (
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1.5 mb-2">
                        <Clock className="h-3 w-3" /> Certificate Audit Trail
                      </p>
                      <ul className="space-y-1.5">
                        {pgdmAudit.map((a: any) => (
                          <li key={a.id} className="flex items-start justify-between gap-3 text-xs">
                            <span className="text-foreground">
                              <span className="font-semibold capitalize">{String(a.action).replace(/_/g, " ")}</span>
                              {" by "}
                              <span className="font-medium">{a.actor_name || "Unknown"}</span>
                              {a.details?.notes ? <span className="text-muted-foreground"> — {a.details.notes}</span> : null}
                            </span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {new Date(a.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Employee review status */}
              {selectedReq.employee_reviewed_at && (
                <div className="rounded-xl border border-success/20 bg-success/5 dark:bg-success/90/20 p-3 space-y-1">
                  <p className="text-[10px] font-semibold text-success uppercase">Employee Review</p>
                  <p className="text-sm"><span className="font-medium capitalize">{(selectedReq.employee_review_result || "").replace("_", " ")}</span></p>
                  {selectedReq.employee_review_notes && <p className="text-xs text-muted-foreground">{selectedReq.employee_review_notes}</p>}
                  <p className="text-[10px] text-muted-foreground">Reviewed: {new Date(selectedReq.employee_reviewed_at).toLocaleDateString("en-IN")}</p>
                </div>
              )}

              {/* Completed verification result */}
              {selectedReq.status === "verified" && selectedReq.verification_result && (
                <div className={`rounded-xl border p-3 space-y-2 ${
                  selectedReq.verification_result === "confirmed" ? "border-success/20 bg-success/5 dark:bg-success/90/20" :
                  selectedReq.verification_result === "discrepancy_marks" ? "border-warning/20 bg-warning/5 dark:bg-warning/90/20" :
                  "border-destructive/20 bg-destructive/5 dark:bg-destructive/90/20"
                }`}>
                  <p className="text-[10px] font-semibold uppercase text-foreground">Verification Result</p>
                  <div className="flex items-center gap-2">
                    <Badge className={`border-0 text-xs font-bold ${(RESULT_LABELS[selectedReq.verification_result] || {}).color || "bg-muted"}`}>
                      {(RESULT_LABELS[selectedReq.verification_result] || {}).label || selectedReq.verification_result}
                    </Badge>
                  </div>
                  {selectedReq.admin_approval_notes && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium">Approval Notes:</p>
                      <p className="text-xs text-foreground">{selectedReq.admin_approval_notes}</p>
                    </div>
                  )}
                  {selectedReq.reviewed_at && (
                    <p className="text-[10px] text-muted-foreground">
                      Approved: {new Date(selectedReq.reviewed_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </p>
                  )}
                  {selectedReq.contact_email && (
                    <p className="text-[10px] text-muted-foreground">
                      Email sent to: <span className="font-medium">{selectedReq.contact_email}</span> (CC: academics@nimt.ac.in)
                    </p>
                  )}
                </div>
              )}

              {/* Employee draft email */}
              {selectedReq.employee_draft_email && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase bg-muted/30 flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Employee Draft Email
                  </div>
                  <pre className="px-3 py-2 text-[10px] text-foreground bg-muted/10 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto border-t border-border">
                    {selectedReq.employee_draft_email}
                  </pre>
                </div>
              )}

              {/* Final sent email */}
              {selectedReq.sent_email_body ? (
                <div className="rounded-xl border border-success/20 dark:border-success/60/40 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-semibold text-success uppercase bg-success/5/50 dark:bg-success/90/20 flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Final Email Sent
                  </div>
                  <div className="px-3 py-2 bg-success/5/30 dark:bg-success/90/10 border-t border-success/20 dark:border-success/60/40">
                    <p className="text-[10px] text-muted-foreground mb-1">Subject: <span className="font-medium text-foreground">{selectedReq.sent_email_subject}</span></p>
                    <pre className="text-[10px] text-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                      {selectedReq.sent_email_body}
                    </pre>
                  </div>
                </div>
              ) : selectedReq.status === "verified" && selectedReq.review_notes && (
                <div className="rounded-xl border border-success/20 dark:border-success/60/40 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-semibold text-success uppercase bg-success/5/50 dark:bg-success/90/20 flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Review Notes / Email Record
                  </div>
                  <pre className="px-3 py-2 text-[10px] text-foreground bg-success/5/30 dark:bg-success/90/10 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto border-t border-success/20">
                    {selectedReq.review_notes}
                  </pre>
                </div>
              )}

              {/* Review Section — Employee (if not yet reviewed).
                  Hidden for PGDM diploma requests: those follow the dedicated
                  certificate flow above, not the generic issuance review. */}
              {["paid"].includes(selectedReq.status) && !isSuperAdmin && !canWorkOnPgdmCertificate(selectedReq) && (
                <div className="space-y-3 pt-2 border-t border-border">
                  {isIssuanceRequest(selectedReq) ? (
                    <>
                      <p className="text-xs font-semibold text-foreground">Verify Details</p>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Decision *</label>
                        <select value={issuanceDecision} onChange={e => setIssuanceDecision(e.target.value)} className={inputCls}>
                          {ISSUANCE_DECISION_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.value === "verified" ? `${option.label} ${issuanceDocumentName(selectedReq)}` : option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Supporting Document</label>
                        <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40">
                          <Upload className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">{reviewDocFile ? reviewDocFile.name : "Upload optional supporting evidence"}</span>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setReviewDocFile(e.target.files?.[0] || null)} />
                        </label>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Internal Note</label>
                        <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} placeholder="Add internal record note..." className={inputCls + " resize-none"} />
                      </div>
                      <Button className="w-full gap-2" onClick={handleDetailsVerifiedForGeneration} disabled={saving}>
                        {saving ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
                        {issuanceActionLabel(selectedReq)}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-foreground">Submit Review</p>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Verification Result *</label>
                        <select value={verificationResult} onChange={e => setVerificationResult(e.target.value)} className={inputCls}>
                          <option value="">Select result</option>
                          <option value="recommended_approve">Recommend Approval</option>
                          <option value="recommended_reject">Recommend Rejection</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Supporting Document *</label>
                        <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40">
                          <Upload className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">{reviewDocFile ? reviewDocFile.name : "Upload verification evidence"}</span>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setReviewDocFile(e.target.files?.[0] || null)} />
                        </label>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Review Notes</label>
                        <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} placeholder="Notes..." className={inputCls + " resize-none"} />
                      </div>
                      <Button className="w-full gap-2" onClick={handleEmployeeReview} disabled={saving}>
                        {saving ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
                        Submit Review for Approval
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Super Admin Approval (after employee review, or direct for super admin).
                  Hidden for PGDM diploma requests — the certificate panel above owns
                  their generate → approve → print lifecycle. */}
              {isSuperAdmin && ["paid", "under_review"].includes(selectedReq.status) && !canWorkOnPgdmCertificate(selectedReq) && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-foreground">
                    {isIssuanceRequest(selectedReq)
                      ? "Verify Details"
                      : selectedReq.employee_reviewed_at ? "Super Admin Approval" : "Direct Review & Approve"}
                  </p>
                  {isIssuanceRequest(selectedReq) ? (
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Decision *</label>
                      <select value={issuanceDecision} onChange={e => setIssuanceDecision(e.target.value)} className={inputCls}>
                        {ISSUANCE_DECISION_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.value === "verified" ? `${option.label} ${issuanceDocumentName(selectedReq)}` : option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Verification Result *</label>
                      <select value={verificationResult} onChange={e => setVerificationResult(e.target.value)} className={inputCls}>
                        <option value="">Select result</option>
                        {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )}
                  {!selectedReq.employee_review_doc_url && (
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">
                        Supporting Document{isIssuanceRequest(selectedReq) ? "" : " *"}
                      </label>
                      <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40">
                        <Upload className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {reviewDocFile ? reviewDocFile.name : isIssuanceRequest(selectedReq) ? "Upload optional supporting evidence" : "Upload verification evidence"}
                        </span>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setReviewDocFile(e.target.files?.[0] || null)} />
                      </label>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">
                      {isIssuanceRequest(selectedReq) ? "Internal Note" : "Approval Notes *"}
                    </label>
                    <textarea
                      value={reviewNotes}
                      onChange={e => setReviewNotes(e.target.value)}
                      rows={2}
                      placeholder={isIssuanceRequest(selectedReq) ? "Add internal record note..." : "Add review notes..."}
                      className={inputCls + " resize-none"}
                    />
                  </div>
                  <Button
                    className="w-full gap-2 bg-primary hover:bg-primary/90"
                    onClick={isIssuanceRequest(selectedReq) ? handleDetailsVerifiedForGeneration : () => handlePrepareResult(verificationResult === "confirmed")}
                    disabled={saving}
                  >
                    {saving ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
                    {isIssuanceRequest(selectedReq) ? issuanceActionLabel(selectedReq) : "Preview & Edit Email"}
                  </Button>
                </div>
              )}

              {/* Delete — super admin only */}
              {isSuperAdmin && (
                <div className="pt-3 border-t border-border">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 w-full"
                    onClick={() => handleDelete()} disabled={deleting}>
                    {deleting ? <ButtonOrb state="working" /> : <XCircle className="h-3.5 w-3.5" />}
                    Delete Request
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Email Preview Dialog */}
      <Dialog open={showEmailPreview} onOpenChange={setShowEmailPreview}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> Preview & Edit Email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">To</label>
              <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2">{selectedReq?.contact_email} <span className="text-muted-foreground">(CC: academics@nimt.ac.in)</span></p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Subject</label>
              <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Email Body (editable)</label>
              <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={14}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono text-xs leading-relaxed" />
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-input bg-muted/20 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmailEnabled}
                onChange={e => setSendEmailEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <span className="text-xs text-foreground">
                Send result email{selectedReq?.contact_email ? ` to ${selectedReq.contact_email}` : ""}
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {sendEmailEnabled
                    ? "The edited email + a WhatsApp notification will be sent. Uncheck to just record the result without notifying."
                    : "No email or WhatsApp will be sent — the result is recorded only. You can notify the requestor separately."}
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailPreview(false)}>Cancel</Button>
            <Button onClick={handleConfirmAndSend} disabled={emailSending} className="gap-2 bg-success hover:bg-success/90">
              {emailSending ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
              {sendEmailEnabled ? "Approve & Send Email" : "Approve (don't send email)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Entry Dialog */}
      <Dialog open={showManualEntry} onOpenChange={setShowManualEntry}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Add Manual Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Request Type</label>
              <select value={manualData.request_type} onChange={e => setManualData(p => ({ ...p, request_type: e.target.value }))} className={inputCls}>
                <option value="verification">Student Verification</option>
                <option value="marksheet">Marksheet Request</option>
                <option value="diploma">Diploma Request</option>
                <option value="transcript">Transcript Request</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium mb-1 block">Student / Alumni Name *</label><input value={manualData.alumni_name} onChange={e => setManualData(p => ({ ...p, alumni_name: e.target.value }))} className={inputCls} /></div>
              <div>
                <label className="text-xs font-medium mb-1 block">Course *</label>
                <select value={manualData.course_id || manualData.course} onChange={e => {
                  const selected = courses.find((c: any) => c.id === e.target.value);
                  setManualData(p => ({ ...p, course_id: selected?.id || "", course: selected?.name || e.target.value }));
                }} className={inputCls}>
                  <option value="">Select course</option>
                  {courses.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div><label className="text-xs font-medium mb-1 block">Year *</label><input type="number" value={manualData.year_of_passing} onChange={e => setManualData(p => ({ ...p, year_of_passing: e.target.value }))} className={inputCls} /></div>
              <div><label className="text-xs font-medium mb-1 block">Enrollment No</label><input value={manualData.enrollment_no} onChange={e => setManualData(p => ({ ...p, enrollment_no: e.target.value }))} className={inputCls} /></div>
            </div>
            <div><label className="text-xs font-medium mb-1 block">Contact Name *</label><input value={manualData.contact_name} onChange={e => setManualData(p => ({ ...p, contact_name: e.target.value }))} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium mb-1 block">Email</label><input value={manualData.contact_email} onChange={e => setManualData(p => ({ ...p, contact_email: e.target.value }))} className={inputCls} /></div>
              <div><label className="text-xs font-medium mb-1 block">Phone</label><input value={manualData.contact_phone_spoc} onChange={e => setManualData(p => ({ ...p, contact_phone_spoc: e.target.value }))} className={inputCls} /></div>
            </div>
            <div><label className="text-xs font-medium mb-1 block">Employer</label><input value={manualData.employer_name} onChange={e => setManualData(p => ({ ...p, employer_name: e.target.value }))} className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium mb-1 block">Fee Amount</label><input type="number" value={manualData.fee_amount} onChange={e => setManualData(p => ({ ...p, fee_amount: e.target.value }))} className={inputCls} /></div>
              <div>
                <label className="text-xs font-medium mb-1 block">Status</label>
                <select value={manualData.status} onChange={e => setManualData(p => ({ ...p, status: e.target.value }))} className={inputCls}>
                  <option value="paid">Paid</option>
                  <option value="pending_payment">Pending Payment</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Payment Proof (if paid)</label>
              <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{manualPaymentProof ? manualPaymentProof.name : "Upload proof"}</span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setManualPaymentProof(e.target.files?.[0] || null)} />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualEntry(false)}>Cancel</Button>
            <Button onClick={handleManualEntry} disabled={manualSaving} className="gap-2">
              {manualSaving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />}
              Create Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offline Payment Dialog — mirrors the finance OfflinePaymentDialog look */}
      <Dialog open={showOfflinePay} onOpenChange={setShowOfflinePay}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-primary" />
              Record Offline Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <FieldShell label="Amount (₹)">
                <Input value={selectedReq?.fee_amount ?? ""} readOnly title="Amount is fixed by the request fee" />
              </FieldShell>
              <SelectField
                value={offlinePayMode}
                onValueChange={value => { setOfflinePayMode(value); setOfflinePayRef(""); }}
                options={OFFLINE_PAYMENT_MODES.map(m => ({ value: m.value, label: m.label }))}
                label="Payment Mode"
                allowEmpty={false}
              />
            </div>
            {offlinePayMode !== "cash" && (
              <TextField
                value={offlinePayRef}
                onValueChange={setOfflinePayRef}
                label={
                  offlinePayMode === "cheque" ? "Cheque / DD Number"
                  : offlinePayMode === "upi" ? "UPI / Txn Reference"
                  : offlinePayMode === "bank_transfer" ? "UTR / Reference Number"
                  : "Reference / Receipt Number"
                }
                placeholder={offlinePayMode === "online" ? "External ref no (e.g. Easebuzz easepayid)" : "Reference / txn no"}
              />
            )}
            <p className="text-[11px] text-muted-foreground">
              Marking this confirmed records the payment and moves the request to <span className="font-medium text-foreground">Pending Review</span>. Use it for cash/UPI/bank payments or to reconcile an online payment that didn't confirm.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOfflinePay(false)} disabled={markingPaid}>Cancel</Button>
            <Button onClick={submitOfflinePayment} disabled={markingPaid} className="gap-2">
              {markingPaid ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
              Mark as Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

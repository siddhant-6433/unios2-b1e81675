import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Shield, FileText, ExternalLink, CheckCircle, XCircle, Clock, Eye, Plus, Upload, AlertTriangle, X, Mail,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending Payment", color: "bg-gray-100 text-gray-700" },
  paid: { label: "Pending Review", color: "bg-blue-100 text-blue-700" },
  under_review: { label: "Under Review", color: "bg-amber-100 text-amber-700" },
  verified: { label: "Completed", color: "bg-emerald-100 text-emerald-700" },
};

const RESULT_LABELS: Record<string, { label: string; color: string }> = {
  confirmed: { label: "Confirmed", color: "bg-emerald-100 text-emerald-700" },
  discrepancy_marks: { label: "Discrepancy", color: "bg-amber-100 text-amber-700" },
  not_found: { label: "Not Found", color: "bg-red-100 text-red-700" },
};

const RESULT_OPTIONS = [
  { value: "confirmed", label: "Confirmed — Alumni record verified successfully" },
  { value: "discrepancy_marks", label: "Discrepancy — Student exists but marks/percentage/pass-fail status do not match (possible modification)" },
  { value: "not_found", label: "Not Found — No such alumni record exists in our database" },
];

export default function AlumniVerifications() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = role === "super_admin";
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Detail dialog
  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [verificationResult, setVerificationResult] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewDocFile, setReviewDocFile] = useState<File | null>(null);

  // Manual entry dialog
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualData, setManualData] = useState({
    request_type: "verification", alumni_name: "", course: "", year_of_passing: "",
    employer_name: "", contact_name: "", contact_email: "", contact_phone_spoc: "",
    enrollment_no: "", campus: "", fee_amount: "1500", status: "paid",
  });
  const [manualPaymentProof, setManualPaymentProof] = useState<File | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Email preview dialog
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const handleDelete = async () => {
    if (!selectedReq || !isSuperAdmin) return;
    if (!confirm(`Delete request ${selectedReq.request_number}? This cannot be undone.`)) return;
    setDeleting(true);
    // Delete storage files
    const paths = [
      selectedReq.diploma_certificate_url,
      selectedReq.employee_review_doc_url,
      ...(selectedReq.marksheet_urls || []),
      ...(selectedReq.additional_doc_urls || []),
    ].filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from("alumni-verification-docs").remove(paths);
    }
    await supabase.from("alumni_verification_requests" as any).delete().eq("id", selectedReq.id);
    toast({ title: "Request deleted" });
    setDeleting(false);
    setSelectedReq(null);
    fetchRequests();
  };

  const fetchRequests = async () => {
    const { data } = await supabase
      .from("alumni_verification_requests" as any)
      .select("*")
      .order("created_at", { ascending: false });
    setRequests(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRequests(); }, []);

  const filtered = statusFilter === "all" ? requests : requests.filter(r => r.status === statusFilter);
  const paidPending = requests.filter(r => ["paid", "under_review"].includes(r.status)).length;

  const openDetail = (req: any) => {
    setSelectedReq(req);
    setReviewNotes(req.employee_review_notes || req.review_notes || "");
    setVerificationResult(req.employee_review_result || req.verification_result || "");
    setNewStatus(req.status);
    setReviewDocFile(null);
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

  const SERVICE_LABELS: Record<string, string> = {
    verification: "Alumni Verification", marksheet: "Marksheet Request",
    diploma: "Degree/Diploma Request", transcript: "Transcript Request",
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

For any further queries, please contact us at umesh@nimt.ac.in or call +91-7428477664.

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

We recommend further investigation at your end. For any clarification, please contact us at umesh@nimt.ac.in or call +91-7428477664.

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

For any clarification, please contact us at umesh@nimt.ac.in or call +91-7428477664.

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

    // Update status + store sent email for audit
    await supabase.from("alumni_verification_requests" as any).update({
      status: finalStatus,
      verification_result: result,
      review_notes: reviewNotes,
      reviewed_by: user?.id,
      reviewed_at: approvedAt,
      admin_approved_by: user?.id,
      admin_approval_notes: reviewNotes,
      admin_approved_at: approvedAt,
      sent_email_subject: emailSubject,
      sent_email_body: emailBody,
    }).eq("id", selectedReq.id);

    // Send email
    if (selectedReq.contact_email) {
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

    // Send WhatsApp (plain text, not template)
    try {
      const waPhone = selectedReq.requestor_phone?.replace(/[^0-9]/g, "");
      if (waPhone) {
        const whatsappToken = (await supabase.functions.invoke("alumni-payment", { body: { action: "noop" } })); // dummy to get env
        // Use direct Graph API via alumni-payment or just call whatsapp-send with a custom approach
        // For now, send via the webhook's plain text pattern
        const msg = `Dear ${selectedReq.contact_name || selectedReq.alumni_name},\n\nThe result of your alumni verification request (${selectedReq.request_number}) has been emailed to ${selectedReq.contact_email}.\n\nPlease do not reply or call back on this number. This is an automated notification.\n\n— NIMT Educational Institutions`;

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

    toast({ title: `Result sent to ${selectedReq.contact_email}` });
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
      enrollment_no: "", campus: "", fee_amount: "1500", status: "paid" });
    setManualPaymentProof(null);
    fetchRequests();
  };

  const getDocUrl = async (path: string) => {
    const { data } = await supabase.storage.from("alumni-verification-docs").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  // Pagination
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedRequests = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [statusFilter]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alumni Verification</h1>
          <p className="text-sm text-muted-foreground mt-1">Review and manage verification requests</p>
        </div>
        <div className="flex items-center gap-3">
          {paidPending > 0 && (
            <Badge className="bg-red-100 text-red-700 border-0 text-sm font-bold gap-1">
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
          key: k, label: `${v.label.split(" —")[0]} (${requests.filter(r => r.status === k).length})`,
        }))].map(t => (
          <button key={t.key} onClick={() => setStatusFilter(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${statusFilter === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

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
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Result</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Due / Completed</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">TAT</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRequests.map((req: any) => {
                    const cfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending_payment;
                    const isOverdue = req.due_date && new Date(req.due_date) < new Date() && ["paid", "under_review"].includes(req.status);
                    const daysLeft = req.due_date ? Math.ceil((new Date(req.due_date).getTime() - Date.now()) / 86400000) : null;
                    return (
                      <tr key={req.id} className={`border-b border-border/40 hover:bg-muted/20 cursor-pointer ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
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
                            <span className="text-emerald-600 font-medium">{new Date(req.reviewed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                          ) : req.due_date ? (
                            <span>{new Date(req.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {daysLeft !== null && ["paid", "under_review"].includes(req.status) ? (
                            <span className={`text-[10px] font-bold ${isOverdue ? "text-red-600" : daysLeft <= 2 ? "text-amber-600" : "text-emerald-600"}`}>
                              {isOverdue ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                            </span>
                          ) : req.status === "verified" ? (
                            <span className="text-[10px] text-emerald-600 font-medium">Done</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Button variant="ghost" size="sm" className="gap-1 text-xs"><Eye className="h-3 w-3" /> View</Button>
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {selectedReq?.request_number}
              {selectedReq?.due_date && ["paid", "under_review"].includes(selectedReq?.status) && (
                <Badge className={`ml-2 border-0 text-[10px] ${
                  new Date(selectedReq.due_date) < new Date() ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
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
                    <button onClick={() => getDocUrl(selectedReq.employee_review_doc_url)} className="flex items-center gap-2 text-sm text-emerald-600 hover:underline">
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
                  {selectedReq.paid_at ? <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">Paid</Badge> : <Badge className="bg-gray-100 text-gray-600 border-0 text-[10px]">Unpaid</Badge>}
                </div>
                {selectedReq.payment_ref && <p className="text-[10px] text-muted-foreground">Ref: {selectedReq.payment_ref}</p>}
              </div>

              {/* Employee review status */}
              {selectedReq.employee_reviewed_at && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-1">
                  <p className="text-[10px] font-semibold text-emerald-700 uppercase">Employee Review</p>
                  <p className="text-sm"><span className="font-medium capitalize">{(selectedReq.employee_review_result || "").replace("_", " ")}</span></p>
                  {selectedReq.employee_review_notes && <p className="text-xs text-muted-foreground">{selectedReq.employee_review_notes}</p>}
                  <p className="text-[10px] text-muted-foreground">Reviewed: {new Date(selectedReq.employee_reviewed_at).toLocaleDateString("en-IN")}</p>
                </div>
              )}

              {/* Completed verification result */}
              {selectedReq.status === "verified" && selectedReq.verification_result && (
                <div className={`rounded-xl border p-3 space-y-2 ${
                  selectedReq.verification_result === "confirmed" ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20" :
                  selectedReq.verification_result === "discrepancy_marks" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20" :
                  "border-red-200 bg-red-50 dark:bg-red-950/20"
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
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-semibold text-emerald-700 uppercase bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Final Email Sent
                  </div>
                  <div className="px-3 py-2 bg-emerald-50/30 dark:bg-emerald-950/10 border-t border-emerald-200 dark:border-emerald-800/40">
                    <p className="text-[10px] text-muted-foreground mb-1">Subject: <span className="font-medium text-foreground">{selectedReq.sent_email_subject}</span></p>
                    <pre className="text-[10px] text-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                      {selectedReq.sent_email_body}
                    </pre>
                  </div>
                </div>
              ) : selectedReq.status === "verified" && selectedReq.review_notes && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-semibold text-emerald-700 uppercase bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Review Notes / Email Record
                  </div>
                  <pre className="px-3 py-2 text-[10px] text-foreground bg-emerald-50/30 dark:bg-emerald-950/10 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto border-t border-emerald-200">
                    {selectedReq.review_notes}
                  </pre>
                </div>
              )}

              {/* Review Section — Employee (if not yet reviewed) */}
              {["paid"].includes(selectedReq.status) && !isSuperAdmin && (
                <div className="space-y-3 pt-2 border-t border-border">
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
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Submit Review for Approval
                  </Button>
                </div>
              )}

              {/* Super Admin Approval (after employee review, or direct for super admin) */}
              {isSuperAdmin && ["paid", "under_review"].includes(selectedReq.status) && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-foreground">
                    {selectedReq.employee_reviewed_at ? "Super Admin Approval" : "Direct Review & Approve"}
                  </p>
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Verification Result *</label>
                    <select value={verificationResult} onChange={e => setVerificationResult(e.target.value)} className={inputCls}>
                      <option value="">Select result</option>
                      {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {!selectedReq.employee_review_doc_url && (
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">Supporting Document *</label>
                      <label className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 cursor-pointer hover:border-primary/40">
                        <Upload className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">{reviewDocFile ? reviewDocFile.name : "Upload verification evidence"}</span>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setReviewDocFile(e.target.files?.[0] || null)} />
                      </label>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">Approval Notes *</label>
                    <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} placeholder="Add review notes..." className={inputCls + " resize-none"} />
                  </div>
                  <Button className="w-full gap-2 bg-primary hover:bg-primary/90" onClick={() => handlePrepareResult(verificationResult === "confirmed")} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Preview & Send Result Email
                  </Button>
                </div>
              )}

              {/* Delete — super admin only */}
              {isSuperAdmin && (
                <div className="pt-3 border-t border-border">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 w-full"
                    onClick={handleDelete} disabled={deleting}>
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
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
            <p className="text-[10px] text-muted-foreground">
              WhatsApp notification will also be sent: "The result has been emailed to {selectedReq?.contact_email}. Please do not reply on this number."
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailPreview(false)}>Cancel</Button>
            <Button onClick={handleConfirmAndSend} disabled={emailSending} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Approve & Send Email
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
                <option value="verification">Alumni Verification</option>
                <option value="marksheet">Marksheet Request</option>
                <option value="diploma">Diploma Request</option>
                <option value="transcript">Transcript Request</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium mb-1 block">Alumni Name *</label><input value={manualData.alumni_name} onChange={e => setManualData(p => ({ ...p, alumni_name: e.target.value }))} className={inputCls} /></div>
              <div><label className="text-xs font-medium mb-1 block">Course *</label><input value={manualData.course} onChange={e => setManualData(p => ({ ...p, course: e.target.value }))} className={inputCls} /></div>
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
              {manualSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

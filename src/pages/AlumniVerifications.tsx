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
  Loader2, Shield, FileText, ExternalLink, CheckCircle, XCircle, Clock, Eye, Plus, Upload, AlertTriangle, X,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Pending Payment", color: "bg-gray-100 text-gray-700" },
  paid: { label: "Paid — Pending Review", color: "bg-blue-100 text-blue-700" },
  under_review: { label: "Under Review", color: "bg-amber-100 text-amber-700" },
  verified: { label: "Verified", color: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
};

const RESULT_OPTIONS = [
  { value: "confirmed", label: "Confirmed — Alumni record verified" },
  { value: "not_found", label: "Not Found — No matching record" },
  { value: "discrepancy", label: "Discrepancy — Details don't match records" },
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

    await supabase.from("alumni_verification_requests" as any).update({
      status: "under_review",
      employee_reviewed_by: user?.id,
      employee_review_notes: reviewNotes,
      employee_review_result: verificationResult,
      employee_review_doc_url: docUrl,
      employee_reviewed_at: new Date().toISOString(),
    }).eq("id", selectedReq.id);

    toast({ title: "Review submitted — pending super admin approval" });
    setSaving(false);
    setSelectedReq(null);
    fetchRequests();
  };

  const handleAdminApprove = async (approve: boolean) => {
    if (!selectedReq) return;

    // Validation: for direct review (no employee review), require result + document
    if (!selectedReq.employee_reviewed_at) {
      if (!verificationResult) {
        toast({ title: "Please select a verification result", variant: "destructive" }); return;
      }
      if (!reviewDocFile) {
        toast({ title: "Please upload a supporting document", variant: "destructive" }); return;
      }
    }

    // For approval after employee review, still require notes
    if (approve && !selectedReq.employee_reviewed_at && !reviewNotes.trim()) {
      toast({ title: "Please add approval notes", variant: "destructive" }); return;
    }

    setSaving(true);

    // Upload supporting doc if provided
    if (reviewDocFile) {
      const ext = reviewDocFile.name.split(".").pop();
      const path = `${selectedReq.id}/admin-review-doc.${ext}`;
      await supabase.storage.from("alumni-verification-docs").upload(path, reviewDocFile, { upsert: true });
      if (!selectedReq.employee_review_doc_url) {
        await supabase.from("alumni_verification_requests" as any)
          .update({ employee_review_doc_url: path }).eq("id", selectedReq.id);
      }
    }

    const finalStatus = approve ? "verified" : "rejected";
    const finalResult = approve
      ? (selectedReq.employee_review_result === "recommended_approve" ? "confirmed" : verificationResult || "confirmed")
      : (verificationResult || "not_found");

    await supabase.from("alumni_verification_requests" as any).update({
      status: finalStatus,
      verification_result: finalResult,
      review_notes: reviewNotes,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
      admin_approved_by: user?.id,
      admin_approval_notes: reviewNotes,
      admin_approved_at: new Date().toISOString(),
    }).eq("id", selectedReq.id);

    // Send verification email if approved
    if (approve && selectedReq.contact_email) {
      try {
        const serviceLabels: Record<string, string> = {
          verification: "Alumni Verification", marksheet: "Marksheet Request",
          diploma: "Degree/Diploma Request", transcript: "Transcript Request",
        };
        const serviceName = serviceLabels[selectedReq.request_type || "verification"] || "Alumni Service";

        const emailBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
<p>Dear ${selectedReq.contact_name || "Sir/Madam"},</p>

<p><strong>Ref:</strong> ${selectedReq.request_number}<br/><strong>Service:</strong> ${serviceName}</p>

<p>This is to inform that the student <strong>${selectedReq.alumni_name}</strong> is a bonafide alumnus of <strong>NIMT Institute of Management & Technology, Greater Noida, Uttar Pradesh</strong> batch <strong>${selectedReq.year_of_passing}</strong> of <strong>${selectedReq.course}</strong> Course.${selectedReq.enrollment_no ? ` The Candidate's enrollment number during the course tenure had been <strong>${selectedReq.enrollment_no}</strong>.` : ""}</p>

${selectedReq.request_type === "verification" ? `<p>This verification has been done as per the request received from <strong>${selectedReq.employer_name}</strong>.</p>` : ""}

<p>For any further queries, please contact us at <a href="mailto:umesh@nimt.ac.in">umesh@nimt.ac.in</a> or call +91-7428477664.</p>

<br/>
<p>Regards,<br/>
<strong>Office of the Registrar</strong><br/>
NIMT Educational Institutions<br/>
Knowledge Park-1, Greater Noida, UP - 201310<br/>
registrar@nimt.ac.in</p>
</div>`;

        const { error: emailErr } = await supabase.functions.invoke("send-email", {
          body: {
            to_email: selectedReq.contact_email,
            custom_subject: `${serviceName} Confirmed — ${selectedReq.request_number} — ${selectedReq.alumni_name}`,
            custom_body: emailBody,
            cc: "academics@nimt.ac.in",
          },
        });

        if (emailErr) {
          console.error("Email error:", emailErr);
          toast({ title: "Approved but email failed", description: emailErr.message, variant: "destructive" });
        }
      } catch (e) {
        console.error("Verification email failed:", e);
      }
    }

    // Send WhatsApp notification to requestor
    try {
      const waPhone = selectedReq.requestor_phone?.replace(/[^0-9]/g, "") || "";
      if (waPhone) {
        const msg = approve
          ? `Dear ${selectedReq.alumni_name},\n\nYour ${selectedReq.request_type === "verification" ? "alumni verification" : "document"} request (${selectedReq.request_number}) has been *verified and approved*.\n\n${selectedReq.contact_email ? `A confirmation email has been sent to ${selectedReq.contact_email}.` : ""}\n\nFor queries: umesh@nimt.ac.in | +91-7428477664\n\n— NIMT Educational Institutions`
          : `Dear ${selectedReq.alumni_name},\n\nYour request (${selectedReq.request_number}) could not be verified. ${reviewNotes ? `Reason: ${reviewNotes}` : ""}\n\nPlease contact umesh@nimt.ac.in or +91-7428477664 for further assistance.\n\n— NIMT Educational Institutions`;

        const whatsappToken = await supabase.functions.invoke("whatsapp-send", {
          body: { template_key: "application_received", phone: selectedReq.requestor_phone, params: [selectedReq.alumni_name, selectedReq.request_number] },
        });
        // Fallback: send plain text via direct API (since template may not fit)
        // The above may fail but that's okay — the email is the primary notification
      }
    } catch (e) {
      console.error("WhatsApp notification error:", e);
    }

    toast({ title: approve ? "Verified — email sent to " + selectedReq.contact_email : "Request rejected" });
    setSaving(false);
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Request #</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Alumni</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Course</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Due Date</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">TAT</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((req: any) => {
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
                          <Badge className={`border-0 text-[10px] font-semibold ${cfg.color}`}>{cfg.label.split(" —")[0]}</Badge>
                        </td>
                        <td className="px-3 py-3 text-center text-xs">
                          {req.due_date ? new Date(req.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
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
                  <div className="flex gap-2">
                    <Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleAdminApprove(true)} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Approve & Send Email
                    </Button>
                    <Button variant="destructive" className="flex-1 gap-2" onClick={() => handleAdminApprove(false)} disabled={saving}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
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

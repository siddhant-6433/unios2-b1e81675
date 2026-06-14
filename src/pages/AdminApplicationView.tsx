import { Component, ReactNode, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, Gift, User, Trash2 } from "lucide-react";
import { ApplicationPreview, type PreviewDoc } from "@/components/applicant/ApplicationPreview";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { AdmissionLifecycleStepper } from "@/components/admissions/AdmissionLifecycleStepper";
import { DocReviewPanel } from "@/components/admissions/DocReviewPanel";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { deleteApplication as deleteApplicationRequest } from "@/lib/deleteApplication";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type DocStatus = "pending" | "verified" | "rejected";

interface DocReview {
  file_path: string;
  status: DocStatus;
  notes: string | null;
  reviewed_at: string | null;
}

export default function AdminApplicationView() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { role } = useAuth();
  const isTeamLeader = useIsTeamLeader();
  const canApproveApplication = role === "super_admin" || role === "principal" || isTeamLeader;
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<any | null>(null);
  const [lead, setLead] = useState<{
    id: string; name: string; course_id: string | null; campus_id: string | null;
    pre_admission_no: string | null; admission_no: string | null;
    course?: { name: string; code: string | null; duration_years: number | null; eligibility: string | null; entrance_exam: string | null; entrance_mandatory: boolean | null } | null;
  } | null>(null);
  const [eligibilityRule, setEligibilityRule] = useState<{
    notes: string | null;
    entrance_exam_name: string | null;
    entrance_exam_required: boolean | null;
  } | null>(null);
  const [hasOffer, setHasOffer] = useState(false);
  const [appFeePaid, setAppFeePaid] = useState(0);
  const [docs, setDocs] = useState<PreviewDoc[]>([]);
  const [reviews, setReviews] = useState<Record<string, DocReview>>({});
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOfferLetter, setShowOfferLetter] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);

  // Async load can throw on any of N round-trips — wrap so a transient failure
  // shows a recoverable error instead of leaving the page in a permanent
  // "loading" state (which renders as a spinner-then-blank).
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = async () => {
    if (!applicationId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data: appRow, error: appErr }, fnRes, { data: reviewRows }] = await Promise.all([
        supabase.from("applications").select("*").eq("application_id", applicationId).maybeSingle(),
        supabase.functions.invoke("list-app-docs", { body: { application_id: applicationId } }).catch((e: any) => ({ data: null, error: e })),
        supabase.from("application_doc_reviews" as any)
          .select("file_path, status, notes, reviewed_at")
          .eq("application_id", applicationId),
      ]);
      if (appErr) throw appErr;
      setApp(appRow);
      setDocs(((fnRes?.data as any)?.docs || []) as PreviewDoc[]);
      const map: Record<string, DocReview> = {};
      (reviewRows as DocReview[] | null || []).forEach(r => { map[r.file_path] = r; });
      setReviews(map);

      // Pull lead's course/campus IDs — needed by OfferLetterDialog. course_selections
      // on the application only has names, so we read them from the linked lead.
      // Also pulls PAN/AN for the lifecycle stepper.
      if (appRow?.lead_id) {
        const [{ data: leadRow }, { data: offerRows }, { data: pmtRows }] = await Promise.all([
          supabase.from("leads")
            .select("id, name, course_id, campus_id, pre_admission_no, admission_no, course:course_id(name,code,duration_years,eligibility,entrance_exam,entrance_mandatory)")
            .eq("id", appRow.lead_id).maybeSingle(),
          supabase.from("offer_letters").select("id").eq("lead_id", appRow.lead_id).limit(1),
          supabase.from("lead_payments")
            .select("amount,type,status")
            .eq("lead_id", appRow.lead_id)
            .eq("type", "application_fee")
            .eq("status", "confirmed"),
        ]);
        let ruleRow = null;
        if (leadRow?.course_id) {
          const { data } = await supabase
            .from("eligibility_rules")
            .select("notes, entrance_exam_name, entrance_exam_required")
            .eq("course_id", leadRow.course_id)
            .maybeSingle();
          ruleRow = data;
        }
        setLead(leadRow as any);
        setEligibilityRule(ruleRow);
        setHasOffer(!!(offerRows && offerRows.length));
        setAppFeePaid((pmtRows || []).reduce((sum, p: any) => sum + Number(p.amount || 0), 0));
      } else {
        setLead(null);
        setEligibilityRule(null);
        setHasOffer(false);
        setAppFeePaid(0);
      }
    } catch (e: any) {
      console.error("[AdminApplicationView] refresh failed:", e);
      setLoadError(e?.message || "Failed to load application");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [applicationId]);

  // Doc-by-doc review actions. Upserts into application_doc_reviews keyed by
  // (application_id, file_path) so each click is idempotent.
  const setDocStatus = async (doc: PreviewDoc, next: DocStatus, notes?: string) => {
    if (!applicationId) return;
    if (!canApproveApplication) {
      toast({
        title: "Approval restricted",
        description: "Only team leaders, principals, and super admins can approve or reject documents.",
        variant: "destructive",
      });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle()
      : { data: null };

    const payload = {
      application_id: applicationId,
      file_path: doc.path,
      status: next,
      notes: notes ?? reviews[doc.path]?.notes ?? null,
      reviewed_by: profile?.id ?? null,
      reviewed_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("application_doc_reviews" as any)
      .upsert(payload, { onConflict: "application_id,file_path" });
    if (error) {
      toast({ title: "Couldn't save review", description: error.message, variant: "destructive" });
      return;
    }
    setReviews(prev => ({ ...prev, [doc.path]: { ...payload } as DocReview }));
  };

  // Application-level approve/reject. AN issuance does NOT hard-gate on this
  // (only on rejected docs) — these flags exist as a workflow signal.
  const decideApplication = async (decision: "approved" | "rejected") => {
    if (!applicationId || !app) return;
    if (!canApproveApplication) {
      toast({
        title: "Approval restricted",
        description: "Only team leaders, principals, and super admins can approve or reject applications.",
        variant: "destructive",
      });
      return;
    }
    if (decision === "rejected" && !rejectionReason.trim()) {
      setShowRejectionInput(true);
      return;
    }
    setDecisionBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle()
      : { data: null };

    const updates: Record<string, any> = {
      status: decision,
      approved_at: decision === "approved" ? new Date().toISOString() : null,
      approved_by: decision === "approved" ? profile?.id ?? null : null,
      rejection_reason: decision === "rejected" ? rejectionReason.trim() : null,
    };
    const { error } = await supabase.from("applications").update(updates).eq("id", app.id);
    if (error) {
      toast({ title: "Couldn't save decision", description: error.message, variant: "destructive" });
      setDecisionBusy(false);
      return;
    }

    // Advance lead stage on approval (if this app has a lead). Reject leaves
    // stage alone — operator can move the lead manually if needed.
    if (decision === "approved" && app.lead_id) {
      await supabase.from("leads")
        .update({ stage: "application_approved" } as any)
        .eq("id", app.lead_id);
      await supabase.from("lead_activities").insert({
        lead_id: app.lead_id,
        type: "stage_change",
        description: `Application ${app.application_id} approved`,
        new_stage: "application_approved",
      });
      // Notify student + counsellor via WA + email
      supabase.functions.invoke("notify-event", {
        body: {
          event: "app_approved",
          lead_id: app.lead_id,
          context: { application_id: app.application_id },
        },
      }).catch((e: any) => console.warn("[AdminApplicationView] notify app_approved failed:", e));
    } else if (decision === "rejected" && app.lead_id) {
      await supabase.from("lead_activities").insert({
        lead_id: app.lead_id,
        type: "system",
        description: `Application ${app.application_id} rejected: ${rejectionReason.trim()}`,
      });
    }

    setDecisionBusy(false);
    setShowRejectionInput(false);
    setRejectionReason("");
    toast({ title: decision === "approved" ? "Application approved" : "Application rejected" });
    refresh();
  };

  // Counts to drive the review summary chip + button-disable logic.
  const counts = useMemo(() => {
    const total = docs.length;
    let verified = 0, rejected = 0, pending = 0;
    docs.forEach(d => {
      const s = reviews[d.path]?.status ?? "pending";
      if (s === "verified") verified++;
      else if (s === "rejected") rejected++;
      else pending++;
    });
    return { total, verified, rejected, pending };
  }, [docs, reviews]);

  const deleteApplication = async () => {
    if (!app || app.payment_status === "paid") return;
    setDeleting(true);
    const { data, error } = await deleteApplicationRequest({
      id: app.id,
      applicationId: app.application_id,
      paymentStatus: app.payment_status,
    });
    setDeleting(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Application deleted",
      description: data
        ? `${data.application_id} deleted with ${data.deleted_storage_files} storage files cleaned up.`
        : undefined,
    });
    navigate("/applications");
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">Couldn't load this application</p>
          <p className="text-xs text-rose-800 mt-1">{loadError}</p>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refresh()}>Retry</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/applications")}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Applications
          </Button>
        </div>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Application not found.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/applications")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />Back
        </Button>
      </div>
    );
  }

  const decided = app.status === "approved" || app.status === "rejected";

  const generateFeeReceipt = async () => {
    if (generatingReceipt || !app?.application_id) return;
    setGeneratingReceipt(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-application-fee-receipt", {
        body: { application_id: app.application_id },
      });
      if (error) throw error;
      const url = (data as any)?.fee_receipt_url;
      if (url) {
        setApp((prev: any) => prev ? { ...prev, fee_receipt_url: url } : prev);
        window.open(url, "_blank");
      }
    } catch (e: any) {
      toast({ title: "Couldn't generate receipt", description: e?.message, variant: "destructive" });
    } finally {
      setGeneratingReceipt(false);
    }
  };

  return (
    <div className="p-5 space-y-5 animate-fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => {
            // Prefer history when there's something to go back to;
            // fall back to /applications when this page was opened directly
            // (e.g. via target="_blank" from the Applications list).
            if (window.history.length > 1 && document.referrer && new URL(document.referrer).origin === window.location.origin) {
              navigate(-1);
            } else {
              navigate("/applications");
            }
          }}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">{app.full_name}</h1>
            <p className="text-xs font-mono text-primary">{app.application_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="text-[10px] border-0 bg-violet-100 text-violet-700">{app.status}</Badge>
          <Badge className="text-[10px] border-0 bg-emerald-100 text-emerald-700">{app.payment_status || "pending"}</Badge>
          {(lead?.id || app.lead_id) && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => navigate(`/admissions/${lead?.id || app.lead_id}`)}
            >
              <User className="h-3.5 w-3.5" />
              Open Lead
            </Button>
          )}
          {role === "super_admin" && app.payment_status !== "paid" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
          {app.form_pdf_url && (
            <a href={app.form_pdf_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
              <FileText className="h-3.5 w-3.5" />Form PDF
            </a>
          )}
        </div>
      </div>

      {/* Lifecycle stepper — visual journey from submission → admission.
          Wrapped in a section-level error boundary so a single broken stage
          render doesn't white-screen the whole admin page. */}
      <SectionErrorBoundary label="lifecycle stepper">
        <AdmissionLifecycleStepper
          app={app}
          lead={lead}
          hasLead={!!app.lead_id && !!lead}
          appFeePaid={appFeePaid}
          hasOffer={hasOffer}
          docs={counts}
          onApprove={app.status === "submitted" ? () => decideApplication("approved") : undefined}
          onIssueOffer={app.status === "approved" && !hasOffer && lead?.id ? () => setShowOfferLetter(true) : undefined}
          feeReceiptUrl={app.fee_receipt_url || null}
          onGenerateFeeReceipt={appFeePaid > 0 ? generateFeeReceipt : undefined}
        />
      </SectionErrorBoundary>

      {/* Review summary + application-level decision */}
      {(app.status === "submitted" || decided) && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-medium">Document review:</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" />{counts.verified} verified
              </span>
              {counts.rejected > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 px-2 py-0.5">
                  <XCircle className="h-3 w-3" />{counts.rejected} rejected
                </span>
              )}
              {counts.pending > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5">
                  <Clock className="h-3 w-3" />{counts.pending} pending
                </span>
              )}
              <span className="text-muted-foreground">of {counts.total}</span>
            </div>
            {!decided && canApproveApplication && (
              <div className="flex items-center gap-2">
                <Button
                  variant="pill-outline"
                  size="pill"
                  className="text-rose-700 border-rose-200 hover:bg-rose-50"
                  onClick={() => decideApplication("rejected")}
                  disabled={decisionBusy}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />Reject
                </Button>
                <Button
                  variant="pill"
                  size="pill"
                  onClick={() => decideApplication("approved")}
                  disabled={decisionBusy || counts.rejected > 0}
                  title={counts.rejected > 0 ? "Resolve rejected documents first" : ""}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                </Button>
              </div>
            )}
            {!decided && !canApproveApplication && (
              <p className="text-[11px] text-muted-foreground">
                You can view submitted documents. Team leaders, principals, and super admins approve or reject them.
              </p>
            )}
            {decided && app.status === "approved" && (() => {
              const canIssueOffer = !!lead?.id && (
                role === "super_admin" || role === "principal" || role === "counsellor" ||
                role === "admission_head" || role === "campus_admin"
              );
              const reason = !lead?.id
                ? "No lead linked to this application"
                : !canIssueOffer
                ? "You do not have permission to issue offers"
                : undefined;
              // Once an offer exists, this button switches to "View Offer Letter"
              // — same dialog, but framed as a viewer (and lets the user manage
              // waivers + see the PDF without re-issuing anything).
              return (
                <Button
                  size="sm"
                  onClick={() => setShowOfferLetter(true)}
                  disabled={!canIssueOffer && !hasOffer}
                  title={hasOffer ? undefined : reason}
                  className={hasOffer ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-teal-600 hover:bg-teal-700 text-white"}
                >
                  {hasOffer ? <FileText className="h-3.5 w-3.5 mr-1.5" /> : <Gift className="h-3.5 w-3.5 mr-1.5" />}
                  {hasOffer ? "View Offer Letter" : "Issue Offer Letter"}
                </Button>
              );
            })()}
          </div>

          {showRejectionInput && !decided && (
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">Rejection reason (visible in lead timeline):</p>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Photo doesn't match requirements; please resubmit"
                rows={2}
                className="text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setShowRejectionInput(false); setRejectionReason(""); }}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" onClick={() => decideApplication("rejected")} disabled={!rejectionReason.trim() || decisionBusy}>
                  Confirm rejection
                </Button>
              </div>
            </div>
          )}

          {counts.rejected > 0 && (
            <p className="text-[11px] text-rose-700 inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Admission Number issuance is blocked while any document is rejected.
            </p>
          )}

          {app.status === "rejected" && app.rejection_reason && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Rejection reason:</span> {app.rejection_reason}
            </p>
          )}
        </div>
      )}

      {/* Document review wizard — preview each doc inline + side actions.
          Course info is surfaced in the header so the verifier can sanity-check
          that the uploaded docs match the eligibility for the applied course. */}
      <DocReviewPanel
        docs={docs}
        reviews={reviews}
        onSetStatus={setDocStatus}
        readOnly={decided || !canApproveApplication}
        readOnlyReason={!canApproveApplication
          ? "You can view this document, but only team leaders, principals, and super admins can approve or reject it."
          : undefined}
        courseInfo={lead?.course ? {
          name: lead.course.name,
          code: lead.course.code,
          durationYears: lead.course.duration_years,
          eligibility: eligibilityRule?.notes || lead.course.eligibility,
          entranceExam: eligibilityRule?.entrance_exam_name || lead.course.entrance_exam,
          entranceMandatory: eligibilityRule?.entrance_exam_required ?? lead.course.entrance_mandatory,
        } : null}
      />

      <ApplicationPreview app={app} docs={docs} />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{app.application_id}</span> ({app.full_name}).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={deleteApplication}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offer Letter dialog — opens after approval */}
      {lead?.id && (
        <OfferLetterDialog
          open={showOfferLetter}
          onOpenChange={setShowOfferLetter}
          leadId={lead.id}
          leadName={lead.name || app.full_name}
          courseId={lead.course_id}
          campusId={lead.campus_id}
          onSuccess={() => { setShowOfferLetter(false); refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Catches render-time crashes within a single section (e.g. the lifecycle
 * stepper) so the rest of the admin page stays usable. Without this, a
 * single null-deref inside one widget white-screens the whole route.
 */
class SectionErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  constructor(props: { label: string; children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[AdminApplicationView/${this.props.label}]`, error); }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
          <p className="font-semibold text-amber-900">Couldn't render {this.props.label}.</p>
          <p className="text-amber-800 mt-0.5">{this.state.error.message}</p>
          <p className="text-amber-700/80 mt-1">The rest of the page is fine. Reload to retry, or check the console for details.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

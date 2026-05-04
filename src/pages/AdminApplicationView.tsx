import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, Gift } from "lucide-react";
import { ApplicationPreview, type PreviewDoc } from "@/components/applicant/ApplicationPreview";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { AdmissionLifecycleStepper } from "@/components/admissions/AdmissionLifecycleStepper";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

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
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<any | null>(null);
  const [lead, setLead] = useState<{ id: string; name: string; course_id: string | null; campus_id: string | null; pre_admission_no: string | null; admission_no: string | null } | null>(null);
  const [hasOffer, setHasOffer] = useState(false);
  const [appFeePaid, setAppFeePaid] = useState(0);
  const [docs, setDocs] = useState<PreviewDoc[]>([]);
  const [reviews, setReviews] = useState<Record<string, DocReview>>({});
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const [showOfferLetter, setShowOfferLetter] = useState(false);

  const refresh = async () => {
    if (!applicationId) return;
    setLoading(true);
    const [{ data: appRow }, fnRes, { data: reviewRows }] = await Promise.all([
      supabase.from("applications").select("*").eq("application_id", applicationId).maybeSingle(),
      supabase.functions.invoke("list-app-docs", { body: { application_id: applicationId } }),
      supabase.from("application_doc_reviews" as any)
        .select("file_path, status, notes, reviewed_at")
        .eq("application_id", applicationId),
    ]);
    setApp(appRow);
    setDocs(((fnRes.data as any)?.docs || []) as PreviewDoc[]);
    const map: Record<string, DocReview> = {};
    (reviewRows as DocReview[] | null || []).forEach(r => { map[r.file_path] = r; });
    setReviews(map);

    // Pull lead's course/campus IDs — needed by OfferLetterDialog. course_selections
    // on the application only has names, so we read them from the linked lead.
    // Also pulls PAN/AN for the lifecycle stepper.
    if (appRow?.lead_id) {
      const [{ data: leadRow }, { data: offerRows }, { data: pmtRows }] = await Promise.all([
        supabase.from("leads")
          .select("id, name, course_id, campus_id, pre_admission_no, admission_no")
          .eq("id", appRow.lead_id).maybeSingle(),
        supabase.from("offer_letters").select("id").eq("lead_id", appRow.lead_id).limit(1),
        supabase.from("lead_payments")
          .select("amount,type,status")
          .eq("lead_id", appRow.lead_id)
          .eq("type", "application_fee")
          .eq("status", "confirmed"),
      ]);
      setLead(leadRow as any);
      setHasOffer(!!(offerRows && offerRows.length));
      setAppFeePaid((pmtRows || []).reduce((sum, p: any) => sum + Number(p.amount || 0), 0));
    } else {
      setLead(null);
      setHasOffer(false);
      setAppFeePaid(0);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [applicationId]);

  // Doc-by-doc review actions. Upserts into application_doc_reviews keyed by
  // (application_id, file_path) so each click is idempotent.
  const setDocStatus = async (doc: PreviewDoc, next: DocStatus, notes?: string) => {
    if (!applicationId) return;
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

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          {app.form_pdf_url && (
            <a href={app.form_pdf_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
              <FileText className="h-3.5 w-3.5" />Form PDF
            </a>
          )}
        </div>
      </div>

      {/* Lifecycle stepper — visual journey from submission → admission */}
      <AdmissionLifecycleStepper
        app={app}
        lead={lead}
        hasLead={!!app.lead_id && !!lead}
        appFeePaid={appFeePaid}
        hasOffer={hasOffer}
        docs={counts}
        onApprove={app.status === "submitted" ? () => decideApplication("approved") : undefined}
        onIssueOffer={app.status === "approved" && !hasOffer && lead?.id ? () => setShowOfferLetter(true) : undefined}
      />

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
            {!decided && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-rose-700 border-rose-200 hover:bg-rose-50"
                  onClick={() => decideApplication("rejected")}
                  disabled={decisionBusy}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => decideApplication("approved")}
                  disabled={decisionBusy || counts.rejected > 0}
                  title={counts.rejected > 0 ? "Resolve rejected documents first" : ""}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                </Button>
              </div>
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
              return (
                <Button
                  size="sm"
                  onClick={() => setShowOfferLetter(true)}
                  disabled={!canIssueOffer}
                  title={reason}
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  <Gift className="h-3.5 w-3.5 mr-1.5" />Issue Offer Letter
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

      <ApplicationPreview app={app} docs={docs} />

      {/* Per-document verification controls */}
      {docs.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/40">
            <h3 className="text-sm font-semibold">Document verification</h3>
            <p className="text-[11px] text-muted-foreground">
              Mark each document Verified or Rejected. Rejected documents block AN issuance until resolved.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {docs.map((doc) => {
              const review = reviews[doc.path];
              const status = review?.status ?? "pending";
              return (
                <li key={doc.path} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <a href={doc.url} target="_blank" rel="noreferrer"
                      className="text-sm font-medium text-foreground hover:text-primary truncate inline-flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0" />{doc.name}
                    </a>
                    {review?.notes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">Note: {review.notes}</p>
                    )}
                  </div>
                  <DocStatusPill status={status} />
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm" variant={status === "verified" ? "default" : "outline"}
                      className={status === "verified" ? "" : "text-emerald-700 border-emerald-200 hover:bg-emerald-50"}
                      onClick={() => setDocStatus(doc, "verified")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm" variant={status === "rejected" ? "destructive" : "outline"}
                      className={status === "rejected" ? "" : "text-rose-700 border-rose-200 hover:bg-rose-50"}
                      onClick={() => {
                        const note = prompt("Why is this document rejected? (visible to internal staff)");
                        if (note === null) return;
                        setDocStatus(doc, "rejected", note || null);
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

function DocStatusPill({ status }: { status: DocStatus }) {
  const map = {
    verified: { Icon: CheckCircle2, label: "Verified", cls: "bg-emerald-50 text-emerald-700" },
    rejected: { Icon: XCircle,      label: "Rejected", cls: "bg-rose-50 text-rose-700" },
    pending:  { Icon: Clock,        label: "Pending",  cls: "bg-amber-50 text-amber-700" },
  } as const;
  const { Icon, label, cls } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  );
}

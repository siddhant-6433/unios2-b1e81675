import { Component, ReactNode, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, Gift, User, Trash2, Upload, UserPlus } from "lucide-react";
import { ApplicationPreview, type PreviewDoc } from "@/components/applicant/ApplicationPreview";
import { DocumentUpload } from "@/components/apply/DocumentUpload";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { AdmissionLifecycleStepper } from "@/components/admissions/AdmissionLifecycleStepper";
import { DocReviewPanel } from "@/components/admissions/DocReviewPanel";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteApplication as deleteApplicationRequest,
  PAID_APPLICATION_DELETE_CONFIRMATION,
} from "@/lib/deleteApplication";
import { cahetRegistrationFromApplication, fetchCahetRegistration, isBptOrBmritCourseName, type CahetRegistrationDetails } from "@/lib/cahet";
import { fetchUpdeledRegistration, isDeledCourseName, updeledRegistrationFromApplication, type SupabaseUpdeledClient, type UpdeledRegistrationDetails } from "@/lib/updeled";
import { buildApplicationDossier } from "@/lib/applicationDossier";
import { resolveLeadTransitionCommand } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";
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
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
}

type ApplicationCourseSelection = {
  course_id?: string | null;
  campus_id?: string | null;
  course_name?: string | null;
  campus_name?: string | null;
};

type LeadCourse = {
  name: string;
  code: string | null;
  duration_years: number | null;
  eligibility: string | null;
  entrance_exam: string | null;
  entrance_mandatory: boolean | null;
};

const COURSE_SELECT = "name,code,duration_years,eligibility,entrance_exam,entrance_mandatory";
const APPROVABLE_APPLICATION_STATUSES = new Set(["submitted", "under_review"]);
const APPLICATION_FORM_PDF_STATUSES = new Set(["submitted", "under_review", "approved", "rejected"]);

function isApprovableApplicationStatus(status: string | null | undefined): boolean {
  return APPROVABLE_APPLICATION_STATUSES.has(status || "");
}

async function fetchCourseDetails(courseId: string): Promise<LeadCourse | null> {
  const { data } = await supabase
    .from("courses")
    .select(COURSE_SELECT)
    .eq("id", courseId)
    .maybeSingle();
  return (data as LeadCourse | null) || null;
}

async function resolvePrimaryCourseSelection(selection: ApplicationCourseSelection | null | undefined) {
  if (!selection) return null;
  if (selection.course_id) {
    return {
      course_id: selection.course_id,
      campus_id: selection.campus_id || null,
    };
  }
  if (!selection.course_name) return null;

  const { data } = await supabase
    .from("courses")
    .select(`
      id, name,
      departments (
        institutions (
          campus_id,
          campuses ( name )
        )
      )
    `)
    .ilike("name", selection.course_name)
    .limit(10);

  const courseRows = (data || []) as any[];
  const campusNeedle = (selection.campus_name || "").trim().toLowerCase();
  const match = courseRows.find((course) => {
    if (!campusNeedle) return true;
    const campusName = course.departments?.institutions?.campuses?.name || "";
    return campusName.trim().toLowerCase() === campusNeedle;
  }) || courseRows[0];

  if (!match?.id) return null;
  return {
    course_id: match.id as string,
    campus_id: (match.departments?.institutions?.campus_id as string | null | undefined) || null,
  };
}

function docKeyForFileName(name: string): string {
  if (name.startsWith("passport_photo.")) return "passport_photo";
  const dashIdx = name.indexOf("-");
  return dashIdx > 0 ? name.substring(0, dashIdx) : name.replace(/\.[^.]+$/, "");
}

function docKeyForDoc(doc: PreviewDoc): string {
  if (doc.doc_key) return doc.doc_key;
  const name = doc.name || doc.path?.split("/").pop() || "";
  return docKeyForFileName(name);
}

function docUploadedTime(doc: PreviewDoc): number {
  const raw = doc.uploaded_at || "";
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function docStatusRank(doc: PreviewDoc): number {
  if (doc.review_status === "rejected") return 0;
  if (doc.review_status === "verified") return 2;
  return 1;
}

function activeDocsByLogicalKey(rawDocs: PreviewDoc[]): PreviewDoc[] {
  const latest = new Map<string, PreviewDoc>();
  rawDocs.forEach((doc) => {
    const key = docKeyForDoc(doc);
    const existing = latest.get(key);
    const docTime = docUploadedTime(doc);
    const existingTime = existing ? docUploadedTime(existing) : -1;
    const shouldReplace = !existing
      || docTime > existingTime
      || (docTime === existingTime && docStatusRank(doc) >= docStatusRank(existing));
    if (shouldReplace) {
      latest.set(key, { ...doc, doc_key: key });
    }
  });
  return Array.from(latest.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function AdminApplicationView() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { role } = useAuth();
  const canApproveApplication = role === "super_admin" || role === "principal";
  const canUploadDocuments = role === "super_admin" || role === "principal" || role === "counsellor";
  const canManageOffer = role === "super_admin" || role === "principal" || role === "counsellor" ||
    role === "admission_head" || role === "campus_admin";
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<any | null>(null);
  const [lead, setLead] = useState<{
    id: string; name: string; course_id: string | null; campus_id: string | null;
    phone: string | null;
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
  const [cahetRegistration, setCahetRegistration] = useState<CahetRegistrationDetails | null>(null);
  const [updeledRegistration, setUpdeledRegistration] = useState<UpdeledRegistrationDetails | null>(null);
  const [docs, setDocs] = useState<PreviewDoc[]>([]);
  const [reviews, setReviews] = useState<Record<string, DocReview>>({});
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showOfferLetter, setShowOfferLetter] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [generatingFormPdf, setGeneratingFormPdf] = useState(false);
  const [repairingLead, setRepairingLead] = useState(false);
  const [applicationApproverName, setApplicationApproverName] = useState<string | null>(null);

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
          .select("file_path, status, notes, reviewed_at, reviewed_by")
          .eq("application_id", applicationId),
      ]);
      if (appErr) throw appErr;
      setApp(appRow);
      const activeDocs = activeDocsByLogicalKey((((fnRes?.data as any)?.docs || []) as PreviewDoc[]));
      const activeDocPaths = new Set(activeDocs.map(d => d.path).filter(Boolean));
      setDocs(activeDocs);
      const profileIds = [
        appRow?.approved_by,
        ...((reviewRows as DocReview[] | null) || []).map(r => r.reviewed_by),
      ].filter(Boolean) as string[];
      const profileNames: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", [...new Set(profileIds)]);
        (profiles || []).forEach((p: any) => { profileNames[p.id] = p.display_name || "Staff"; });
      }
      setApplicationApproverName(appRow?.approved_by ? profileNames[appRow.approved_by] || null : null);
      const map: Record<string, DocReview> = {};
      (reviewRows as DocReview[] | null || []).forEach(r => {
        if (activeDocPaths.has(r.file_path)) {
          map[r.file_path] = { ...r, reviewed_by_name: r.reviewed_by ? profileNames[r.reviewed_by] || null : null };
        }
      });
      setReviews(map);

      // Pull lead's course/campus IDs — needed by OfferLetterDialog. course_selections
      // on the application only has names, so we read them from the linked lead.
      // Also pulls PAN/AN for the lifecycle stepper.
      if (appRow?.lead_id) {
        const primarySelection = ((appRow.course_selections || [])[0] as ApplicationCourseSelection | undefined) || null;
        const [{ data: leadRow }, { data: offerRows }, { data: pmtRows }, cahetRow, updeledRow] = await Promise.all([
          supabase.from("leads")
            .select("id, name, phone, course_id, campus_id, pre_admission_no, admission_no, course:course_id(name,code,duration_years,eligibility,entrance_exam,entrance_mandatory)")
            .eq("id", appRow.lead_id).maybeSingle(),
          supabase.from("offer_letters").select("id").eq("lead_id", appRow.lead_id).limit(1),
          supabase.from("lead_payments")
            .select("amount,type,status")
            .eq("lead_id", appRow.lead_id)
            .eq("type", "application_fee")
            .eq("status", "confirmed"),
          fetchCahetRegistration(supabase, appRow.lead_id),
          fetchUpdeledRegistration(supabase as unknown as SupabaseUpdeledClient, appRow.lead_id),
        ]);
        const resolvedSelection = await resolvePrimaryCourseSelection(primarySelection);
        let effectiveLeadRow = leadRow as any;
        if (leadRow && resolvedSelection?.course_id) {
          const shouldRepairLeadCourse =
            leadRow.course_id !== resolvedSelection.course_id ||
            (!!resolvedSelection.campus_id && leadRow.campus_id !== resolvedSelection.campus_id);

          if (shouldRepairLeadCourse) {
            const repairPayload: Record<string, string> = { course_id: resolvedSelection.course_id };
            if (resolvedSelection.campus_id) repairPayload.campus_id = resolvedSelection.campus_id;
            const { error: repairError } = await supabase
              .from("leads")
              .update(repairPayload as any)
              .eq("id", appRow.lead_id);
            if (repairError) console.warn("[AdminApplicationView] lead course repair failed:", repairError);

            effectiveLeadRow = {
              ...leadRow,
              course_id: resolvedSelection.course_id,
              campus_id: resolvedSelection.campus_id || leadRow.campus_id,
              course: await fetchCourseDetails(resolvedSelection.course_id),
            };
          }
        }
        let ruleRow = null;
        if (effectiveLeadRow?.course_id) {
          const { data } = await supabase
            .from("eligibility_rules")
            .select("notes, entrance_exam_name, entrance_exam_required")
            .eq("course_id", effectiveLeadRow.course_id)
            .maybeSingle();
          ruleRow = data;
        }
        setLead(effectiveLeadRow as any);
        setEligibilityRule(ruleRow);
        setHasOffer(!!(offerRows && offerRows.length));
        setAppFeePaid((pmtRows || []).reduce((sum, p: any) => sum + Number(p.amount || 0), 0));
        const courseName = effectiveLeadRow?.course?.name || primarySelection?.course_name || null;
        const applicationCahet = cahetRegistrationFromApplication(appRow, appRow.lead_id);
        const applicationUpdeled = updeledRegistrationFromApplication(appRow, appRow.lead_id);
        setCahetRegistration(isBptOrBmritCourseName(courseName) ? (cahetRow || applicationCahet) : null);
        setUpdeledRegistration(isDeledCourseName(courseName) ? (updeledRow || applicationUpdeled) : null);
      } else {
        setLead(null);
        setEligibilityRule(null);
        setHasOffer(false);
        setAppFeePaid(0);
        setCahetRegistration(null);
        setUpdeledRegistration(null);
      }
    } catch (e: any) {
      console.error("[AdminApplicationView] refresh failed:", e);
      setLoadError(e?.message || "Failed to load application");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [applicationId]);

  const insertApplicationAudit = async (
    section: string,
    fieldPath: string,
    oldValue: unknown,
    newValue: unknown,
    actor?: { auth_user_id: string | null; display_name: string | null } | null,
  ) => {
    if (!app?.id) return;
    const { error } = await supabase.from("application_audit_log" as any).insert({
      application_id: app.id,
      section,
      field_path: fieldPath,
      old_value: oldValue as any,
      new_value: newValue as any,
      changed_by: actor?.auth_user_id ?? null,
      changed_by_name: actor?.display_name ?? null,
      changed_by_role: role ?? null,
    });
    if (error) console.warn("[AdminApplicationView] audit insert failed:", error);
  };

  // Doc-by-doc review actions. Upserts into application_doc_reviews keyed by
  // (application_id, file_path) so each click is idempotent.
  const setDocStatus = async (doc: PreviewDoc, next: DocStatus, notes?: string) => {
    if (!applicationId || !doc.path) return;
    if (!canApproveApplication) {
      toast({
        title: "Approval restricted",
        description: "Only principals and super admins can approve or reject documents.",
        variant: "destructive",
      });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("id, display_name").eq("user_id", user.id).maybeSingle()
      : { data: null };
    const previous = reviews[doc.path] || null;

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
    await insertApplicationAudit(
      "documents",
      `document_review.${doc.name}`,
      previous ? { status: previous.status, notes: previous.notes, reviewed_by: previous.reviewed_by_name || previous.reviewed_by } : null,
      { status: next, notes: payload.notes, reviewed_by: profile?.display_name || profile?.id || null },
      { auth_user_id: user?.id ?? null, display_name: profile?.display_name || null },
    );
    setReviews(prev => ({ ...prev, [doc.path!]: { ...payload, reviewed_by_name: profile?.display_name || null } as DocReview }));
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
      ? await supabase.from("profiles").select("id, display_name").eq("user_id", user.id).maybeSingle()
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
    await insertApplicationAudit(
      "approval",
      "status",
      { status: app.status, approved_by: app.approved_by || null, rejection_reason: app.rejection_reason || null },
      { status: decision, approved_by: profile?.display_name || profile?.id || null, rejection_reason: updates.rejection_reason },
      { auth_user_id: user?.id ?? null, display_name: profile?.display_name || null },
    );

    // Advance lead stage on approval (if this app has a lead). Reject leaves
    // stage alone — operator can move the lead manually if needed.
    if (decision === "approved" && app.lead_id) {
      const transition = resolveLeadTransitionCommand({
        currentStage: lead?.stage || "application_submitted",
        command: "approveApplication",
      });
      await applyResolvedLeadTransition(supabase as any, {
        leadId: app.lead_id,
        transition,
        reason: `Application ${app.application_id} approved`,
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

  const createLinkedLead = async (options?: { openOffer?: boolean }) => {
    if (!app) return null;
    if (!app.phone) {
      toast({ title: "Cannot create lead", description: "Application has no phone number.", variant: "destructive" });
      return null;
    }
    setRepairingLead(true);
    try {
      const firstCourse = ((app.course_selections || [])[0] as ApplicationCourseSelection) || {};
      const resolvedSelection = await resolvePrimaryCourseSelection(firstCourse);
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id, course_id, campus_id")
        .eq("application_id", app.application_id)
        .maybeSingle();

      let leadId = existingLead?.id as string | undefined;
      const stage = app.status === "approved"
        ? "application_approved"
        : app.status === "submitted" || app.status === "under_review"
        ? "application_submitted"
        : app.payment_status === "paid"
        ? "application_fee_paid"
        : "application_in_progress";

      if (!leadId) {
        const guardianName = app.guardian?.name || app.father?.name || app.mother?.name || null;
        const guardianPhone = app.guardian?.phone || app.father?.phone || app.father?.phone_mobile || app.mother?.phone || app.mother?.phone_mobile || null;
        const { data: inserted, error: insertErr } = await supabase
          .from("leads")
          .insert({
            name: app.full_name || "Applicant",
            phone: app.phone,
            email: app.email || null,
            guardian_name: guardianName,
            guardian_phone: guardianPhone,
            course_id: resolvedSelection?.course_id || null,
            campus_id: resolvedSelection?.campus_id || null,
            source: "website",
            stage,
            person_role: "applicant",
            application_id: app.application_id,
          } as any)
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        leadId = inserted.id;
      } else if (
        resolvedSelection?.course_id &&
        (existingLead.course_id !== resolvedSelection.course_id ||
          (!!resolvedSelection.campus_id && existingLead.campus_id !== resolvedSelection.campus_id))
      ) {
        const repairPayload: Record<string, string> = { course_id: resolvedSelection.course_id };
        if (resolvedSelection.campus_id) repairPayload.campus_id = resolvedSelection.campus_id;
        const { error: leadUpdateErr } = await supabase
          .from("leads")
          .update(repairPayload as any)
          .eq("id", leadId);
        if (leadUpdateErr) throw leadUpdateErr;
      }

      const linkedCourse = resolvedSelection?.course_id || existingLead?.course_id || null;
      const linkedCampus = resolvedSelection?.campus_id || existingLead?.campus_id || null;
      const linkedCourseDetails = linkedCourse ? await fetchCourseDetails(linkedCourse) : null;

      const { error: appUpdateErr } = await supabase
        .from("applications")
        .update({ lead_id: leadId })
        .eq("id", app.id);
      if (appUpdateErr) throw appUpdateErr;

      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        type: "system",
        description: `Lead created and linked from orphan application ${app.application_id}`,
      } as any);

      toast({ title: "Lead linked", description: `Application ${app.application_id} is associated with a lead again.` });
      setApp((prev: any) => prev ? { ...prev, lead_id: leadId } : prev);
      setLead({
        id: leadId,
        name: app.full_name || "Applicant",
        course_id: linkedCourse,
        campus_id: linkedCampus,
        pre_admission_no: null,
        admission_no: null,
        course: linkedCourseDetails,
      });
      await refresh();
      if (options?.openOffer) {
        if (!linkedCourse) {
          toast({
            title: "Course missing",
            description: "Lead was linked, but no course/class is available for offer generation.",
            variant: "destructive",
          });
        } else {
          setShowOfferLetter(true);
        }
      }
      return leadId;
    } catch (e: any) {
      toast({ title: "Couldn't create lead", description: e?.message || "Lead repair failed", variant: "destructive" });
      return null;
    } finally {
      setRepairingLead(false);
    }
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

  const dossier = useMemo(() => {
    if (!app) return null;
    return buildApplicationDossier({
      id: app.id,
      application_id: app.application_id,
      lead_id: app.lead_id || lead?.id || null,
      status: app.status || "draft",
      payment_status: app.payment_status || null,
    }, {
      lead: {
        hasLead: !!lead?.id,
        leadStage: "",
        counsellorId: null,
        counsellorName: null,
        preAdmissionNo: lead?.pre_admission_no || null,
        admissionNo: lead?.admission_no || null,
      },
      hasOffer,
      appFeePaid,
      hasTokenFeePaid: false,
      docs: counts,
      capabilities: {
        canManageOffer,
        hasLeadCourse: !!lead?.course_id,
      },
    });
  }, [app, appFeePaid, canManageOffer, counts, hasOffer, lead]);

  const deleteApplication = async () => {
    if (!app || role !== "super_admin") return;
    const paidDeleteConfirmation = app.payment_status === "paid"
      ? deleteConfirmText.trim().toUpperCase()
      : undefined;
    setDeleting(true);
    const { data, error } = await deleteApplicationRequest({
      id: app.id,
      applicationId: app.application_id,
      paymentStatus: app.payment_status,
      paidDeleteConfirmation,
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
  const canDecideCurrentApplication = isApprovableApplicationStatus(app.status);

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

  const generateFormPdf = async () => {
    if (generatingFormPdf || !app?.application_id) return;
    setGeneratingFormPdf(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-application-form", {
        body: { application_id: app.application_id },
      });
      if (error) throw error;
      const url = (data as any)?.form_pdf_url;
      if (!url) throw new Error("PDF URL was not returned");
      setApp((prev: any) => prev ? { ...prev, form_pdf_url: url } : prev);
      window.open(url, "_blank");
    } catch (e: any) {
      toast({ title: "Couldn't generate form PDF", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setGeneratingFormPdf(false);
    }
  };

  const issueOfferOrRepairLead = async () => {
    if (!canManageOffer) {
      toast({ title: "Offer restricted", description: "You do not have permission to issue offers.", variant: "destructive" });
      return;
    }
    if (lead?.id) {
      if (!lead.course_id) {
        toast({
          title: "Course missing",
          description: "No course/class is linked to this application yet.",
          variant: "destructive",
        });
        return;
      }
      setShowOfferLetter(true);
      return;
    }
    await createLinkedLead({ openOffer: true });
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
          {(lead?.id || app.lead_id) && (
            <ApplyMagicLinkButton
              leadId={lead?.id || app.lead_id}
              leadName={lead?.name || app.full_name}
              leadPhone={lead?.phone || app.phone}
            />
          )}
          {!lead?.id && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => createLinkedLead()}
              disabled={repairingLead}
            >
              {repairingLead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              Create Linked Lead
            </Button>
          )}
          {role === "super_admin" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => {
                setShowDeleteConfirm(true);
                setDeleteConfirmText("");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
          {app.form_pdf_url ? (
            <a href={app.form_pdf_url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
              <FileText className="h-3.5 w-3.5" />Form PDF
            </a>
          ) : APPLICATION_FORM_PDF_STATUSES.has(app.status) && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={generateFormPdf}
              disabled={generatingFormPdf}
            >
              {generatingFormPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Generate Form PDF
            </Button>
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
          onApprove={canApproveApplication && canDecideCurrentApplication ? () => decideApplication("approved") : undefined}
          onIssueOffer={app.status === "approved" && !hasOffer && canManageOffer ? issueOfferOrRepairLead : undefined}
          feeReceiptUrl={app.fee_receipt_url || null}
          onGenerateFeeReceipt={appFeePaid > 0 ? generateFeeReceipt : undefined}
        />
      </SectionErrorBoundary>

      {/* Review summary + application-level decision */}
      {(canDecideCurrentApplication || decided) && (
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
                You can view and upload documents. Principals and super admins approve or reject applications.
              </p>
            )}
            {decided && app.status === "approved" && (() => {
              const canIssueOffer = dossier?.canIssueOffer ?? false;
              const reason = dossier?.offerBlockedReason || undefined;
              // Once an offer exists, this button switches to "View Offer Letter"
              // — same dialog, but framed as a viewer (and lets the user manage
              // waivers + see the PDF without re-issuing anything).
              return (
                <Button
                  size="sm"
                  onClick={issueOfferOrRepairLead}
                  disabled={repairingLead || (!canIssueOffer && !hasOffer)}
                  title={hasOffer ? undefined : reason}
                  className={hasOffer ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-teal-600 hover:bg-teal-700 text-white"}
                >
                  {repairingLead ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : hasOffer ? <FileText className="h-3.5 w-3.5 mr-1.5" /> : <Gift className="h-3.5 w-3.5 mr-1.5" />}
                  {hasOffer ? "View Offer Letter" : lead?.id ? "Issue Offer Letter" : "Create Lead & Issue Offer"}
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
          {app.status === "approved" && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Application approved</span>
              {applicationApproverName && <> by <span className="font-medium text-foreground">{applicationApproverName}</span></>}
              {app.approved_at && <> on {new Date(app.approved_at).toLocaleString("en-IN")}</>}
            </p>
          )}
        </div>
      )}

      {canUploadDocuments && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Upload or Re-upload Documents</h3>
          </div>
          <DocumentUpload
            data={app}
            onChange={(partial) => setApp((prev: any) => prev ? { ...prev, ...partial } : prev)}
            onNext={refresh}
            saving={false}
            nextLabel="Refresh document list"
            storageTarget="supabase"
          />
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
          ? "You can view this document, but only principals and super admins can approve or reject it."
          : undefined}
        courseInfo={lead?.course ? {
          name: lead.course.name,
          code: lead.course.code,
          durationYears: lead.course.duration_years,
          eligibility: eligibilityRule?.notes || lead.course.eligibility,
          entranceExam: eligibilityRule?.entrance_exam_name || lead.course.entrance_exam,
          entranceMandatory: eligibilityRule?.entrance_exam_required ?? lead.course.entrance_mandatory,
        } : null}
        cahetRegistration={cahetRegistration}
      />

      <ApplicationPreview app={app} docs={docs} cahetRegistration={cahetRegistration} />

      <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => {
        setShowDeleteConfirm(open);
        if (!open) setDeleteConfirmText("");
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{app.application_id}</span> ({app.full_name}).
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {app.payment_status === "paid" && (
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
                app.payment_status === "paid" &&
                deleteConfirmText.trim().toUpperCase() !== PAID_APPLICATION_DELETE_CONFIRMATION
              )}
              onClick={(event) => {
                event.preventDefault();
                void deleteApplication();
              }}
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
          applicationId={app.application_id || applicationId}
          courseId={lead.course_id}
          courseName={lead.course?.name}
          campusId={lead.campus_id}
          cahetRegistration={cahetRegistration}
          updeledRegistration={updeledRegistration}
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

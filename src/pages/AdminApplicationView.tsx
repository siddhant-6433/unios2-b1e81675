import { Component, ReactNode, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Loader2, CheckCircle2, XCircle, Clock, AlertCircle, Gift, User, Trash2, Upload, UserPlus, GraduationCap, Pencil, IndianRupee, Receipt, FileDown, ExternalLink, Plus, Handshake, School, PauseCircle, PlayCircle, MessageSquare, Share2 } from "lucide-react";
import { ApplicationPreview, type PreviewDoc } from "@/components/applicant/ApplicationPreview";
import { DocumentUpload } from "@/components/apply/DocumentUpload";
import { OfferLetterDialog } from "@/components/admissions/OfferLetterDialog";
import { AdmissionLifecycleStepper } from "@/components/admissions/AdmissionLifecycleStepper";
import { DocReviewPanel } from "@/components/admissions/DocReviewPanel";
import { ApplyMagicLinkButton } from "@/components/leads/ApplyMagicLinkButton";
import { OfflinePaymentDialog } from "@/components/finance/OfflinePaymentDialog";
import { SendPaymentLinkDialog } from "@/components/finance/SendPaymentLinkDialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteApplication as deleteApplicationRequest,
  PAID_APPLICATION_DELETE_CONFIRMATION,
} from "@/lib/deleteApplication";
import { cahetRegistrationFromApplication, fetchCahetRegistration, isBptOrBmritCourseName, type CahetRegistrationDetails } from "@/lib/cahet";
import { ReferToPartnerDialog } from "@/components/admissions/ReferToPartnerDialog";
import {
  fetchReferralsByLead, isReferrableCourse, REFERRAL_PARTNER_LABEL,
  REFERRAL_STATUS_COLORS, REFERRAL_STATUS_LABELS, type LeadReferralRow,
} from "@/lib/leadReferral";
import { fetchUpdeledRegistration, isDeledCourseName, updeledRegistrationFromApplication, type SupabaseUpdeledClient, type UpdeledRegistrationDetails } from "@/lib/updeled";
import { buildApplicationDossier } from "@/lib/applicationDossier";
import { resolveLeadTransitionCommand } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { ExternalOwnerDialog } from "@/components/admissions/ExternalOwnerDialog";
import { HoldApplicationDialog, type HoldApplicationTarget } from "@/components/admissions/HoldApplicationDialog";
import { determineProgramCategory } from "@/components/apply/types";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

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
  institution_id?: string | null;
  course_name?: string | null;
  campus_name?: string | null;
  preference_order?: number | null;
  program_category?: string | null;
};

type LeadCourse = {
  name: string;
  code: string | null;
  duration_years: number | null;
  eligibility: string | null;
  entrance_exam: string | null;
  entrance_mandatory: boolean | null;
};

interface LeadPaymentRow {
  id: string;
  type: string;
  amount: number;
  payment_mode: string | null;
  gateway: string | null;
  transaction_ref: string | null;
  receipt_no: string | null;
  receipt_url: string | null;
  proof_url: string | null;
  status: string;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
  recorded_by_name?: string | null;
}

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

  const { role, hasPermission } = useAuth();
  const canApproveApplication = role === "super_admin" || role === "principal";
  const canUploadDocuments = role === "super_admin" || role === "principal" || role === "counsellor";
  const canManageOffer = role === "super_admin" || role === "principal" || role === "counsellor" ||
    role === "admission_head" || role === "campus_admin";
  const canEditProgram = canManageOffer;
  const isSuperAdmin = role === "super_admin";
  const isCounsellor = role === "counsellor";
  const canAssignExternalOwner =
    isSuperAdmin
    || role === "principal"
    || hasPermission("leads:assign_external_owner")
    || (role === "counsellor" && hasPermission("consultants:view"));
  const { courseOptions, loading: courseOptionsLoading } = useCourseCampusLink();
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<any | null>(null);
  const [lead, setLead] = useState<{
    id: string; name: string; course_id: string | null; campus_id: string | null;
    phone: string | null;
    pre_admission_no: string | null; admission_no: string | null;
    consultant_id?: string | null;
    academic_partner_id?: string | null;
    lead_consultant?: { name: string } | null;
    lead_academic_partner?: { name: string; organization: string | null } | null;
    course?: { name: string; code: string | null; duration_years: number | null; eligibility: string | null; entrance_exam: string | null; entrance_mandatory: boolean | null } | null;
  } | null>(null);
  const [eligibilityRule, setEligibilityRule] = useState<{
    notes: string | null;
    entrance_exam_name: string | null;
    entrance_exam_required: boolean | null;
  } | null>(null);
  // Curated course facts (public.course_facts via fn_course_facts) — the single
  // source of truth shared with the website, WhatsApp templates and Navya.
  const [courseFacts, setCourseFacts] = useState<Record<string, string> | null>(null);
  const [hasOffer, setHasOffer] = useState(false);
  const [appFeePaid, setAppFeePaid] = useState(0);
  const [cahetRegistration, setCahetRegistration] = useState<CahetRegistrationDetails | null>(null);
  const [showReferPartner, setShowReferPartner] = useState(false);
  const [referral, setReferral] = useState<LeadReferralRow | null>(null);
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
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [editCourseId, setEditCourseId] = useState("");
  const [savingProgram, setSavingProgram] = useState(false);
  const [leadPayments, setLeadPayments] = useState<LeadPaymentRow[]>([]);
  const [offlinePaymentOpen, setOfflinePaymentOpen] = useState(false);
  const [sendLinkOpen, setSendLinkOpen] = useState(false);
  const [showExternalOwner, setShowExternalOwner] = useState(false);
  const [holdTarget, setHoldTarget] = useState<HoldApplicationTarget | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);

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
      if (appRow?.id) loadComments(appRow.id);
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
        const [{ data: leadRow }, { data: offerRows }, { data: pmtRows }, { data: allPmtRows }, cahetRow, updeledRow] = await Promise.all([
          supabase.from("leads")
            .select("id, name, phone, course_id, campus_id, pre_admission_no, admission_no, consultant_id, academic_partner_id, lead_consultant:consultant_id(name), course:course_id(name,code,duration_years,eligibility,entrance_exam,entrance_mandatory)")
            .eq("id", appRow.lead_id).maybeSingle(),
          supabase.from("offer_letters").select("id").eq("lead_id", appRow.lead_id).limit(1),
          supabase.from("lead_payments")
            .select("amount,type,status")
            .eq("lead_id", appRow.lead_id)
            .eq("type", "application_fee")
            .eq("status", "confirmed"),
          supabase.from("lead_payments")
            .select("id,type,amount,payment_mode,gateway,transaction_ref,receipt_no,receipt_url,proof_url,status,payment_date,notes,created_at,recorded_by")
            .eq("lead_id", appRow.lead_id)
            .order("created_at", { ascending: false }),
          fetchCahetRegistration(supabase, appRow.lead_id),
          fetchUpdeledRegistration(supabase as unknown as SupabaseUpdeledClient, appRow.lead_id),
        ]);
        // Academic-partner PRIVATE leads (shared_with_nimt=false) are hidden from
        // non-super_admin staff by RLS, so the direct read above returns null even
        // though the lead exists. Resolve it via a role-gated definer RPC so
        // admission staff can process the application (writes already allow them)
        // instead of seeing a false "lead deleted" — and, critically, so
        // "issue offer" does not create a duplicate lead.
        let baseLeadRow: any = leadRow;
        if (!baseLeadRow && appRow.lead_id) {
          const { data: rpcLead } = await (supabase as unknown as {
            rpc: (fn: "get_application_lead", args: { _application_id: string }) => Promise<{ data: any }>;
          }).rpc("get_application_lead", { _application_id: appRow.application_id });
          if (rpcLead) baseLeadRow = rpcLead;
        }
        const resolvedSelection = await resolvePrimaryCourseSelection(primarySelection);
        let effectiveLeadRow = baseLeadRow as any;
        if (baseLeadRow && resolvedSelection?.course_id) {
          const shouldRepairLeadCourse =
            baseLeadRow.course_id !== resolvedSelection.course_id ||
            (!!resolvedSelection.campus_id && baseLeadRow.campus_id !== resolvedSelection.campus_id);

          if (shouldRepairLeadCourse) {
            const repairPayload: Record<string, string> = { course_id: resolvedSelection.course_id };
            if (resolvedSelection.campus_id) repairPayload.campus_id = resolvedSelection.campus_id;
            const { error: repairError } = await supabase
              .from("leads")
              .update(repairPayload as any)
              .eq("id", appRow.lead_id);
            if (repairError) console.warn("[AdminApplicationView] lead course repair failed:", repairError);

            effectiveLeadRow = {
              ...baseLeadRow,
              course_id: resolvedSelection.course_id,
              campus_id: resolvedSelection.campus_id || baseLeadRow.campus_id,
              course: await fetchCourseDetails(resolvedSelection.course_id),
            };
          }
        }
        let ruleRow = null;
        let factsRow: Record<string, string> | null = null;
        if (effectiveLeadRow?.course_id) {
          const [{ data }, factsRes] = await Promise.all([
            supabase
              .from("eligibility_rules")
              .select("notes, entrance_exam_name, entrance_exam_required")
              .eq("course_id", effectiveLeadRow.course_id)
              .maybeSingle(),
            // Curated single source of truth — the same words the student was
            // shown on the website and over WhatsApp, so the reviewer checks
            // documents against the criteria we actually published.
            (supabase.rpc as any)("fn_course_facts", {
              p_course_id: effectiveLeadRow.course_id,
              p_student_name: null,
            }),
          ]);
          ruleRow = data;
          if (!factsRes?.error && factsRes?.data && typeof factsRes.data === "object") {
            factsRow = factsRes.data as Record<string, string>;
          }
        }
        if (effectiveLeadRow?.academic_partner_id) {
          const { data: apRow } = await supabase
            .from("academic_partners")
            .select("name, organization")
            .eq("id", effectiveLeadRow.academic_partner_id)
            .maybeSingle();
          if (apRow) effectiveLeadRow.lead_academic_partner = apRow;
        }
        setLead(effectiveLeadRow as any);
        setEligibilityRule(ruleRow);
        setCourseFacts(factsRow);
        setHasOffer(!!(offerRows && offerRows.length));
        setAppFeePaid((pmtRows || []).reduce((sum, p: any) => sum + Number(p.amount || 0), 0));
        const courseName = effectiveLeadRow?.course?.name || primarySelection?.course_name || null;
        const applicationCahet = cahetRegistrationFromApplication(appRow, appRow.lead_id);
        const applicationUpdeled = updeledRegistrationFromApplication(appRow, appRow.lead_id);
        setCahetRegistration(isBptOrBmritCourseName(courseName) ? (cahetRow || applicationCahet) : null);
        if (isBptOrBmritCourseName(courseName) && effectiveLeadRow?.id) {
          const referralMap = await fetchReferralsByLead([effectiveLeadRow.id]);
          setReferral(referralMap.get(effectiveLeadRow.id) || null);
        } else {
          setReferral(null);
        }
        setUpdeledRegistration(isDeledCourseName(courseName) ? (updeledRow || applicationUpdeled) : null);

        // Resolve recorded_by names for payments
        const rawPayments = (allPmtRows || []) as any[];
        const recorderIds = rawPayments.map((p: any) => p.recorded_by).filter(Boolean) as string[];
        const recorderNames: Record<string, string> = {};
        if (recorderIds.length > 0) {
          const uniqueIds = [...new Set(recorderIds)];
          const missing = uniqueIds.filter(id => !profileNames[id]);
          if (missing.length > 0) {
            const { data: recProfiles } = await supabase
              .from("profiles")
              .select("id, display_name")
              .in("id", missing);
            (recProfiles || []).forEach((p: any) => { recorderNames[p.id] = p.display_name || "Staff"; });
          }
        }
        const allNames = { ...profileNames, ...recorderNames };
        setLeadPayments(rawPayments.map((p: any) => ({
          ...p,
          recorded_by_name: p.recorded_by ? allNames[p.recorded_by] || null : null,
        })));
      } else {
        setLead(null);
        setEligibilityRule(null);
        setCourseFacts(null);
        setHasOffer(false);
        setAppFeePaid(0);
        setCahetRegistration(null);
        setUpdeledRegistration(null);
        setLeadPayments([]);
      }
    } catch (e: any) {
      console.error("[AdminApplicationView] refresh failed:", e);
      setLoadError(e?.message || "Failed to load application");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [applicationId]);

  const loadComments = async (appId: string) => {
    const { data } = await supabase
      .from("application_comments" as any)
      .select("*")
      .eq("application_id", appId)
      .order("created_at", { ascending: false });
    setComments((data as any[]) || []);
  };

  const addComment = async () => {
    if (!newComment.trim() || !app?.id) return;
    setSavingComment(true);
    const { error } = await supabase.rpc("add_application_comment" as any, {
      _application_id: app.id,
      _body: newComment.trim(),
      _kind: "comment",
    });
    if (error) {
      toast({ title: "Couldn't add comment", description: error.message, variant: "destructive" });
    } else {
      setNewComment("");
      await loadComments(app.id);
    }
    setSavingComment(false);
  };

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
    // Route through the edge function: it writes the review, recomputes the
    // application's mandatory-document completeness, and re-runs the admission-
    // number engine (so verifying the last mandatory doc auto-issues the AN).
    const { error } = await supabase.functions.invoke("review-admission-doc", {
      body: { application_id: applicationId, file_path: doc.path, status: next, notes: payload.notes },
    });
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

  const primarySelection = useMemo<ApplicationCourseSelection | null>(() => {
    const selections = Array.isArray(app?.course_selections) ? app.course_selections : [];
    return (selections[0] as ApplicationCourseSelection | undefined) || null;
  }, [app?.course_selections]);

  const currentCourseOption = useMemo(() => {
    if (!primarySelection && !lead?.course_id) return null;
    if (primarySelection?.course_id || lead?.course_id) {
      const byId = courseOptions.find((course) => course.id === (primarySelection?.course_id || lead?.course_id));
      if (byId) return byId;
    }
    const courseName = (primarySelection?.course_name || lead?.course?.name || "").trim().toLowerCase();
    const campusName = (primarySelection?.campus_name || "").trim().toLowerCase();
    if (!courseName) return null;
    return courseOptions.find((course) => {
      const sameCourse = course.name.trim().toLowerCase() === courseName;
      if (!sameCourse) return false;
      if (!campusName) return true;
      return course.campus_name.trim().toLowerCase() === campusName;
    }) || null;
  }, [courseOptions, lead?.course?.name, lead?.course_id, primarySelection]);

  const currentCourseName = currentCourseOption?.name || lead?.course?.name || primarySelection?.course_name || "No program selected";
  const currentCampusName = currentCourseOption?.campus_name || primarySelection?.campus_name || "";

  const buildHoldTarget = (): HoldApplicationTarget | null => {
    if (!app) return null;
    return {
      id: app.id,
      application_id: app.application_id,
      lead_id: lead?.id || app.lead_id || null,
      full_name: app.full_name,
      phone: lead?.phone || app.phone,
      course_name: currentCourseName,
      exam_code: null, // ponytail: skip exam derivation; hold dialog falls back to generic WA copy
      on_hold: app.status === "on_hold",
      hold_reason: app.hold_reason,
      show_counselling_preset: !["token_paid", "pre_admitted", "admitted"].includes(app.status),
    };
  };
  const sortedCourseOptions = useMemo(() => (
    [...courseOptions].sort((a, b) => {
      const campusCmp = a.campus_name.localeCompare(b.campus_name);
      if (campusCmp) return campusCmp;
      const deptCmp = a.department_name.localeCompare(b.department_name);
      if (deptCmp) return deptCmp;
      return a.name.localeCompare(b.name);
    })
  ), [courseOptions]);

  const openProgramEditor = () => {
    setEditCourseId(currentCourseOption?.id || lead?.course_id || primarySelection?.course_id || "");
    setProgramDialogOpen(true);
  };

  const saveProgramChange = async () => {
    if (!app || !editCourseId || savingProgram) return;
    const selectedCourse = courseOptions.find((course) => course.id === editCourseId);
    if (!selectedCourse) {
      toast({ title: "Select a valid program", description: "The selected course/class could not be found.", variant: "destructive" });
      return;
    }

    const existingSelections = Array.isArray(app.course_selections) ? app.course_selections as ApplicationCourseSelection[] : [];
    const previousPrimary = existingSelections[0] || null;
    const programCategory = determineProgramCategory(selectedCourse.code || "", selectedCourse.name);
    const nextPrimary: ApplicationCourseSelection = {
      ...(previousPrimary || {}),
      course_id: selectedCourse.id,
      campus_id: selectedCourse.campus_id,
      institution_id: selectedCourse.institution_id,
      course_name: selectedCourse.name,
      campus_name: selectedCourse.campus_name,
      preference_order: 1,
      program_category: programCategory,
    };
    const nextSelections = [
      nextPrimary,
      ...existingSelections.slice(1).filter((selection) => selection.course_id !== selectedCourse.id),
    ].map((selection, index) => ({ ...selection, preference_order: index + 1 }));

    setSavingProgram(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from("profiles").select("id, display_name").eq("user_id", user.id).maybeSingle()
        : { data: null };

      const appUpdates = {
        course_selections: nextSelections,
        program_category: programCategory,
        institution_id: selectedCourse.institution_id,
        form_pdf_url: null,
      } as any;
      const { error: appError } = await supabase.from("applications").update(appUpdates).eq("id", app.id);
      if (appError) throw appError;

      if (app.lead_id || lead?.id) {
        const leadId = app.lead_id || lead?.id;
        const { error: leadError } = await supabase
          .from("leads")
          .update({ course_id: selectedCourse.id, campus_id: selectedCourse.campus_id } as any)
          .eq("id", leadId);
        if (leadError) throw leadError;

        await supabase.from("lead_activities").insert({
          lead_id: leadId,
          type: "system",
          description: `Application program changed from ${previousPrimary?.course_name || lead?.course?.name || "Unassigned"} to ${selectedCourse.name}`,
        } as any);
      }

      await insertApplicationAudit(
        "course_preferences",
        "course_selections.0",
        previousPrimary ? {
          course_id: previousPrimary.course_id || lead?.course_id || null,
          course_name: previousPrimary.course_name || lead?.course?.name || null,
          campus_id: previousPrimary.campus_id || lead?.campus_id || null,
          campus_name: previousPrimary.campus_name || null,
        } : null,
        {
          course_id: selectedCourse.id,
          course_name: selectedCourse.name,
          campus_id: selectedCourse.campus_id,
          campus_name: selectedCourse.campus_name,
        },
        { auth_user_id: user?.id ?? null, display_name: profile?.display_name || null },
      );

      setProgramDialogOpen(false);
      setApp((prev: any) => prev ? { ...prev, ...appUpdates } : prev);
      setLead((prev) => prev ? {
        ...prev,
        course_id: selectedCourse.id,
        campus_id: selectedCourse.campus_id,
        course: {
          name: selectedCourse.name,
          code: selectedCourse.code,
          duration_years: selectedCourse.duration_years,
          eligibility: null,
          entrance_exam: null,
          entrance_mandatory: null,
        },
      } : prev);
      toast({ title: "Program updated", description: `${app.full_name}'s application now points to ${selectedCourse.name}.` });
      await refresh();
    } catch (e: any) {
      toast({ title: "Couldn't update program", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSavingProgram(false);
    }
  };

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
        <OrbLoader state="searching" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <p className="text-sm font-semibold text-destructive">Couldn't load this application</p>
          <p className="text-xs text-destructive mt-1">{loadError}</p>
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
          <Badge className="text-[10px] border-0 bg-primary/10 text-primary">{app.status}</Badge>
          <Badge className="text-[10px] border-0 bg-success/10 text-success">{app.payment_status || "pending"}</Badge>
          {lead && (() => {
            const extOwner = lead.consultant_id
              ? { type: "consultant" as const, id: lead.consultant_id, label: `Consultant: ${(lead.lead_consultant as any)?.name || "Assigned"}` }
              : lead.academic_partner_id
                ? { type: "academic_partner" as const, id: lead.academic_partner_id, label: `Admission Partner: ${(lead.lead_academic_partner as any)?.organization || (lead.lead_academic_partner as any)?.name || "Assigned"}` }
                : { type: "none" as const, id: null, label: "No external owner" };
            const OwnerIcon = extOwner.type === "academic_partner" ? School : Handshake;
            return (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    extOwner.type === "consultant"
                      ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
                      : extOwner.type === "academic_partner"
                        ? "bg-info/10 text-info-foreground dark:bg-info/80/30 dark:text-info/80"
                        : "bg-muted text-muted-foreground"
                  }`}
                  title="External owner"
                >
                  <OwnerIcon className="h-3 w-3" />
                  {extOwner.label}
                </span>
                {canAssignExternalOwner && (
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowExternalOwner(true)}>
                    <Handshake className="h-3.5 w-3.5" /> Assign Owner
                  </Button>
                )}
              </>
            );
          })()}
          {referral && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${REFERRAL_STATUS_COLORS[referral.status] || "bg-muted text-muted-foreground"}`}
              title={referral.partner_notes || undefined}
            >
              <Share2 className="h-3 w-3" />
              {REFERRAL_PARTNER_LABEL} · {REFERRAL_STATUS_LABELS[referral.status] || referral.status}
            </span>
          )}
          {!referral && (lead?.id || app.lead_id) && isReferrableCourse(lead?.course?.name) && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setShowReferPartner(true)}
            >
              <Share2 className="h-3.5 w-3.5" /> Refer to {REFERRAL_PARTNER_LABEL}
            </Button>
          )}
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
          {(lead?.id || app.lead_id) && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setSendLinkOpen(true)}
            >
              <IndianRupee className="h-3.5 w-3.5" />
              Send Payment Link
            </Button>
          )}
          {!lead?.id && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => createLinkedLead()}
              disabled={repairingLead}
            >
              {repairingLead ? <ButtonOrb state="working" /> : <UserPlus className="h-3.5 w-3.5" />}
              Create Linked Lead
            </Button>
          )}
          {!isCounsellor && (
            app.status === "on_hold" ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs text-success border-success/30 hover:bg-success/5"
                onClick={() => setHoldTarget(buildHoldTarget())}
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Release hold
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs text-warning-foreground border-warning/40 hover:bg-warning/5"
                onClick={() => setHoldTarget(buildHoldTarget())}
              >
                <PauseCircle className="h-3.5 w-3.5" />
                Hold
              </Button>
            )
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
              {generatingFormPdf ? <ButtonOrb state="working" /> : <FileText className="h-3.5 w-3.5" />}
              Generate Form PDF
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              <GraduationCap className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Program / Course</p>
              <p className="text-sm font-semibold text-foreground truncate">{currentCourseName}</p>
              {currentCampusName && <p className="text-xs text-muted-foreground truncate">{currentCampusName}</p>}
              {hasOffer && (
                <p className="mt-1 text-[11px] text-warning-foreground">
                  Existing offer letters remain unchanged. Regenerate or edit the offer letter if it should use the new program.
                </p>
              )}
            </div>
          </div>
          {canEditProgram && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={openProgramEditor}
              disabled={courseOptionsLoading || savingProgram}
            >
              {savingProgram ? <ButtonOrb state="working" /> : <Pencil className="h-3.5 w-3.5" />}
              Edit Program
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

      {/* Fee receipts / payment history */}
      {lead?.id && leadPayments.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Fee Receipts</h3>
              <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                {leadPayments.length}
              </span>
            </div>
            {["super_admin", "accountant", "office_admin"].includes(role || "") && (
              <button
                onClick={() => setOfflinePaymentOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />Add Offline Receipt
              </button>
            )}
          </div>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {leadPayments.map((pmt) => {
              const feeLabel =
                pmt.type === "application_fee" ? "Application Fee"
                : pmt.type === "token_fee" ? "Token Fee"
                : pmt.type === "registration_fee" ? "Registration Fee"
                : "Other";
              const isConfirmed = pmt.status === "confirmed";
              return (
                <div key={pmt.id} className="flex items-center gap-3 px-3 py-2.5 text-xs bg-background hover:bg-muted/30 transition-colors">
                  <div className={`shrink-0 rounded-full p-1.5 ${isConfirmed ? "bg-success/10 text-success" : "bg-warning/10 text-warning-foreground"}`}>
                    {isConfirmed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{feeLabel}</span>
                      <span className="font-semibold text-foreground">
                        ₹{Number(pmt.amount).toLocaleString("en-IN")}
                      </span>
                      {pmt.receipt_no && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          #{pmt.receipt_no}
                        </span>
                      )}
                      {pmt.gateway === "offline" && (
                        <span className="rounded bg-warning/5 px-1.5 py-0.5 text-[10px] text-warning-foreground">
                          Offline
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-muted-foreground flex-wrap">
                      {pmt.payment_mode && <span className="capitalize">{pmt.payment_mode.replace(/_/g, " ")}</span>}
                      {pmt.transaction_ref && <span>· Ref: {pmt.transaction_ref}</span>}
                      {pmt.payment_date && (
                        <span>
                          · {new Date(pmt.payment_date).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit", hour12: true,
                          })}
                        </span>
                      )}
                      {pmt.recorded_by_name && <span>· by {pmt.recorded_by_name}</span>}
                    </div>
                    {pmt.notes && <p className="text-muted-foreground mt-0.5 truncate max-w-md" title={pmt.notes}>{pmt.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {pmt.receipt_url && (
                      <a
                        href={pmt.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                        title="View receipt PDF"
                      >
                        <FileDown className="h-3 w-3" />Receipt
                      </a>
                    )}
                    {pmt.proof_url && (
                      <a
                        href={pmt.proof_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="View payment proof"
                      >
                        <ExternalLink className="h-3 w-3" />Proof
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty-state: no payments yet but superadmin can add one */}
      {lead?.id && leadPayments.length === 0 && ["super_admin", "accountant", "office_admin"].includes(role || "") && (
        <div className="rounded-xl border border-dashed border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No fee payments recorded yet.</p>
            </div>
            <button
              onClick={() => setOfflinePaymentOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />Add Offline Receipt
            </button>
          </div>
        </div>
      )}

      {/* Review summary + application-level decision */}
      {(canDecideCurrentApplication || decided) && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-medium">Document review:</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-success/5 text-success px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" />{counts.verified} verified
              </span>
              {counts.rejected > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/5 text-destructive px-2 py-0.5">
                  <XCircle className="h-3 w-3" />{counts.rejected} rejected
                </span>
              )}
              {counts.pending > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/5 text-warning-foreground px-2 py-0.5">
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
                  className="text-destructive border-destructive/20 hover:bg-destructive/5"
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
                  className={hasOffer ? "bg-info hover:bg-info/60 text-white" : "bg-teal-600 hover:bg-teal-700 text-white"}
                >
                  {repairingLead ? <ButtonOrb state="working" onFilled /> : hasOffer ? <FileText className="h-3.5 w-3.5 mr-1.5" /> : <Gift className="h-3.5 w-3.5 mr-1.5" />}
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
            <p className="text-[11px] text-destructive inline-flex items-center gap-1">
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

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Comments</h2>
          {comments.length > 0 && <span className="text-xs text-muted-foreground">({comments.length})</span>}
        </div>
        <div className="space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment on this application…"
            rows={2}
            className="text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={addComment} disabled={!newComment.trim() || savingComment}>
              {savingComment ? <ButtonOrb state="working" onFilled /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Add comment
            </Button>
          </div>
        </div>
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-2 pt-1">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-muted/20 p-2.5 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  {c.kind === "hold" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning-foreground px-2 py-0.5 text-[10px] font-medium">
                      <PauseCircle className="h-3 w-3" />On hold
                    </span>
                  )}
                  {c.kind === "release" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2 py-0.5 text-[10px] font-medium">
                      <PlayCircle className="h-3 w-3" />Hold released
                    </span>
                  )}
                  <span className="text-xs font-medium text-foreground">{c.author_name || "Staff"}</span>
                  <span className="text-[11px] text-muted-foreground">{new Date(c.created_at).toLocaleString("en-IN")}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

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
          // Curated facts win; the legacy chain stays as fallback.
          durationText: courseFacts?.duration || null,
          eligibility: courseFacts?.eligibility || eligibilityRule?.notes || lead.course.eligibility,
          entranceExam: courseFacts?.entrance_exam || eligibilityRule?.entrance_exam_name || lead.course.entrance_exam,
          entranceMandatory: eligibilityRule?.entrance_exam_required ?? lead.course.entrance_mandatory,
        } : null}
        cahetRegistration={cahetRegistration}
      />

      <ApplicationPreview app={app} docs={docs} cahetRegistration={cahetRegistration} />

      <Dialog open={programDialogOpen} onOpenChange={(open) => {
        if (!savingProgram) setProgramDialogOpen(open);
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Program</DialogTitle>
            <DialogDescription>
              Change the primary course/class on this submitted application. The linked lead will be kept in sync.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <p className="font-medium text-foreground">{currentCourseName}</p>
              {currentCampusName && <p className="text-muted-foreground">{currentCampusName}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="application-program-course">
                New program / course
              </label>
              <select
                id="application-program-course"
                value={editCourseId}
                onChange={(event) => setEditCourseId(event.target.value)}
                disabled={courseOptionsLoading || savingProgram}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{courseOptionsLoading ? "Loading programs..." : "Select program"}</option>
                {sortedCourseOptions.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.campus_name} - {course.department_name} - {course.name}
                  </option>
                ))}
              </select>
            </div>
            {app.form_pdf_url && (
              <p className="text-[11px] text-muted-foreground">
                The existing application form PDF link will be cleared so a corrected form PDF can be generated.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProgramDialogOpen(false)} disabled={savingProgram}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveProgramChange}
              disabled={savingProgram || !editCourseId || editCourseId === currentCourseOption?.id}
            >
              {savingProgram && <ButtonOrb state="working" onFilled />}
              Save Program
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          leadName={app.full_name || lead.name}
          applicationId={app.application_id || applicationId}
          courseId={lead.course_id}
          courseName={lead.course?.name}
          campusId={lead.campus_id}
          cahetRegistration={cahetRegistration}
          updeledRegistration={updeledRegistration}
          onSuccess={() => { setShowOfferLetter(false); refresh(); }}
        />
      )}

      {/* Offline payment recorder — superadmin only */}
      {lead?.id && (
        <OfflinePaymentDialog
          open={offlinePaymentOpen}
          onOpenChange={setOfflinePaymentOpen}
          leadId={lead.id}
          applicationId={app.application_id}
          onRecorded={refresh}
        />
      )}

      {/* Send a payment link (optionally with a per-head breakup) to the candidate */}
      {(lead?.id || app.lead_id) && (
        <SendPaymentLinkDialog
          open={sendLinkOpen}
          onOpenChange={setSendLinkOpen}
          leadId={lead?.id || app.lead_id}
          onCreated={refresh}
        />
      )}

      {/* Refer to partner (BPT/BMRIT only) */}
      {lead?.id && showReferPartner && (
        <ReferToPartnerDialog
          open={showReferPartner}
          onOpenChange={setShowReferPartner}
          leadIds={[lead.id]}
          onSuccess={async () => {
            const map = await fetchReferralsByLead([lead.id]);
            setReferral(map.get(lead.id) || null);
          }}
        />
      )}

      {/* External owner assignment */}
      {lead?.id && (
        <ExternalOwnerDialog
          open={showExternalOwner}
          onOpenChange={setShowExternalOwner}
          leadId={lead.id}
          leadName={lead.name}
          currentOwner={
            lead.consultant_id
              ? { type: "consultant", id: lead.consultant_id, label: `Consultant: ${(lead.lead_consultant as any)?.name || "Assigned"}` }
              : lead.academic_partner_id
                ? { type: "academic_partner", id: lead.academic_partner_id, label: `Admission Partner: ${(lead.lead_academic_partner as any)?.organization || (lead.lead_academic_partner as any)?.name || "Assigned"}` }
                : { type: "none", id: null, label: "No external owner" }
          }
          onSuccess={refresh}
        />
      )}

      {/* Put on hold / release — shared with the applications list page */}
      <HoldApplicationDialog
        target={holdTarget}
        onClose={() => setHoldTarget(null)}
        onSaved={() => { setHoldTarget(null); refresh(); }}
      />
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
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs">
          <p className="font-semibold text-warning-foreground">Couldn't render {this.props.label}.</p>
          <p className="text-warning-foreground mt-0.5">{this.state.error.message}</p>
          <p className="text-warning-foreground/80 mt-1">The rest of the page is fine. Reload to retry, or check the console for details.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

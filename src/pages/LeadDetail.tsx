import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useParams, Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsTeamLeader } from "@/hooks/useTeamLeader";
import { useOpenVisitGuard } from "@/hooks/useOpenVisitGuard";
import { useToast } from "@/hooks/use-toast";
import { Share2, ArrowLeft, Trash2, ArrowRightLeft, Phone, Calendar, CalendarDays, Clock, FileText, Bot, UserCheck, Mail, IndianRupee, MapPin, ThumbsDown, CheckCircle, Footprints, ChevronRight, Ban, Sparkles, Handshake, School, Link as LinkIcon, Wallet } from "lucide-react";
import { fetchReferralsByLead, isReferrableCourse, REFERRAL_PARTNER_LABEL, REFERRAL_STATUS_COLORS, REFERRAL_STATUS_LABELS, type LeadReferralRow } from "@/lib/leadReferral";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// Dialogs are lazy — they only need to download when the user actually opens them.
const TransferLeadDialog = lazy(() =>
  import("@/components/admissions/TransferLeadDialog").then(m => ({ default: m.TransferLeadDialog })));
const ExternalOwnerDialog = lazy(() =>
  import("@/components/admissions/ExternalOwnerDialog").then(m => ({ default: m.ExternalOwnerDialog })));
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
// Eager: small / essential-for-first-paint components
import { LeadInfoCard } from "@/components/leads/LeadInfoCard";
import { ExamPendingBadge } from "@/components/leads/ExamPendingBadge";
import { type CallDispositionData } from "@/components/admissions/CallDispositionDialog";
import { recordCallDisposition } from "@/lib/callDisposition";

// Lazy: heavy body components — header paints before these chunks arrive
const AiCallSummary         = lazy(() => import("@/components/leads/AiCallSummary").then(m => ({ default: m.AiCallSummary })));
const PriorityInterestedCard = lazy(() => import("@/components/leads/PriorityInterestedCard").then(m => ({ default: m.PriorityInterestedCard })));
const LeadTimeline          = lazy(() => import("@/components/leads/LeadTimeline").then(m => ({ default: m.LeadTimeline })));
const WebChatTranscripts    = lazy(() => import("@/components/leads/WebChatTranscripts").then(m => ({ default: m.WebChatTranscripts })));
const ApplicationProgress   = lazy(() => import("@/components/leads/ApplicationProgress").then(m => ({ default: m.ApplicationProgress })));
const LeadFeeLedger         = lazy(() => import("@/components/finance/LeadFeeLedger").then(m => ({ default: m.LeadFeeLedger })));
const FeeStructureViewer    = lazy(() => import("@/components/finance/FeeStructureViewer").then(m => ({ default: m.FeeStructureViewer })));
const ScholarshipCalculator = lazy(() => import("@/components/finance/ScholarshipCalculator").then(m => ({ default: m.ScholarshipCalculator })));
const ApplyMagicLinkButton  = lazy(() => import("@/components/leads/ApplyMagicLinkButton").then(m => ({ default: m.ApplyMagicLinkButton })));
const MirrorLeadCard        = lazy(() => import("@/components/leads/MirrorLeadCard").then(m => ({ default: m.MirrorLeadCard })));
const FuzzyDuplicateAlert   = lazy(() => import("@/components/admissions/FuzzyDuplicateAlert").then(m => ({ default: m.FuzzyDuplicateAlert })));
const ScorePopup            = lazy(() => import("@/components/admissions/ScorePopup").then(m => ({ default: m.ScorePopup })));

// Lazy: dialogs — only loaded when the user opens them
const InterviewScoringDialog       = lazy(() => import("@/components/admissions/InterviewScoringDialog").then(m => ({ default: m.InterviewScoringDialog })));
const OfferLetterDialog            = lazy(() => import("@/components/admissions/OfferLetterDialog").then(m => ({ default: m.OfferLetterDialog })));
const ReferToPartnerDialog         = lazy(() => import("@/components/admissions/ReferToPartnerDialog").then(m => ({ default: m.ReferToPartnerDialog })));
const SchoolFeeProposalDialog      = lazy(() => import("@/components/admissions/SchoolFeeProposalDialog").then(m => ({ default: m.SchoolFeeProposalDialog })));
const ConvertToStudentDialog       = lazy(() => import("@/components/admissions/ConvertToStudentDialog").then(m => ({ default: m.ConvertToStudentDialog })));
const SendWhatsAppDialog           = lazy(() => import("@/components/leads/SendWhatsAppDialog").then(m => ({ default: m.SendWhatsAppDialog })));
const AddSecondaryCounsellorDialog = lazy(() => import("@/components/leads/AddSecondaryCounsellorDialog").then(m => ({ default: m.AddSecondaryCounsellorDialog })));
const ScheduleVisitDialog          = lazy(() => import("@/components/admissions/ScheduleVisitDialog").then(m => ({ default: m.ScheduleVisitDialog })));
const ScheduleFollowupDialog       = lazy(() => import("@/components/admissions/ScheduleFollowupDialog").then(m => ({ default: m.ScheduleFollowupDialog })));
const loadCallDispositionDialog = () => import("@/components/admissions/CallDispositionDialog");
const CallDispositionDialog        = lazy(() => loadCallDispositionDialog().then(m => ({ default: m.CallDispositionDialog })));
const RecordPaymentDialog          = lazy(() => import("@/components/admissions/RecordPaymentDialog").then(m => ({ default: m.RecordPaymentDialog })));
const SendPaymentLinkDialog        = lazy(() => import("@/components/finance/SendPaymentLinkDialog").then(m => ({ default: m.SendPaymentLinkDialog })));
const OfflinePaymentDialog         = lazy(() => import("@/components/finance/OfflinePaymentDialog").then(m => ({ default: m.OfflinePaymentDialog })));
const SendEmailDialog              = lazy(() => import("@/components/leads/SendEmailDialog").then(m => ({ default: m.SendEmailDialog })));
const DirectDialGuardDialog        = lazy(() => import("@/components/admissions/DirectDialGuardDialog").then(m => ({ default: m.DirectDialGuardDialog })));
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { useCallQueue } from "@/hooks/useCallQueue";
import { useQueryClient } from "@tanstack/react-query";
import { useLeadDetail, useCampuses, useCourses, useMyProfileId } from "@/hooks/useAdmissionsData";
import { STAGE_LABELS, shouldAutoAdvance } from "@/lib/leadStages";
import { resolveLeadTransitionCommand } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";
import { completeCampusVisit } from "@/lib/visitCompletion";

// Score points for each disposition (mirrors DB trigger)
const DISPOSITION_POINTS: Record<string, { points: number; label: string }> = {
  interested: { points: 10, label: "Interested call" },
  call_back: { points: 3, label: "Call back scheduled" },
  not_answered: { points: 1, label: "Call attempted" },
  busy: { points: 1, label: "Call attempted" },
  voicemail: { points: 1, label: "Voicemail left" },
  not_interested: { points: -3, label: "Not interested" },
  do_not_contact: { points: -2, label: "Do not contact" },
  wrong_number: { points: -2, label: "Wrong number" },
  cold: { points: 0, label: "Marked cold" },
};

const FEE_PROPOSAL_NEW_BADGE_VISIBLE_UNTIL = new Date(2026, 6, 12);
const PAYMENT_LINK_NEW_BADGE_VISIBLE_UNTIL = new Date(2026, 6, 16);

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

type FollowupQueueState = {
  ids: string[];
  index: number;
  tab: string;
  returnUrl: string;
};

// sessionStorage key for the per-counsellor urgent-list guard snooze.
const dialGuardSnoozeKey = (profileId: string) => `dialGuardSnoozeUntil:${profileId}`;

const LeadDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const followupQueue = (location.state as { followupQueue?: FollowupQueueState } | null)?.followupQueue;
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, role, profile, hasPermission } = useAuth();
  useOpenVisitGuard(id);
  const isTeamLeader = useIsTeamLeader();
  const isSuperAdmin = role === "super_admin";
  const canTransfer = isSuperAdmin || isTeamLeader;
  // External owner (consultant / academic partner). Mirrors can_assign_lead_external_owner:
  // super_admin, principal, leads:assign_external_owner, or counsellor with consultants:view.
  const canAssignExternalOwner =
    isSuperAdmin
    || role === "principal"
    || hasPermission("leads:assign_external_owner")
    || (role === "counsellor" && hasPermission("consultants:view"));
  const { coursesByDepartment, getCampusesForCourse, courseOptions } = useCourseCampusLink();
  const [lead, setLead] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [campuses, setCampuses] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [showInterview, setShowInterview] = useState(false);
  const [showOfferLetter, setShowOfferLetter] = useState(false);
  const [showFeeProposal, setShowFeeProposal] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [aiCalling, setAiCalling] = useState(false);
  const [manualCalling, setManualCalling] = useState(false);
  const [showSecondaryCounsellor, setShowSecondaryCounsellor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showExternalOwner, setShowExternalOwner] = useState(false);
  const [showReferPartner, setShowReferPartner] = useState(false);
  const [referral, setReferral] = useState<LeadReferralRow | null>(null);
  const [showScheduleVisit, setShowScheduleVisit] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);
  const [showCallDisposition, setShowCallDisposition] = useState(false);
  // Live Plivo status of the in-flight manual call. Drives the dialog through
  // calling → connected / no_answer / busy / failed. `undefined` means the
  // dialog was opened outside an active call (legacy "log past call" mode).
  const [dispositionCallStatus, setDispositionCallStatus] = useState<
    "calling" | "connected" | "no_answer" | "busy" | "failed" | "counsellor_no_answer" | undefined
  >(undefined);
  // True once Plivo reports the bridge has hung up. The dialog stays on the
  // "connected" UI (disposition picker) but the elapsed timer freezes —
  // counsellor sees the final talk duration alongside the picker.
  const [dispositionCallEnded, setDispositionCallEnded] = useState(false);
  const [activeCallUuid, setActiveCallUuid] = useState<string | null>(null);
  const [dispositionWaSent, setDispositionWaSent] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showSendPaymentLink, setShowSendPaymentLink] = useState(false);
  const [showTokenOverride, setShowTokenOverride] = useState(false);
  const [showWalkinCompletion, setShowWalkinCompletion] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [paymentRefreshKey, setPaymentRefreshKey] = useState(0);
  // When the fee ledger has no activity it renders nothing; we surface the
  // "Record Offline Payment" trigger in the quick-action bar instead.
  const [feeLedgerEmpty, setFeeLedgerEmpty] = useState(false);
  const [showOfflinePayment, setShowOfflinePayment] = useState(false);
  const canRecordOffline = ["super_admin", "campus_admin", "accountant", "office_admin"].includes(role || "");
  const [deletingLead, setDeletingLead] = useState(false);
  const [showNotInterested, setShowNotInterested] = useState(false);
  const [notInterestedReason, setNotInterestedReason] = useState("");
  const [notInterestedCategory, setNotInterestedCategory] = useState<"lead" | "job_applicant" | "vendor" | "other">("lead");
  const [savingNotInterested, setSavingNotInterested] = useState(false);
  const [counsellorName, setCounsellorName] = useState<string | undefined>();
  const [courseName, setCourseName] = useState<string | undefined>();
  const [courseDuration, setCourseDuration] = useState<number | undefined>();
  const [courseType, setCourseType] = useState<string | undefined>();
  const [campusName, setCampusName] = useState<string | undefined>();
  const [campusCity, setCampusCity] = useState<string | undefined>();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [showNextLeadPrompt, setShowNextLeadPrompt] = useState(false);
  const [lastDisposition, setLastDisposition] = useState<string>("");
  // Soft direct-dial guard: pending priority counts gating non-priority calls.
  const [dialGuardCounts, setDialGuardCounts] = useState<{ paid_pending: number; overdue_pending: number } | null>(null);
  const isDialGuardSnoozed = () => {
    if (!profileId) return false;
    try {
      const until = Number(sessionStorage.getItem(dialGuardSnoozeKey(profileId)) || 0);
      return until > Date.now();
    } catch (_) { return false; }
  };
  const [scorePopup, setScorePopup] = useState<{ points: number; label: string; visible: boolean }>({ points: 0, label: "", visible: false });
  // When the lead_detail RPC returns nothing (RLS blocked because the lead is
  // assigned to someone else), we still want to tell the user *who* it is
  // assigned to. lead_assignment_info is a SECURITY DEFINER RPC that returns
  // just the assignee's display name — no contact info, no stage.
  const [assignmentInfo, setAssignmentInfo] = useState<{ exists: boolean; lead_name: string | null; counsellor_name: string | null } | null>(null);
  const { buckets, nextLead, refetch: refetchQueue } = useCallQueue(id, lead?.counsellor_id);
  const nextFollowupQueueId = followupQueue && followupQueue.index < followupQueue.ids.length - 1
    ? followupQueue.ids[followupQueue.index + 1]
    : null;

  const navigateWithinFollowupQueue = (nextIndex: number, startCall = false) => {
    if (!followupQueue) return;
    const nextId = followupQueue.ids[nextIndex];
    if (!nextId) return;
    navigate(`/admissions/${nextId}${startCall ? "?action=call" : ""}`, {
      state: { followupQueue: { ...followupQueue, index: nextIndex } },
    });
  };

  // useLeadDetail handles initial fetch + refetch on id change automatically.
  // Reset local state when navigating between leads so the old data doesn't
  // flash through before the new payload lands.
  useEffect(() => {
    setLead(null);
    setLoading(true);
    setNotes([]);
    setFollowups([]);
    setVisits([]);
    setActivities([]);
    setCallLogs([]);
    setAssignmentInfo(null);
  }, [id]);

  // ── Manual-call status poll ───────────────────────────────────────────────
  // The voice-agent already captures the "student answered" event in its
  // /bridge-b-status handler — but it writes a timestamp to
  // ai_call_records.student_connected_at, not to `status` (which stays
  // "initiated" until Plivo hangs up). So we poll both columns:
  //   - student_connected_at IS NOT NULL → flip to "connected"
  //   - terminal status (no-answer / busy / failed / cancel) → auto-dispose
  //   - completed with >5s talk → "connected"; ≤5s → "no_answer"
  // No safety timeout — the manual "Call connected" button covers the edge
  // case where bridge-b-status never fires (e.g. machine detection skipped).
  useEffect(() => {
    if (!activeCallUuid || !showCallDisposition) return;
    // Stop polling once we've moved past calling, EXCEPT when we're in
    // "connected" — that state stays until Plivo hangs up (callEnded flag).
    // Once callEnded is set, no more polls.
    if (dispositionCallEnded) return;
    if (dispositionCallStatus && dispositionCallStatus !== "calling" && dispositionCallStatus !== "connected") return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const { data } = await (supabase as any)
        .from("ai_call_records")
        .select("status, duration_seconds, student_connected_at")
        .eq("call_uuid", activeCallUuid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (!data) return;
      const s = String(data.status || "").toLowerCase();
      const dur = data.duration_seconds || 0;
      // Bridge state machine:
      //  - status=completed with talk-time OR student_connected_at set →
      //    "connected" (dialog stays on disposition picker)
      //  - status=completed AND it's the terminal hangup → also flip
      //    callEnded so the timer freezes
      //  - status=in_progress / answered / student_connected_at set without
      //    completed → "connected", timer keeps ticking
      const wasAnswered = !!data.student_connected_at
        || s === "in-progress" || s === "in_progress" || s === "answered"
        || (s === "completed" && dur > 5);
      if (s === "completed" && wasAnswered) {
        setDispositionCallStatus("connected");
        setDispositionCallEnded(true);
        return;
      }
      if (wasAnswered) {
        setDispositionCallStatus("connected");
        return;
      }
      if (s === "counsellor_no_answer") {
        // Counsellor never picked up A-leg → student never dialed. UI shows
        // a "you didn't pick up — retry?" prompt instead of a disposition picker.
        setDispositionCallStatus("counsellor_no_answer");
      } else if (s === "no_answer" || s === "no-answer" || s === "cancel") {
        setDispositionCallStatus("no_answer");
      } else if (s === "busy") {
        setDispositionCallStatus("busy");
      } else if (s === "failed") {
        setDispositionCallStatus("failed");
      } else if (s === "completed") {
        // Hangup with <5s of talk — treat as no_answer.
        setDispositionCallStatus("no_answer");
      }
      // initiated / ringing → keep "calling"; manual button is the fallback.
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeCallUuid, showCallDisposition, dispositionCallStatus, dispositionCallEnded]);

  // Reset the call-status state whenever the dialog closes so the next call
  // starts fresh.
  useEffect(() => {
    if (!showCallDisposition) {
      setDispositionCallStatus(undefined);
      setDispositionCallEnded(false);
      setActiveCallUuid(null);
    }
  }, [showCallDisposition]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadCallDispositionDialog();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // When opened from /missed-calls via "Cloud Call", the URL carries the
  // ai_call_records.id of the missed-call entry to resolve. We stash it in
  // a ref before clearing the URL so logCallDisposition can mark it done
  // once the counsellor actually submits a disposition (per the rule:
  // missed-call closes on disposition, not on call placement).
  const pendingMissedCallIdRef = useRef<string | null>(null);

  // Auto-trigger Cloud Call when navigated with ?action=call.
  // Previously this opened the disposition dialog directly, which let
  // staff log "not answered" entries without ever placing a real call.
  // Now it kicks off a real Plivo call — disposition dialog opens
  // immediately in calling mode while the Plivo bridge starts.
  useEffect(() => {
    if (searchParams.get("action") === "call" && !loading && lead && !manualCalling) {
      const mid = searchParams.get("missed_call_id");
      if (mid) pendingMissedCallIdRef.current = mid;
      triggerManualCall();
      setSearchParams({}, { replace: true });
    }
    // triggerManualCall is intentionally omitted from deps — it would
    // re-fire after every render and cause the call to repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lead, searchParams]);

  // Single lead_detail RPC replaces the 6-parallel per-lead query block.
  // Cached → navigating to a child route and back doesn't refetch (10s stale).
  const queryClient = useQueryClient();
  const { data: detailData, isFetching: detailFetching, refetch: refetchDetail } = useLeadDetail(id);
  // Reference data shared across pages — long-cached.
  const { data: campusesData } = useCampuses();
  const { data: coursesData } = useCourses();
  const { data: profileIdData } = useMyProfileId();

  // Project the cached payload into the local mutable state the rest of the
  // component still uses (note/followup/visit handlers mutate these arrays
  // optimistically before refetching).
  useEffect(() => {
    if (!detailData) {
      // Mid-fetch: keep current state, only flip loading if we have no lead yet
      setLoading(detailFetching && !lead);
      return;
    }
    const ld: any = detailData.lead;
    if (ld) {
      setLead(ld);
      setCounsellorName(ld.lead_counsellor?.display_name || undefined);
      const cs = ld.lead_course;
      setCourseName(cs?.name || undefined);
      setCourseDuration(cs?.duration_years || undefined);
      setCourseType(cs?.type || undefined);
      const cp = ld.lead_campus;
      setCampusName(cp?.name || undefined);
      setCampusCity(cp?.city ? (cp.state ? `${cp.city}, ${cp.state}` : cp.city) : undefined);
    }
    setNotes(detailData.notes);
    setFollowups(detailData.followups);
    setVisits(detailData.visits);
    setActivities(detailData.activities);
    setCallLogs(detailData.call_logs);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailData, detailFetching]);

  // If the RLS-bound fetch returned an empty lead, fall back to the
  // assignment-info RPC so we can tell the user who currently owns the lead.
  useEffect(() => {
    if (!id) return;
    if (detailFetching) return;
    if (detailData?.lead) { setAssignmentInfo(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any).rpc("lead_assignment_info", { p_lead_id: id });
      if (cancelled) return;
      setAssignmentInfo(data || { exists: false, lead_name: null, counsellor_name: null });
    })();
    return () => { cancelled = true; };
  }, [id, detailData, detailFetching]);

  // Sync reference data + profile id into legacy state for downstream dialogs
  useEffect(() => { if (campusesData) setCampuses(campusesData); }, [campusesData]);
  useEffect(() => { if (coursesData) setCourses(coursesData); }, [coursesData]);
  useEffect(() => { if (profileIdData) setProfileId(profileIdData); }, [profileIdData]);

  // Existing call sites expect a `fetchAll(silent)` callable that re-pulls
  // the per-lead data after a mutation. Provide a thin wrapper that
  // invalidates the cache and refetches.
  const fetchAll = async (_silent = false) => {
    await queryClient.invalidateQueries({ queryKey: ["lead-detail", id] });
    await refetchDetail();
  };

  // Referral to the academic partner (BPT/BMRIT only) — status badge + action gate.
  const refreshReferral = useCallback(async () => {
    if (!id) return;
    const map = await fetchReferralsByLead([id]);
    setReferral(map.get(id) || null);
  }, [id]);
  useEffect(() => { void refreshReferral(); }, [refreshReferral]);

  const addNote = async () => {
    if (!newNote.trim() || !id) return;
    setSavingNote(true);
    const { error } = await supabase.from("lead_notes").insert({ lead_id: id, user_id: user?.id, content: newNote.trim() });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "note",
        description: newNote.trim(),
      });
      setNewNote(""); await fetchAll(true);
    }
    setSavingNote(false);
  };

  const logCallDisposition = async (data: CallDispositionData) => {
    if (!id || !lead) return;

    // Core disposition pipeline (call_logs, activity, auto-stage, WhatsApp,
    // follow-up) lives in src/lib/callDisposition.ts and is shared with the
    // /missed-calls inline disposition flow. UI-specific extras (score
    // popup, next-lead prompt, schedule-visit, fetch refresh, missed-call
    // resolution) stay here.
    if (data.disposition === "interested" || data.disposition === "call_back"
        || data.disposition === "not_answered" || data.disposition === "busy"
        || data.disposition === "voicemail" || data.disposition === "not_interested") {
      setDispositionWaSent(true);
    }

    await recordCallDisposition({
      supabase,
      leadId: id,
      lead: { name: lead.name, phone: lead.phone, stage: lead.stage },
      userId: user?.id || null,
      profileId,
      courseName,
      data,
      loggedFromLabel: "lead page",
      // The lead-page "Cloud Call" button places a real Plivo call via the
      // manual-call edge function. activeCallUuid is the voice-agent call_id
      // that the auto bridge-hangup webhook + ai_call_records.recording_url
      // are keyed on — pass it so this disposition row merges with the
      // recording instead of creating an orphan with a fresh random UUID.
      callUuid: activeCallUuid,
      callSource: activeCallUuid ? "cloud_dialer" : "manual_log",
    });

    const label = ({
      interested: "Interested", not_interested: "Not Interested",
      ineligible: "Ineligible",
      not_answered: "Not Answered", wrong_number: "Wrong Number",
      call_back: "Call Back Later", do_not_contact: "Do Not Contact",
      voicemail: "Voicemail", busy: "Busy",
    } as Record<string, string>)[data.disposition] || data.disposition;

    toast({ title: "Call logged", description: label });
    // Refresh in the background — don't hold the "Saving…" spinner (and the
    // open dialog) hostage to a full lead-detail refetch. The disposition is
    // already written; React Query updates the page when the refetch lands.
    void fetchAll(true);
    refetchQueue();

    // Score animation
    const scoreInfo = DISPOSITION_POINTS[data.disposition];
    if (scoreInfo) {
      const isFirstContact = !lead.first_contact_at;
      const totalPoints = scoreInfo.points + (isFirstContact && scoreInfo.points > 0 ? 5 : 0);
      const totalLabel = isFirstContact && scoreInfo.points > 0
        ? `${scoreInfo.label} + First contact bonus`
        : scoreInfo.label;
      setScorePopup({ points: totalPoints, label: totalLabel, visible: true });
    }

    // Schedule-visit branch is lead-page-only (the inline date pair needs the
    // campus list + visit dialog state). Fallback to the dedicated dialog if
    // schedule_followup was ticked without a date.
    if (data.schedule_followup && !data.followup_date) {
      setShowFollowup(true);
    }
    if (data.visit) {
      await scheduleVisit(data.visit);
    }

    if (!data.schedule_followup) {
      setLastDisposition(label);
      setShowNextLeadPrompt(true);
    }

    // If this call was opened from /missed-calls, clear that pending callback
    // now that a disposition has been logged. Best-effort — disposition
    // already succeeded, don't surface DB hiccups.
    const missedCallId = pendingMissedCallIdRef.current;
    if (missedCallId) {
      pendingMissedCallIdRef.current = null;
      supabase
        .from("ai_call_records" as any)
        .update({ followup_done_at: new Date().toISOString(), followup_done_by: profileId })
        .eq("id", missedCallId)
        .then(({ error }) => {
          if (error) console.error("Failed to clear missed-call after disposition:", error);
        });
    }
  };

  const addFollowup = async (data: { scheduled_at: string; type: string; notes: string }) => {
    if (!data.scheduled_at || !id) return;
    const { error } = await supabase.from("lead_followups").insert({
      lead_id: id, user_id: user?.id,
      scheduled_at: data.scheduled_at, type: data.type, notes: data.notes || null,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "followup",
        description: `Follow-up scheduled (${data.type}) for ${new Date(data.scheduled_at).toLocaleDateString("en-IN")}${data.notes ? `. ${data.notes}` : ""}`,
      });
      // Auto-advance to counsellor_call when a call followup is scheduled
      if (data.type === "call") {
        await autoAdvanceStage("counsellor_call");
      }

      // Send WhatsApp to lead: "callback scheduled" notification
      // Skip if disposition already sent a WhatsApp (avoid duplicate messages)
      if (lead?.phone && data.type === "call" && !dispositionWaSent) {
        supabase.functions.invoke("whatsapp-send", {
          body: {
            template_key: "callback_scheduled",
            phone: lead.phone,
            params: [lead.name || "Student", courseName || "your selected course"],
            lead_id: id,
          },
        }).catch(e => console.error("Follow-up WA failed:", e));
      }

      setDispositionWaSent(false); // reset flag
      await fetchAll(true);
    }
  };

  const scheduleVisit = async (data: { visit_date: string; campus_id: string }) => {
    if (!data.visit_date || !id) return;
    const campusLabel = campuses.find(c => c.id === data.campus_id)?.name || "";

    // Check for existing scheduled/confirmed visit — reschedule instead of creating duplicate
    const existingVisit = visits.find((v: any) => ["scheduled", "confirmed"].includes(v.status));

    if (existingVisit) {
      // Reschedule: update existing visit + log history
      const oldDate = new Date(existingVisit.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const oldCampus = campuses.find(c => c.id === existingVisit.campus_id)?.name || "";

      const { error } = await supabase.from("campus_visits")
        .update({ visit_date: data.visit_date, campus_id: data.campus_id || existingVisit.campus_id, status: "scheduled" })
        .eq("id", existingVisit.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

      const newDateFormatted = new Date(data.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
        " " + new Date(data.visit_date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

      await supabase.from("lead_activities").insert({
        lead_id: id, user_id: profileId, type: "visit",
        description: `Campus visit rescheduled from ${oldDate}${oldCampus ? ` at ${oldCampus}` : ""} to ${newDateFormatted}${campusLabel ? ` at ${campusLabel}` : ""}`,
      });

      toast({ title: "Visit rescheduled", description: `Previous visit on ${oldDate} has been rescheduled.` });
    } else {
      // No existing visit — create new
      const { error } = await supabase.from("campus_visits").insert({
        lead_id: id, scheduled_by: user?.id,
        visit_date: data.visit_date, campus_id: data.campus_id || null,
      });
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }

    const visitDateFormatted = new Date(data.visit_date).toLocaleDateString("en-GB", {
      day: "2-digit", month: "2-digit", year: "2-digit",
    }) + " " + new Date(data.visit_date).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

    await supabase.from("lead_activities").insert({
      lead_id: id, user_id: profileId, type: "visit",
      description: `Campus visit scheduled for ${visitDateFormatted}${campusLabel ? ` at ${campusLabel}` : ""}`,
    });
    await autoAdvanceStage("visit_scheduled");

    // Send WhatsApp visit_confirmation template
    const sentChannels: string[] = [];
    if (lead?.phone) {
      const { error: waErr, data: waData } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: "visit_confirmation",
          phone: lead.phone,
          params: [lead.name || "Student", visitDateFormatted, campusLabel || "NIMT Educational Institutions"],
          lead_id: id,
          button_urls: ["1820424915210710582"], // Google Maps CID for campus location
        },
      });
      if (waErr) {
        console.error("Visit WhatsApp failed:", waErr.message);
        toast({ title: "WhatsApp failed", description: waErr.message, variant: "destructive" });
      } else {
        sentChannels.push("WhatsApp");
      }
    }

    // Send email visit confirmation
    if (lead?.email) {
      const { error: emErr } = await supabase.functions.invoke("send-email", {
        body: {
          to_email: lead.email,
          lead_id: id,
          custom_subject: `Campus Visit Confirmed — ${visitDateFormatted}${campusLabel ? ` at ${campusLabel}` : ""}`,
          custom_body: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px"><img src="https://uni.nimt.ac.in/unios-logo.png" alt="NIMT Educational Institutions" style="height:40px;margin-bottom:16px" /><h2 style="color:#1e293b;margin:0 0 8px">Campus Visit Confirmed!</h2><p style="color:#475569;line-height:1.6">Hi ${lead.name || "Student"},</p><p style="color:#475569;line-height:1.6">Your campus visit has been scheduled:</p><div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0"><p style="color:#1e293b;margin:0"><strong>Date &amp; Time:</strong> ${visitDateFormatted}</p>${campusLabel ? `<p style="color:#1e293b;margin:4px 0 0"><strong>Campus:</strong> ${campusLabel}</p>` : ""}</div><p style="color:#475569;line-height:1.6">Please carry a valid photo ID. We look forward to welcoming you!</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" /><p style="color:#94a3b8;font-size:12px;margin:0">NIMT Educational Institutions — Admissions</p></div>`,
        },
      });
      if (emErr) console.error("Visit email failed:", emErr.message);
      else sentChannels.push("Email");
    }

    toast({ title: "Visit scheduled", description: sentChannels.length ? `Confirmation sent via ${sentChannels.join(" & ")}` : undefined });
    await fetchAll(true);
  };

  const updateStage = async (newStage: string) => {
    if (!id || !lead || lead.stage === newStage) return;
    // Prevent going back to new_lead once moved past it
    if (newStage === "new_lead" && lead.stage !== "new_lead") {
      toast({ title: "Cannot revert", description: "Lead cannot be moved back to New Lead stage.", variant: "destructive" });
      return;
    }
    // Pipeline stages must be reached via their proper workflow so the activity
    // history stays honest. Each stage's auto-set path is enforced here:
    const autoOnlyHints: Record<string, string> = {
      counsellor_call: "Use 'Cloud Call' to dial the lead — disposition is captured automatically after the call connects.",
      visit_scheduled: "Use 'Schedule Visit' from the lead actions.",
      interview: "Set via the Interview Scoring workflow.",
      offer_sent: "Generate an offer letter from the documents/offer flow.",
      pre_admitted: "Use 'Convert to Student' (pre-admit option).",
      admitted: "Use 'Convert to Student' (admit option).",
      application_in_progress: "Set automatically by the Apply portal.",
      application_fee_paid: "Set automatically when an application_fee payment is recorded.",
      application_submitted: "Set automatically by the Apply portal on submission.",
    };
    if (autoOnlyHints[newStage]) {
      toast({ title: "Use the proper workflow", description: autoOnlyHints[newStage], variant: "destructive" });
      return;
    }
    // token_paid is super-admin-only and must go through the override dialog,
    // not this generic update path.
    if (newStage === "token_paid" && role !== "super_admin") {
      toast({
        title: "Record a token payment instead",
        description: "Use 'Record Payment' with type Token Fee — the stage advances automatically.",
        variant: "destructive",
      });
      return;
    }
    const transition = resolveLeadTransitionCommand({
      currentStage: lead.stage,
      command: "adminOverrideStage",
      targetStage: newStage,
    });
    try {
      await applyResolvedLeadTransition(supabase as any, {
        leadId: id,
        transition,
        reason: `Stage changed from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[newStage] || newStage}`,
      });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    await fetchAll(true);
  };

  const markAsDnc = async () => {
    if (!id || !lead || lead.stage === "dnc") return;
    const transition = resolveLeadTransitionCommand({ currentStage: lead.stage, command: "markDnc" });
    try {
      await applyResolvedLeadTransition(supabase as any, { leadId: id, transition });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    // Send DNC acknowledgment via WhatsApp if phone available
    if (lead.phone) {
      try {
        await supabase.functions.invoke("whatsapp-reply", {
          body: {
            phone: lead.phone.replace(/[^0-9]/g, ""),
            message: "You have been added to our Do Not Contact list. We will not reach out to you via call or WhatsApp going forward. If this was a mistake, please reply START or call us at +91 9555192192.",
            lead_id: id,
          },
        });
      } catch (_) {}
    }
    toast({ title: "Lead marked as DNC", description: "No further calls or WhatsApp messages will be sent." });
    await fetchAll(true);
  };

  const unmarkDnc = async () => {
    if (!id || !lead || lead.stage !== "dnc") return;
    const transition = resolveLeadTransitionCommand({ currentStage: lead.stage, command: "restoreFromDnc" });
    try {
      await applyResolvedLeadTransition(supabase as any, { leadId: id, transition });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "DNC removed", description: "Lead restored to New Lead." });
    await fetchAll(true);
  };

  /** Auto-advance stage when an action implies progression */
  const autoAdvanceStage = async (targetStage: string) => {
    if (!id || !lead) return;
    if (shouldAutoAdvance(lead.stage, targetStage)) {
      const transition = resolveLeadTransitionCommand({
        currentStage: lead.stage,
        command: "adminOverrideStage",
        targetStage,
      });
      await applyResolvedLeadTransition(supabase as any, {
        leadId: id,
        transition,
        reason: `Stage auto-advanced from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[targetStage] || targetStage}`,
      });
    }
  };

  const updateField = async (field: string, value: string | null, label: string) => {
    if (!id || !lead) return;
    const oldValue = lead[field];
    const { error } = await supabase.from("leads").update({ [field]: value } as any).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    let oldDisplay = oldValue || "Not set";
    let newDisplay = value || "Not set";
    if (field === "course_id") {
      oldDisplay = courseOptions.find(c => c.id === oldValue)?.name || "Not set";
      newDisplay = courseOptions.find(c => c.id === value)?.name || "Not set";
    } else if (field === "campus_id") {
      oldDisplay = courseOptions.find(c => c.campus_id === oldValue)?.campus_name || campuses.find(c => c.id === oldValue)?.name || "Not set";
      newDisplay = courseOptions.find(c => c.campus_id === value)?.campus_name || campuses.find(c => c.id === value)?.name || "Not set";
    }

    const activityPayload = {
      lead_id: id, user_id: profileId || null, type: "info_update" as const,
      description: `${label} changed from "${oldDisplay}" to "${newDisplay}"`,
    };
    console.log("Inserting activity:", activityPayload, "profileId:", profileId);
    const { error: actError, data: actData } = await supabase.from("lead_activities").insert(activityPayload).select();
    if (actError) {
      console.error("Activity log failed:", actError);
      toast({ title: "Warning", description: "Field updated but activity log failed: " + actError.message, variant: "destructive" });
    } else {
      console.log("Activity logged:", actData);
    }
    toast({ title: `${label} updated` });
    await fetchAll(true);
  };

  const triggerAiCall = async () => {
    setAiCalling(true);
    try {
      // Supabase edge function gateway rejects ES256 user JWTs — send anon key instead.
      // The function receives the caller's user_id in the body for audit purposes.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("voice-call", {
        body: { action: "outbound", lead_id: id, caller_user_id: currentUser?.id },
      });

      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as any).context as Response | undefined;
          if (ctx) {
            const rawText = await ctx.text().catch(() => "");
            try { detail = JSON.parse(rawText)?.error || rawText || error.message; } catch { detail = rawText || error.message; }
          }
        } catch { /* ignore */ }
        toast({ title: "AI Call Error", description: detail, variant: "destructive" });
      } else if (data?.error) {
        toast({ title: "AI Call Error", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "AI Call Started", description: data?.message || "Calling lead..." });
        fetchAll(true);
      }
    } catch (e: any) {
      toast({ title: "AI Call Error", description: e.message, variant: "destructive" });
    }
    setAiCalling(false);
  };

  // Adds the current lead to the user's cloud-dialer pin list so it shows
  // at the top of /cloud-dialer next time they load that page. RLS limits
  // inserts to user_id = auth.uid(). The trigger fn_cleanup_cloud_dialer_pin
  // auto-removes the pin once the lead is actually called.
  const [pinningToDialer, setPinningToDialer] = useState(false);
  const pinToDialer = async () => {
    if (!id || !user?.id) return;
    setPinningToDialer(true);
    const { error } = await (supabase as any)
      .from("cloud_dialer_pins")
      .insert({ user_id: user.id, lead_id: id });
    if (error && !String(error.code || "").startsWith("23505")) {
      // 23505 = duplicate key (already pinned) — treat as success
      toast({ title: "Couldn't add to dialer", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: error ? "Already in your dialer queue" : "Added to Cloud Dialer",
        description: "This lead is now pinned at the top of your dialer.",
      });
    }
    setPinningToDialer(false);
  };

  // Place the actual Plivo call. Separated from triggerManualCall so the
  // guard modal can call it after the counsellor confirms an override.
  const placeManualCall = async () => {
    if (!id) return;
    void loadCallDispositionDialog();
    setManualCalling(true);
    setActiveCallUuid(null);
    setDispositionCallEnded(false);
    setDispositionCallStatus("calling");
    setShowCallDisposition(true);
    try {
      const { data, error } = await supabase.functions.invoke("manual-call", {
        body: { lead_id: id, caller_user_id: user?.id },
      });
      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as any).context as Response | undefined;
          if (ctx) { const raw = await ctx.text().catch(() => ""); try { detail = JSON.parse(raw)?.error || raw; } catch { detail = raw || error.message; } }
        } catch {}
        toast({ title: "Call Failed", description: detail, variant: "destructive" });
        setShowCallDisposition(false);
        setActiveCallUuid(null);
        setDispositionCallStatus(undefined);
        setDispositionCallEnded(false);
      } else if (data?.error) {
        toast({ title: "Call Failed", description: data.error, variant: "destructive" });
        setShowCallDisposition(false);
        setActiveCallUuid(null);
        setDispositionCallStatus(undefined);
        setDispositionCallEnded(false);
      } else {
        toast({ title: "Calling You", description: data?.message || "Pick up your phone to connect to the student." });
        // The panel is already visible; the UUID arms polling + cancellation.
        setActiveCallUuid(data?.call_id || null);
        fetchAll(true);
      }
    } catch (e: any) {
      toast({ title: "Call Failed", description: e.message, variant: "destructive" });
      setShowCallDisposition(false);
      setActiveCallUuid(null);
      setDispositionCallStatus(undefined);
      setDispositionCallEnded(false);
    }
    setManualCalling(false);
  };

  const triggerManualCall = async () => {
    if (!id || !profileId) { await placeManualCall(); return; }
    // Urgent-list bypass: counsellor snoozed the guard for this session
    // (e.g. TL told them to work a specific list first). Skip straight to dial.
    if (isDialGuardSnoozed()) { await placeManualCall(); return; }
    // Soft guard: counsellor must clear paid (meta/google <24h) + overdue
    // (>2h) priority work before direct-dialing a non-priority lead.
    // The RPC excludes the current lead from counts and flags exempt cases
    // (priority_interested, missed callback, paid pending, overdue).
    try {
      const { data: guard, error: gErr } = await supabase.rpc(
        "counsellor_dial_guard",
        { p_counsellor_id: profileId, p_lead_id: id },
      );
      if (!gErr && guard) {
        const g = guard as { paid_pending: number; overdue_pending: number; current_lead_exempt: boolean };
        const total = (g.paid_pending || 0) + (g.overdue_pending || 0);
        if (total > 0 && !g.current_lead_exempt) {
          setDialGuardCounts({ paid_pending: g.paid_pending || 0, overdue_pending: g.overdue_pending || 0 });
          return;
        }
      }
    } catch (_) {
      // Guard failures should never block calling — fall through and dial.
    }
    await placeManualCall();
  };

  // Snooze the guard for 2 hours (per counsellor, this tab/session) so an
  // urgent list can be worked without a modal on every lead. Logs one
  // override row for the TL audit trail, then dials.
  const handleDialGuardSnooze = async () => {
    if (profileId) {
      try { sessionStorage.setItem(dialGuardSnoozeKey(profileId), String(Date.now() + 2 * 60 * 60 * 1000)); } catch (_) {}
    }
    if (id && profileId && dialGuardCounts) {
      try {
        await supabase.from("direct_dial_overrides" as any).insert({
          counsellor_id: profileId,
          lead_id: id,
          reason: "Urgent list — guard snoozed for 2h",
          paid_pending_count: dialGuardCounts.paid_pending,
          overdue_pending_count: dialGuardCounts.overdue_pending,
        });
      } catch (e) {
        console.error("Failed to log dial snooze:", e);
      }
    }
    await placeManualCall();
  };

  const handleDialGuardOverride = async (reason: string) => {
    if (!id || !profileId || !dialGuardCounts) { await placeManualCall(); return; }
    try {
      await supabase.from("direct_dial_overrides" as any).insert({
        counsellor_id: profileId,
        lead_id: id,
        reason,
        paid_pending_count: dialGuardCounts.paid_pending,
        overdue_pending_count: dialGuardCounts.overdue_pending,
      });
    } catch (e) {
      console.error("Failed to log dial override:", e);
    }
    await placeManualCall();
  };

  const handleNotInterested = async () => {
    const wordCount = notInterestedReason.trim().split(/\s+/).length;
    if (wordCount < 5) {
      toast({ title: "Reason too short", description: "Please enter at least 5 words", variant: "destructive" });
      return;
    }
    if (!id) return;
    setSavingNotInterested(true);

    // Update lead stage + category (lock to prevent auto-override)
    const transition = resolveLeadTransitionCommand({ currentStage: lead?.stage || "new_lead", command: "classifyNotInterested" });
    try {
      await applyResolvedLeadTransition(supabase as any, {
        leadId: id,
        transition,
        extraPatch: {
          person_role: notInterestedCategory,
          category_locked: true,
        },
      });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSavingNotInterested(false);
      return;
    }

    // Cancel all pending followups — prevents lead from reappearing in overdue queue
    await supabase
      .from("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() } as any)
      .eq("lead_id", id)
      .eq("status", "pending");

    // Add reason as a note
    await supabase.from("lead_notes").insert({
      lead_id: id,
      content: `[Not Interested${notInterestedCategory !== "lead" ? ` — ${notInterestedCategory.replace("_", " ")}` : ""}] ${notInterestedReason.trim()}`,
      created_by: profileId,
    } as any);

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: id,
      type: "stage_change",
      description: `Marked as Not Interested${notInterestedCategory !== "lead" ? ` (${notInterestedCategory.replace("_", " ")})` : ""}: ${notInterestedReason.trim()}`,
      performed_by: profileId,
    } as any);

    toast({ title: "Marked as Not Interested" });
    setShowNotInterested(false);
    setNotInterestedReason("");
    setSavingNotInterested(false);
    fetchAll(true);
  };

  const handleDeleteLead = async () => {
    if (!id) return;
    setDeletingLead(true);
    const { data: linkedApps, error: linkedAppsError } = await supabase
      .from("applications")
      .select("application_id, status, payment_status")
      .eq("lead_id", id)
      .limit(5);
    if (linkedAppsError) {
      toast({ title: "Delete failed", description: linkedAppsError.message, variant: "destructive" });
      setDeletingLead(false);
      setShowDeleteConfirm(false);
      return;
    }
    if ((linkedApps || []).length > 0) {
      toast({
        title: "Cannot delete lead with applications",
        description: `Delete or transfer linked application ${linkedApps![0].application_id} before deleting this lead.`,
        variant: "destructive",
      });
      setDeletingLead(false);
      setShowDeleteConfirm(false);
      return;
    }
    // A lead that has taken money is retained permanently — a DB trigger
    // (20260802075753_protect_leads_with_financial_records.sql) refuses the
    // delete. Check first so the reason is readable rather than a raw error.
    const { count: receiptCount, error: paidError } = await supabase
      .from("lead_payments")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", id)
      .or("receipt_no.not.is.null,status.eq.confirmed");
    if (paidError) {
      toast({ title: "Delete failed", description: paidError.message, variant: "destructive" });
      setDeletingLead(false);
      setShowDeleteConfirm(false);
      return;
    }
    if ((receiptCount ?? 0) > 0) {
      toast({
        title: "Cannot delete a lead with receipts",
        description: `${receiptCount} receipt(s) are on file against ${lead?.name || "this lead"}. Financial records must be retained.`,
        variant: "destructive",
      });
      setDeletingLead(false);
      setShowDeleteConfirm(false);
      return;
    }

    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      setDeletingLead(false);
      setShowDeleteConfirm(false);
    } else {
      toast({ title: "Lead deleted", description: `${lead?.name || "Lead"} has been deleted.` });
      navigate("/admissions");
    }
  };

  if (loading) return <PageLoader />;
  if (!lead) {
    // Distinguish "this lead exists but isn't assigned to you" from "no such lead".
    // assignmentInfo comes from the SECURITY DEFINER lead_assignment_info RPC.
    if (assignmentInfo?.exists && assignmentInfo.counsellor_name) {
      return (
        <div className="mx-auto max-w-xl py-16">
          <div className="rounded-2xl border border-warning/30/60 bg-warning/5 dark:bg-warning/90/20 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-warning-foreground shrink-0" />
              <h2 className="text-base font-semibold text-warning-foreground dark:text-warning/40">Lead access restricted</h2>
            </div>
            <p className="text-sm text-warning-foreground/90 dark:text-warning/30/90">
              Lead currently assigned to <span className="font-semibold">{assignmentInfo.counsellor_name}</span>.
              Please get the lead reassigned to you from admin to access this lead data.
            </p>
            <div className="pt-1">
              <Link to="/admissions" className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground dark:text-warning/70 hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Leads
              </Link>
            </div>
          </div>
        </div>
      );
    }
    if (assignmentInfo?.exists && !assignmentInfo.counsellor_name) {
      return (
        <div className="mx-auto max-w-xl py-16">
          <div className="rounded-2xl border border-warning/30/60 bg-warning/5 dark:bg-warning/90/20 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-warning-foreground shrink-0" />
              <h2 className="text-base font-semibold text-warning-foreground dark:text-warning/40">Lead access restricted</h2>
            </div>
            <p className="text-sm text-warning-foreground/90 dark:text-warning/30/90">
              This lead is currently unassigned. Please ask an admin to assign it to you to access this lead data.
            </p>
            <div className="pt-1">
              <Link to="/admissions" className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground dark:text-warning/70 hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Leads
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return <div className="text-center py-20"><p className="text-muted-foreground">Lead not found</p></div>;
  }

  // Skeleton placeholder for lazy chunks (kept lightweight so the header
  // can paint immediately while heavy children stream in)
  const lazyFallback = (
    <div className="flex h-24 items-center justify-center text-muted-foreground">
      <ButtonOrb state="working" />
    </div>
  );
  const currentExternalOwner = lead.consultant_id
    ? {
        type: "consultant" as const,
        id: lead.consultant_id as string,
        label: `Consultant: ${lead.lead_consultant?.name || "Assigned"}`,
      }
    : lead.academic_partner_id
      ? {
          type: "academic_partner" as const,
          id: lead.academic_partner_id as string,
          label: `Admission Partner: ${lead.lead_academic_partner?.organization || lead.lead_academic_partner?.name || "Assigned"}`,
        }
      : {
          type: "none" as const,
          id: null,
          label: "No external owner",
        };
  const ExternalOwnerIcon = currentExternalOwner.type === "academic_partner" ? School : Handshake;

  return (
    <Suspense fallback={lazyFallback}>
    <div className="space-y-4 animate-fade-in px-0">
      {/* DNC Banner */}
      {lead.stage === "dnc" && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25/60 bg-destructive/5 dark:bg-destructive/90/30 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Ban className="h-4 w-4 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold text-destructive dark:text-destructive/80">Do Not Contact (DNC)</p>
              <p className="text-xs text-destructive/80 dark:text-destructive">This lead has opted out. No calls or WhatsApp messages should be sent.</p>
            </div>
          </div>
          <button onClick={unmarkDnc} className="text-xs font-medium text-destructive hover:underline shrink-0">Remove DNC</button>
        </div>
      )}

      {/* Followup queue navigation bar */}
      {followupQueue && followupQueue.ids.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30/50 bg-warning/5 dark:bg-warning/90/30 px-3 py-2">
          <Link
            to={followupQueue.returnUrl}
            className="flex items-center gap-1 text-xs font-medium text-warning-foreground dark:text-warning/70 hover:text-warning-foreground dark:hover:text-warning/30 shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to follow-ups
          </Link>
          <span className="text-warning/60">/</span>
          <span className="text-xs text-warning-foreground dark:text-warning/70 flex-1">
            {followupQueue.index + 1} / {followupQueue.ids.length} in queue
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              disabled={followupQueue.index === 0}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-warning/30/40 bg-white/60 dark:bg-white/10 text-warning-foreground dark:text-warning/70 hover:bg-warning/10 dark:hover:bg-warning/80/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              onClick={() => navigateWithinFollowupQueue(followupQueue.index - 1)}
              title="Previous lead"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            </button>
            <button
              disabled={followupQueue.index >= followupQueue.ids.length - 1}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-warning/30/40 bg-white/60 dark:bg-white/10 text-warning-foreground dark:text-warning/70 hover:bg-warning/10 dark:hover:bg-warning/80/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              onClick={() => navigateWithinFollowupQueue(followupQueue.index + 1)}
              title="Next lead"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Breadcrumb + Actions */}
      <div className="flex items-center gap-2 text-sm overflow-x-auto">
        <Link to="/admissions" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0">
          <ArrowLeft className="h-3.5 w-3.5" /> Leads
        </Link>
        <span className="text-muted-foreground/50 shrink-0">/</span>
        <span className="font-medium text-foreground truncate">{lead.name}</span>
        {(lead as { shared_with_nimt?: boolean | null }).shared_with_nimt === false && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Academic-partner lead not shared with the NIMT team">
            Not shared with NIMT
          </span>
        )}
        {lead.application_id && (
          <span className="text-xs font-mono text-muted-foreground ml-1 shrink-0">{lead.application_id}</span>
        )}
        <span className="shrink-0">
          <ExamPendingBadge
            leadId={lead.id}
            leadName={lead.name}
            phone={lead.phone}
            courseName={courseName}
            campusName={campusName}
          />
        </span>
        {/* Assigned counsellor badge */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              counsellorName
                ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
                : "bg-muted text-muted-foreground"
            }`}
            title={counsellorName ? "Assigned counsellor" : "This lead is unassigned"}
          >
            <UserCheck className="h-3 w-3" />
            {counsellorName || "Unassigned"}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              currentExternalOwner.type === "consultant"
                ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
                : currentExternalOwner.type === "academic_partner"
                  ? "bg-info/10 text-info-foreground dark:bg-info/80/30 dark:text-info/80"
                  : "bg-muted text-muted-foreground"
            }`}
            title="External owner"
          >
            <ExternalOwnerIcon className="h-3 w-3" />
            {currentExternalOwner.label}
          </span>
          {canTransfer && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowTransfer(true)}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
            </Button>
          )}
          {canAssignExternalOwner && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowExternalOwner(true)}>
              <Handshake className="h-3.5 w-3.5" /> Assign Owner
            </Button>
          )}
          {referral && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${REFERRAL_STATUS_COLORS[referral.status] || "bg-muted text-muted-foreground"}`}
              title={referral.partner_notes || undefined}
            >
              <Share2 className="h-3 w-3" />
              {REFERRAL_PARTNER_LABEL} · {REFERRAL_STATUS_LABELS[referral.status] || referral.status}
            </span>
          )}
          {!referral && isReferrableCourse(courseName) && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowReferPartner(true)}>
              <Share2 className="h-3.5 w-3.5" /> Refer to {REFERRAL_PARTNER_LABEL}
            </Button>
          )}
          {lead.stage !== "dnc" && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive border-destructive/30/60 hover:bg-destructive/5 dark:hover:bg-destructive/90/20" onClick={markAsDnc}>
              <Ban className="h-3.5 w-3.5" /> Mark DNC
            </Button>
          )}
          {isSuperAdmin && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Lead Queue Navigation Bar */}
      {buckets.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 overflow-x-auto">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Queue:</span>
          {buckets.map(b => (
            <button
              key={b.key}
              onClick={() => {
                const next = b.leads.find(l => l.id !== id);
                if (next) navigate(`/admissions/${next.id}?action=call`);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors shrink-0"
              title={`${b.count} leads — click to go to next`}
            >
              <span className={`h-2 w-2 rounded-full ${b.color} shrink-0`} />
              {b.label}
              <span className="inline-flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-bold text-foreground">
                {b.count}
              </span>
            </button>
          ))}
          {nextLead && (
            <Button
              size="sm"
              className="ml-auto gap-1.5 text-xs shrink-0"
              onClick={() => navigate(`/admissions/${nextLead.id}?action=call`)}
            >
              <Phone className="h-3 w-3" />
              Call Next: {nextLead.name.split(" ")[0]}
              <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Quick action icon bar */}
      {(() => {
        const canCreateProposal = role === "super_admin" || role === "principal" || role === "counsellor" || role === "admission_head" || role === "campus_admin";
        const showFeeProposalNewBadge = new Date() < FEE_PROPOSAL_NEW_BADGE_VISIBLE_UNTIL;

        const actions = [
          // Manual "Call" action removed — it opened the disposition dialog
          // without placing a real call, enabling fake-logging (Md. Ashraf
          // pattern: 6 "not answered" entries in 8 min, zero duration). Cloud
          // Call below is the only path now; disposition dialog auto-opens
          // 3s after the Plivo call connects.
          { icon: Phone, label: "Cloud Call", color: "text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30", action: triggerManualCall, disabled: manualCalling },
          // Push this lead to the top of the calling user's /cloud-dialer.
          // Available to anyone who can place calls (RLS scopes to auth.uid()).
          {
            icon: Sparkles, label: "Add to Dialer", color: "text-fuchsia-600 bg-fuchsia-100 dark:bg-fuchsia-900/30",
            action: pinToDialer, disabled: pinningToDialer,
          },
          { icon: WhatsAppIcon, label: "WhatsApp", color: "text-success bg-success/10 dark:bg-success/80/30", action: () => setShowWhatsApp(true) },
          { icon: Clock, label: "Follow Up", color: "text-warning-foreground bg-warning/10 dark:bg-warning/80/30", action: () => setShowFollowup(true) },
          { icon: MapPin, label: "Schedule Visit", color: "text-primary bg-primary/10 dark:bg-primary/80/30", action: () => setShowScheduleVisit(true) },
          { icon: Footprints, label: "Log Walk-In", color: "text-success bg-success/10 dark:bg-success/80/30", action: () => setShowWalkinCompletion(true) },
          { icon: Mail, label: "Email", color: "text-sky-600 bg-sky-100 dark:bg-sky-900/30", action: () => setShowSendEmail(true) },
          ...(isSuperAdmin ? [{
            icon: Bot, label: "AI Call", color: "text-warning-foreground bg-warning/10 dark:bg-warning/80/30", action: triggerAiCall, disabled: aiCalling,
          }] : []),
          {
            icon: School, label: "Fee Proposal",
            color: "text-lime-700 bg-lime-100 dark:bg-lime-900/30",
            action: () => setShowFeeProposal(true),
            disabled: !canCreateProposal,
            tooltip: canCreateProposal ? undefined : "You do not have permission to create fee proposals",
            badge: showFeeProposalNewBadge ? "New" : undefined,
          },
          // Payment link — any staff with leads access (the QuickActions bar is
          // already gated by the leads:view page permission).
          {
            icon: LinkIcon, label: "Payment Link",
            color: "text-sky-600 bg-sky-100 dark:bg-sky-900/30",
            action: () => setShowSendPaymentLink(true),
            badge: new Date() < PAYMENT_LINK_NEW_BADGE_VISIBLE_UNTIL ? "New" : undefined,
            tooltip: "Send a payment link via WhatsApp/Email. Pick purpose (token/fee due/custom), set amount & expiry, then send or copy the link.",
          },
          // Only when the fee ledger is empty (renders nothing) — otherwise the
          // "Record Offline Payment" button lives inside the ledger header.
          ...(feeLedgerEmpty && canRecordOffline ? [{
            icon: Wallet, label: "Offline Payment", color: "text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30",
            action: () => setShowOfflinePayment(true),
            tooltip: "Record an offline (cash / UPI / bank) payment for this lead",
          }] : []),
          { icon: ThumbsDown, label: "Not Interested", color: "text-destructive bg-destructive/10 dark:bg-destructive/80/30", action: () => setShowNotInterested(true) },
        ];

        return (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {actions.map(({ icon: Icon, label, color, action, disabled, tooltip, badge }: any) => (
              <button
                key={label}
                onClick={action}
                disabled={disabled}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                title={tooltip || label}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
                  {disabled && (label === "AI Call" || label === "Cloud Call") ? <ButtonOrb state="working" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="flex min-h-4 items-center gap-1 text-[10px] font-medium text-muted-foreground">
                  <span>{label}</span>
                  {badge && (
                    <Badge className="h-3.5 rounded-full border-0 bg-success/10 px-1.5 text-[8px] font-semibold leading-none text-success dark:bg-success/80/40 dark:text-success/60">
                      {badge}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        );
      })()}

      {/* Call Disposition — inline panel (not a modal) so the counsellor keeps
          the lead's course / details / timeline visible while on the call.
          Renders null until a Cloud Call is placed (showCallDisposition).
          onCallNow side-effect (WhatsApp template to the counsellor's own
          phone) was removed on user request; "Call Now" still opens tel:. */}
      <Suspense fallback={showCallDisposition ? (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 dark:border-cyan-900/50 dark:bg-cyan-950/20 px-4 py-3 flex items-center gap-2 text-sm text-cyan-900 dark:text-cyan-100">
          <ButtonOrb state="working" />
          Opening call disposition...
        </div>
      ) : null}>
        <CallDispositionDialog
          inline
          open={showCallDisposition}
          onOpenChange={setShowCallDisposition}
          leadName={lead.name}
          leadPhone={lead.phone}
          leadId={lead.id}
          campuses={campuses}
          defaultCampusId={lead.campus_id || undefined}
          onSubmit={logCallDisposition}
          callStatus={dispositionCallStatus}
          callEnded={dispositionCallEnded}
          callStarting={manualCalling && !activeCallUuid && dispositionCallStatus === "calling"}
          onManualConnect={activeCallUuid ? () => setDispositionCallStatus("connected") : undefined}
          onRetryCall={async () => {
            // Counsellor missed A-leg → reset dialog state and place a fresh call.
            // The poll effect will re-arm on the new activeCallUuid.
            setShowCallDisposition(false);
            setDispositionCallStatus(undefined);
            setDispositionCallEnded(false);
            setActiveCallUuid(null);
            await placeManualCall();
          }}
          onCancelCall={activeCallUuid ? async () => {
            // Cancel the in-flight Cloud Call: hangs up both Plivo legs without
            // recording a call disposition or call metric. Failures surface as
            // a toast — the panel still closes so the counsellor isn't stuck.
            try {
              const { error } = await supabase.functions.invoke("manual-call-cancel", {
                body: { call_id: activeCallUuid, caller_user_id: user?.id },
              });
              if (error) {
                toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
              } else {
                toast({ title: "Call cancelled", description: "Both legs dropped." });
                fetchAll(true);
              }
            } catch (e: any) {
              toast({ title: "Cancel failed", description: e?.message || "Try again", variant: "destructive" });
            }
          } : undefined}
          courseName={courseName}
          leadStage={lead.stage as any}
          personRole={(lead as any).person_role || null}
          latestNote={notes[0]?.content || null}
          aiCallSummary={(lead as any).ai_notes || null}
          leadSource={lead.source || null}
          jdKeyword={(lead as any).jd_category || null}
        />
      </Suspense>

      {/* Application Progress — top of page, full width, for applicants */}
      {(lead.person_role === "applicant" || lead.application_id) && (
        <ApplicationProgress
          leadId={lead.id}
          leadPhone={lead.phone}
          applicationId={lead.application_id}
          canImpersonate={role === "super_admin" || role === "principal" || role === "campus_admin" || role === "admission_head" || role === "counsellor"}
        />
      )}

      {/* Fee Ledger — full width so the receipts table and Record Offline
          Payment header have room to breathe (was cramped in the 380px column).
          The card chrome + header now live inside LeadFeeLedger so it can drop
          them entirely when there's no fee activity (just shows the button). */}
      <LeadFeeLedger leadId={lead.id} refreshKey={paymentRefreshKey} onEmptyChange={setFeeLedgerEmpty} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* Left Column */}
        <div className="space-y-4">
          <LeadInfoCard
            lead={lead}
            counsellorName={counsellorName}
            courseName={courseName}
            campusName={campusName}
            campusCity={campusCity}
            coursesByDepartment={coursesByDepartment}
            getCampusesForCourse={getCampusesForCourse}
            onStageChange={updateStage}
            onFieldUpdate={updateField}
            userRole={role ?? null}
            onTokenPaidOverride={() => setShowTokenOverride(true)}
          />
          <Suspense fallback={null}>
            <FuzzyDuplicateAlert leadId={lead.id} leadName={lead.name} leadPhone={lead.phone} leadEmail={lead.email} />
          </Suspense>
          {lead.mirror_lead_id && (
            <Suspense fallback={null}>
              <MirrorLeadCard mirrorLeadId={lead.mirror_lead_id} />
            </Suspense>
          )}
          <Card className="border-border/60">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Apply Portal Access</h3>
                <p className="text-[11px] text-muted-foreground mt-1">Send a one-click login link via WhatsApp.</p>
              </div>
              <ApplyMagicLinkButton leadId={lead.id} leadName={lead.name} leadPhone={lead.phone} />
            </CardContent>
          </Card>
          {lead.course_id && (
            <Card className="border-border/60">
              <CardContent className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Fee Structure</h3>
                <FeeStructureViewer courseId={lead.course_id} compact newAdmissionOnly />
              </CardContent>
            </Card>
          )}
          {lead.course_id && (
            <ScholarshipCalculator
              leadId={lead.id}
              courseId={lead.course_id}
              initialQualifyingPercent={(lead as any).qualifying_percent ?? null}
              initialEntranceScores={(lead as any).entrance_scores ?? null}
              onSaved={() => fetchAll(true)}
            />
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Priority Interested reason — shown when stage is priority_interested */}
          {(lead as any).stage === "priority_interested" && (
            <PriorityInterestedCard leadId={lead.id} />
          )}

          {/* What's Next — upcoming followups + visits (TOP priority) */}
          {(() => {
            const pendingFollowups = followups.filter((f: any) => f.status === "pending").sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
            const upcomingVisits = visits.filter((v: any) => ["scheduled", "confirmed"].includes(v.status)).sort((a: any, b: any) => new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime());
            if (pendingFollowups.length === 0 && upcomingVisits.length === 0) return null;

            return (
              <div className="rounded-xl border border-info/20 dark:border-info/50/40 bg-info/5/50 dark:bg-info/90/20 p-4 space-y-2.5">
                <h3 className="text-xs font-semibold text-info-foreground dark:text-info/60 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> What's Next
                </h3>

                {pendingFollowups.map((f: any) => {
                  const dt = new Date(f.scheduled_at);
                  const isOverdue = dt < new Date();
                  const isToday = dt.toDateString() === new Date().toDateString();
                  // Distinguish AI-callback (Navya retries) from human-callback
                  // (counsellor calls) so operators see at a glance who's
                  // expected to make the call.
                  const followupLabel =
                    f.type === "ai_callback"     ? "AI Callback (Navya)" :
                    f.type === "human_callback"  ? "Counsellor Callback" :
                    f.type === "callback"        ? "Counsellor Callback" :       // legacy
                    f.type === "call"            ? "Follow-up Call" :
                    f.type === "visit"           ? "Follow-up Visit" :
                                                   `Follow-up (${f.type})`;
                  const isHumanCallback = f.type === "human_callback" || f.type === "callback";
                  const isAiCallback = f.type === "ai_callback";
                  return (
                    <div key={f.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isOverdue ? "bg-destructive/5 dark:bg-destructive/90/20 border border-destructive/20 dark:border-destructive/50/40" : "bg-white dark:bg-card border border-border/50"}`}>
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${
                        isOverdue ? "bg-destructive/50" :
                        isHumanCallback ? "bg-primary/50" :
                        isAiCallback ? "bg-primary/50" :
                        isToday ? "bg-warning/50" : "bg-info/50"
                      } text-white`}>
                        <Phone className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{followupLabel}</p>
                        <p className={`text-[10px] ${isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          {isOverdue ? "⚠️ Overdue — " : isToday ? "Today — " : ""}
                          {dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                          {" at "}
                          {dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                          {f.notes && ` · ${f.notes}`}
                        </p>
                      </div>
                      {f.status === "pending" && (
                        <button
                          onClick={triggerManualCall}
                          disabled={manualCalling}
                          className="rounded-lg bg-cyan-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-cyan-700 disabled:opacity-50 shrink-0 flex items-center gap-1"
                          title="Place a Cloud Call to this lead"
                        ><Phone className="h-2.5 w-2.5" /> Cloud Call</button>
                      )}
                    </div>
                  );
                })}

                {upcomingVisits.slice(0, 2).map((v: any) => {
                  const dt = new Date(v.visit_date);
                  const isToday = dt.toDateString() === new Date().toDateString();
                  const campusName = campuses.find((c: any) => c.id === v.campus_id)?.name || "Campus";
                  return (
                    <div key={v.id} className="flex items-center gap-3 rounded-lg bg-white dark:bg-card border border-border/50 px-3 py-2 text-sm">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${isToday ? "bg-primary/50" : "bg-primary/40"} text-white`}>
                        <MapPin className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">Campus Visit</p>
                        <p className="text-[10px] text-muted-foreground">
                          {isToday ? "Today — " : ""}
                          {dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} at {dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })} · {campusName}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Scheduled Visits with completion dialog */}
          <ScheduledVisitsSection
            visits={visits}
            campuses={campuses}
            courses={courses}
            coursesByDepartment={coursesByDepartment}
            leadId={id!}
            userId={user?.id || null}
            onRefresh={() => fetchAll(true)}
            showWalkin={showWalkinCompletion}
            onCloseWalkin={() => setShowWalkinCompletion(false)}
          />

          {/* Previous Call Notes */}
          {callLogs.length > 0 && (
            <Card className="border-border/60 shadow-none">
              <CardContent className="p-4">
                <p className="text-[10px] font-semibold text-warning-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />Previous Call Notes ({callLogs.length})
                </p>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {callLogs.map((c: any) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs border-l-2 border-warning/20 pl-2.5 py-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`text-[9px] border-0 shrink-0 ${
                            c.disposition === "interested" ? "bg-success/10 text-success" :
                            c.disposition === "not_interested" ? "bg-destructive/10 text-destructive" :
                            c.disposition === "not_answered" ? "bg-warning/10 text-warning-foreground" :
                            c.disposition === "busy" ? "bg-warning/10 text-warning-foreground" :
                            c.disposition === "cancelled" ? "bg-gray-100 text-gray-600" :
                            "bg-gray-100 text-gray-600"
                          }`}>{c.disposition?.replace(/_/g, " ") || "—"}</Badge>
                          <span className="text-muted-foreground text-[10px]">
                            {new Date(c.called_at || c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                            {" "}
                            {new Date(c.called_at || c.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {c.duration_seconds > 0 && (
                            <span className="text-muted-foreground text-[10px]">({Math.floor(c.duration_seconds / 60)}m{c.duration_seconds % 60}s)</span>
                          )}
                          <Badge className="text-[9px] border-0 bg-gray-50 text-gray-500">{c.direction || "outbound"}</Badge>
                        </div>
                        {c.notes && <p className="text-muted-foreground mt-0.5 leading-snug">{c.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Call Summary */}
          <AiCallSummary leadId={id!} />

          {/* Website Chat Transcripts */}
          <WebChatTranscripts leadId={id!} />

          <LeadTimeline
            activities={activities}
            notes={notes}
            followups={followups}
            visits={visits}
            callLogs={callLogs}
            leadPhone={lead.phone}
            newNote={newNote}
            setNewNote={setNewNote}
            onAddNote={addNote}
            savingNote={savingNote}
            onAddFollowup={addFollowup}
            onScheduleVisit={scheduleVisit}
            onUpdateVisitStatus={async (vid, status, newDate) => {
              const updates: Record<string, any> = { status };
              if (newDate) updates.visit_date = newDate;
              await supabase.from("campus_visits").update(updates).eq("id", vid);
              await supabase.from("lead_activities").insert({
                lead_id: id!, user_id: user?.id || null, type: "visit",
                description: newDate
                  ? `Campus visit rescheduled to ${new Date(newDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : `Campus visit status updated to ${status}`,
              });
              await fetchAll(true);
            }}
            campuses={campuses}
            leadId={lead.id}
            courseId={lead.course_id}
          />
        </div>
      </div>

      {/* Dialogs */}
      <InterviewScoringDialog open={showInterview} onOpenChange={setShowInterview}
        leadId={lead.id} leadName={lead.name} currentScore={lead.interview_score} currentResult={lead.interview_result} onSuccess={() => fetchAll(true)} />
      {showReferPartner && (
        <Suspense fallback={null}>
          <ReferToPartnerDialog
            open={showReferPartner}
            onOpenChange={setShowReferPartner}
            leadIds={[lead.id]}
            onSuccess={() => { void refreshReferral(); void fetchAll(true); }}
          />
        </Suspense>
      )}

      <OfferLetterDialog open={showOfferLetter} onOpenChange={setShowOfferLetter}
        leadId={lead.id} leadName={lead.name} courseId={lead.course_id} courseName={courseName} campusId={lead.campus_id} onSuccess={() => fetchAll(true)} />
      <SchoolFeeProposalDialog
        open={showFeeProposal}
        onOpenChange={setShowFeeProposal}
        lead={{ id: lead.id, name: lead.name, phone: lead.phone }}
      />
      <ConvertToStudentDialog open={showConvert} onOpenChange={setShowConvert} lead={lead} courseName={courseName} campusName={campusName} onSuccess={() => fetchAll(true)} />
      <SendWhatsAppDialog
        open={showWhatsApp}
        onOpenChange={setShowWhatsApp}
        lead={{ id: lead.id, name: lead.name, phone: lead.phone, application_id: lead.application_id, source: lead.source }}
        courseName={courseName}
        campusName={campusName}
        courseDuration={courseDuration}
        courseType={courseType}
        courseId={lead.course_id || undefined}
        onSuccess={() => fetchAll(true)}
      />
      <AddSecondaryCounsellorDialog
        open={showSecondaryCounsellor}
        onOpenChange={setShowSecondaryCounsellor}
        leadId={lead.id}
        leadName={lead.name}
        onSuccess={() => fetchAll(true)}
      />

      {/* Send Email Dialog */}
      <SendEmailDialog
        open={showSendEmail}
        onOpenChange={setShowSendEmail}
        lead={{ id: lead.id, name: lead.name, email: lead.email }}
        onSuccess={() => fetchAll(true)}
      />

      {/* Record Payment Dialog */}
      <RecordPaymentDialog
        open={showRecordPayment}
        onOpenChange={setShowRecordPayment}
        leadId={lead.id}
        leadName={lead.name}
        onSuccess={() => { fetchAll(true); setPaymentRefreshKey(k => k + 1); }}
      />

      {/* Offline payment — surfaced from the quick-action bar when the fee
          ledger is empty (super_admin / campus_admin / accountant only). */}
      {canRecordOffline && (
        <OfflinePaymentDialog
          open={showOfflinePayment}
          onOpenChange={setShowOfflinePayment}
          leadId={lead.id}
          onRecorded={() => { fetchAll(true); setPaymentRefreshKey(k => k + 1); }}
        />
      )}

      {/* Send Payment Link — custom-amount pre-application token or dues */}
      <SendPaymentLinkDialog
        open={showSendPaymentLink}
        onOpenChange={setShowSendPaymentLink}
        leadId={lead.id}
        defaultPurpose="pre_admission_token"
        onCreated={() => { fetchAll(true); setPaymentRefreshKey(k => k + 1); }}
      />

      {/* Super-admin manual override: Token Paid — requires transaction details + screenshot */}
      <RecordPaymentDialog
        open={showTokenOverride}
        onOpenChange={setShowTokenOverride}
        leadId={lead.id}
        leadName={lead.name}
        onSuccess={() => { fetchAll(true); setPaymentRefreshKey(k => k + 1); }}
        defaultType="token_fee"
        requireScreenshot
        title="Manual Override — Token Paid"
      />

      {/* Schedule Visit Dialog */}
      <ScheduleVisitDialog
        open={showScheduleVisit}
        onOpenChange={setShowScheduleVisit}
        campuses={campuses}
        defaultCampusId={lead.campus_id || undefined}
        onSchedule={scheduleVisit}
      />

      {/* Schedule Follow-up Dialog */}
      <ScheduleFollowupDialog
        open={showFollowup}
        onOpenChange={setShowFollowup}
        onSchedule={addFollowup}
      />

      {/* Call Disposition panel is rendered inline near the top of the page
          (after the quick-action bar) so the counsellor keeps the lead's
          course / details / timeline visible during the call. See
          <CallDispositionDialog inline ... /> above. */}

      {/* Soft direct-dial guard — surfaces when counsellor tries to call a
          non-priority lead while paid/overdue work is pending. */}
      {dialGuardCounts && (
        <Suspense fallback={null}>
          <DirectDialGuardDialog
            open={!!dialGuardCounts}
            counts={dialGuardCounts}
            leadName={lead.name}
            onOpenChange={(o) => { if (!o) setDialGuardCounts(null); }}
            onCallAnyway={handleDialGuardOverride}
            onSnooze={handleDialGuardSnooze}
          />
        </Suspense>
      )}

      {/* Score animation popup */}
      <Suspense fallback={null}>
        <ScorePopup
          points={scorePopup.points}
          label={scorePopup.label}
          visible={scorePopup.visible}
          onDone={() => setScorePopup(p => ({ ...p, visible: false }))}
        />
      </Suspense>

      {/* Next Lead Prompt — after call disposition */}
      {showNextLeadPrompt && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-lg animate-fade-in">
          <div className="rounded-xl border border-primary/20 bg-card shadow-lg px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 dark:bg-success/80/30 shrink-0">
                <CheckCircle className="h-5 w-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Call logged: {lastDisposition}</p>
                {nextFollowupQueueId ? (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Next pending follow-up in this tab
                  </p>
                ) : nextLead ? (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Next: <span className="font-medium text-foreground">{nextLead.name}</span> — {nextLead.bucketName}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">No more leads in queue</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {nextFollowupQueueId ? (
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      setShowNextLeadPrompt(false);
                      navigateWithinFollowupQueue(followupQueue!.index + 1, true);
                    }}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Call Next
                  </Button>
                ) : nextLead && (
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      setShowNextLeadPrompt(false);
                      navigate(`/admissions/${nextLead.id}?action=call`);
                    }}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Call Next
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowNextLeadPrompt(false)}
                >
                  Stay
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Dialog */}
      <TransferLeadDialog
        open={showTransfer}
        onOpenChange={setShowTransfer}
        leadIds={id ? [id] : []}
        leadNames={[lead.name]}
        onSuccess={() => fetchAll(true)}
      />
      <ExternalOwnerDialog
        open={showExternalOwner}
        onOpenChange={setShowExternalOwner}
        leadId={lead.id}
        leadName={lead.name}
        currentOwner={currentExternalOwner}
        onSuccess={() => fetchAll(true)}
      />

      {/* Not Interested Dialog */}
      <AlertDialog open={showNotInterested} onOpenChange={(o) => { if (!savingNotInterested) { setShowNotInterested(o); if (!o) { setNotInterestedReason(""); setNotInterestedCategory("lead"); } } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ThumbsDown className="h-5 w-5 text-destructive" /> Mark as Not Interested
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will move <strong>{lead.name}</strong> to <strong>Not Interested</strong>. Please provide a reason (minimum 5 words).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { value: "lead", label: "Admission Enquiry", color: "bg-info/10 text-info-foreground border-info/30" },
                  { value: "job_applicant", label: "Job Applicant", color: "bg-primary/10 text-primary border-primary/25" },
                  { value: "vendor", label: "Vendor", color: "bg-warning/10 text-warning-foreground border-warning/30" },
                  { value: "other", label: "Other", color: "bg-gray-100 text-gray-600 border-gray-300" },
                ] as const).map(cat => (
                  <button key={cat.value} type="button"
                    onClick={() => setNotInterestedCategory(cat.value)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      notInterestedCategory === cat.value ? `ring-2 ring-primary ${cat.color}` : `${cat.color} opacity-60 hover:opacity-100`
                    }`}>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <textarea
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[90px] resize-none"
                placeholder="e.g. Parent decided to go with another school due to distance"
                value={notInterestedReason}
                onChange={e => setNotInterestedReason(e.target.value)}
              />
              <p className={`text-[11px] mt-1 ${notInterestedReason.trim().split(/\s+/).filter(Boolean).length >= 5 ? "text-muted-foreground" : "text-destructive"}`}>
                {notInterestedReason.trim().split(/\s+/).filter(Boolean).length}/5 words minimum
              </p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingNotInterested}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleNotInterested}
              disabled={savingNotInterested || notInterestedReason.trim().split(/\s+/).filter(Boolean).length < 5}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {savingNotInterested && <ButtonOrb state="working" />}
              Mark Not Interested
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{lead.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this lead and associated non-application data. Leads with linked applications cannot be deleted until the application is deleted or transferred, because admission steps depend on the lead record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLead}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLead} disabled={deletingLead} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingLead && <ButtonOrb state="working" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </Suspense>
  );
};

// ── Scheduled Visits Section with Completion Dialog ──────────────────
function ScheduledVisitsSection({ visits, campuses, courses, coursesByDepartment, leadId, userId, onRefresh, showWalkin, onCloseWalkin }: {
  visits: any[]; campuses: any[]; courses: any[];
  coursesByDepartment: { department: string; courses: { id: string; name: string; code: string; institution_type: string }[] }[];
  leadId: string; userId: string | null; onRefresh: () => void;
  showWalkin?: boolean; onCloseWalkin?: () => void;
}) {
  const { toast } = useToast();
  const [completingVisitId, setCompletingVisitId] = useState<string | null>(null);
  const [isWalkin, setIsWalkin] = useState(false);
  const [walkinCampusId, setWalkinCampusId] = useState(campuses[0]?.id || "");
  const [feedback, setFeedback] = useState("");
  const [courseInterest, setCourseInterest] = useState("");
  const [courseInterestId, setCourseInterestId] = useState("");
  const [schoolAdmissionType, setSchoolAdmissionType] = useState("");
  const [expectedAdmissionDate, setExpectedAdmissionDate] = useState("");
  const [followupDate, setFollowupDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Detect if selected course is a school course
  const selectedCourseIsSchool = coursesByDepartment
    .flatMap(g => g.courses)
    .find(c => c.id === courseInterestId)?.institution_type === "school";
  const [rescheduleDialog, setRescheduleDialog] = useState<{ visitId: string; currentDate: string } | null>(null);
  const [rescheduleNewDate, setRescheduleNewDate] = useState("");
  const [noShowDialog, setNoShowDialog] = useState<{ visitId: string; campusId: string | null } | null>(null);
  const [noShowAction, setNoShowAction] = useState<"followup" | "reschedule">("followup");
  const [noShowDate, setNoShowDate] = useState("");

  // Open walk-in dialog when triggered from parent
  useEffect(() => {
    if (showWalkin) {
      setIsWalkin(true);
      setCompletingVisitId("walkin");
      setFeedback(""); setCourseInterest(""); setCourseInterestId(""); setSchoolAdmissionType(""); setExpectedAdmissionDate(""); setFollowupDate("");
      setWalkinCampusId(campuses[0]?.id || "");
    }
  }, [showWalkin]);

  const scheduled = visits.filter((v: any) => ["scheduled", "confirmed"].includes(v.status));

  const completingVisit = completingVisitId && completingVisitId !== "walkin"
    ? visits.find((v: any) => v.id === completingVisitId)
    : null;

  // Max followup date: 3 days from visit date
  // Max followup: 3 days from visit date (or today for walk-ins)
  const visitDateForMax = completingVisit ? new Date(completingVisit.visit_date) : new Date();
  const maxFollowupDate = new Date(visitDateForMax.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const handleComplete = async () => {
    if (!completingVisitId || !followupDate) {
      toast({ title: "Follow-up required", description: "Schedule a follow-up within 3 days of the visit.", variant: "destructive" });
      return;
    }
    setSaving(true);

    // Get counsellor name and campus name for activity log
    const { data: myProfile } = await supabase.from("profiles").select("display_name").eq("user_id", userId).single();
    const counsellorLabel = myProfile?.display_name || "Counsellor";
    const walkinCampus = campuses.find((c: any) => c.id === walkinCampusId);
    const visitCampus = completingVisit ? campuses.find((c: any) => c.id === completingVisit.campus_id) : walkinCampus;
    const campusLabel = visitCampus?.name || "Campus";

    // Shared with the Cloud Dialer's inline "Log walk-in" action so the two
    // surfaces can't write different rows for the same event.
    await completeCampusVisit({
      leadId,
      userId,
      visitId: isWalkin ? null : completingVisitId,
      campusId: walkinCampusId,
      campusLabel,
      counsellorLabel,
      feedback,
      courseInterest,
      schoolAdmissionType,
      expectedAdmissionDate,
      followupDate,
    });

    toast({ title: isWalkin ? "Walk-in visit recorded" : "Visit completed", description: "Follow-up scheduled." });
    setSaving(false);
    setCompletingVisitId(null);
    setIsWalkin(false);
    setFeedback(""); setCourseInterest(""); setCourseInterestId(""); setSchoolAdmissionType(""); setExpectedAdmissionDate(""); setFollowupDate("");
    if (onCloseWalkin) onCloseWalkin();
    onRefresh();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <>
      <div className="rounded-xl border border-primary/20 dark:border-primary/50/40 bg-primary/5/50 dark:bg-primary/90/20 p-4 space-y-3">
        <h3 className="text-xs font-semibold text-primary dark:text-primary/50 uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> Scheduled Visits
        </h3>
        {scheduled.map((v: any) => {
          const visitDate = new Date(v.visit_date);
          const campusName = campuses.find((c: any) => c.id === v.campus_id)?.name || "Campus";
          return (
            <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-card border border-border/50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {visitDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} at {visitDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                </p>
                <p className="text-xs text-muted-foreground">{campusName}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => { setRescheduleDialog({ visitId: v.id, currentDate: v.visit_date }); setRescheduleNewDate(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16)); }}
                  className="rounded-lg border border-input bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                >Reschedule</button>
                <button
                  onClick={() => { setCompletingVisitId(v.id); setFollowupDate(""); setFeedback(""); setCourseInterest(""); setExpectedAdmissionDate(""); }}
                  className="rounded-lg bg-success px-2.5 py-1 text-xs font-medium text-white hover:bg-success/90"
                >Mark Complete</button>
                <button
                  onClick={() => { setNoShowDialog({ visitId: v.id, campusId: v.campus_id }); setNoShowAction("followup"); setNoShowDate(""); }}
                  className="rounded-lg border border-warning/20 px-2.5 py-1 text-xs font-medium text-warning-foreground hover:bg-warning/5"
                >No Show</button>
                <button
                  onClick={async () => {
                    await supabase.from("campus_visits").update({ status: "cancelled" }).eq("id", v.id);
                    await supabase.from("lead_activities").insert({ lead_id: leadId, user_id: userId, type: "visit", description: "Campus visit cancelled" });
                    toast({ title: "Visit cancelled" }); onRefresh();
                  }}
                  className="rounded-lg border border-destructive/20 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/5"
                >Cancel</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Visit Completion Dialog */}
      <Dialog open={!!completingVisitId} onOpenChange={(o) => { if (!o) { setCompletingVisitId(null); setIsWalkin(false); setCourseInterestId(""); setSchoolAdmissionType(""); if (onCloseWalkin) onCloseWalkin(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isWalkin ? <Footprints className="h-4 w-4 text-success" /> : <CheckCircle className="h-4 w-4 text-success" />}
              {isWalkin ? "Log Walk-in Visit" : "Complete Visit"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Campus selector for walk-ins */}
            {isWalkin && campuses.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus *</label>
                <select value={walkinCampusId} onChange={(e) => setWalkinCampusId(e.target.value)} className={inputCls}>
                  {campuses.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Candidate Feedback *</label>
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2}
                placeholder="How was the visit? What was the candidate's impression?"
                className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course Interested In</label>
              <select
                value={courseInterestId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCourseInterestId(id);
                  const found = coursesByDepartment.flatMap(g => g.courses).find(c => c.id === id);
                  setCourseInterest(found?.name || "");
                  setSchoolAdmissionType("");
                }}
                className={inputCls}
              >
                <option value="">Select course</option>
                {coursesByDepartment.map((group) => (
                  <optgroup key={group.department} label={group.department}>
                    {group.courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {selectedCourseIsSchool && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Admission Type</label>
                <select value={schoolAdmissionType} onChange={(e) => setSchoolAdmissionType(e.target.value)} className={inputCls}>
                  <option value="">Select type</option>
                  <option value="Day School">Day School</option>
                  <option value="Day Boarding">Day Boarding</option>
                  <option value="Boarding">Boarding</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Expected Date of Admission</label>
              <div
                className={`${inputCls} relative flex items-center justify-between cursor-pointer`}
                onClick={() => (document.getElementById("expected-admission-date") as HTMLInputElement)?.showPicker?.()}
              >
                <span className={expectedAdmissionDate ? "text-foreground" : "text-muted-foreground"}>
                  {expectedAdmissionDate
                    ? (() => { const [y,m,d] = expectedAdmissionDate.split("-"); return `${d}/${m}/${y.slice(2)}`; })()
                    : "dd/mm/yy"}
                </span>
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <input id="expected-admission-date" type="date" value={expectedAdmissionDate}
                  onChange={(e) => setExpectedAdmissionDate(e.target.value)}
                  min={todayStr} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" tabIndex={-1} />
              </div>
            </div>

            <div className="rounded-xl border border-success/20 dark:border-success/60/40 bg-success/5/50 dark:bg-success/90/20 p-3 space-y-3">
              <p className="text-xs font-semibold text-success dark:text-success/60 uppercase tracking-wide">
                Mandatory Follow-up (within 3 days)
              </p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">Follow-up call date *</label>
                  <div
                    className={`${inputCls} relative flex items-center justify-between cursor-pointer`}
                    onClick={() => (document.getElementById("followup-date-picker") as HTMLInputElement)?.showPicker?.()}
                  >
                    <span className={followupDate ? "text-foreground" : "text-muted-foreground"}>
                      {followupDate
                        ? (() => { const [y,m,d] = followupDate.split("-"); return `${d}/${m}/${y.slice(2)}`; })()
                        : "dd/mm/yy"}
                    </span>
                    <input id="followup-date-picker" type="date" value={followupDate}
                      onChange={(e) => setFollowupDate(e.target.value)}
                      min={todayStr} max={maxFollowupDate}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" tabIndex={-1} />
                  </div>
                </div>
              </div>
              {maxFollowupDate && (
                <p className="text-[10px] text-success">Follow-up must be by {new Date(maxFollowupDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletingVisitId(null)}>Cancel</Button>
            <Button onClick={handleComplete} disabled={!followupDate || saving} className="gap-2 bg-success hover:bg-success/90">
              {saving ? <ButtonOrb state="working" onFilled /> : <CheckCircle className="h-4 w-4" />}
              {isWalkin ? "Save Walk-in & Schedule Follow-up" : "Complete & Schedule Follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Visit Dialog */}
      <Dialog open={!!rescheduleDialog} onOpenChange={o => { if (!o) setRescheduleDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule Visit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Pick a new date and time for the campus visit.</p>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">New Visit Date & Time <span className="text-destructive">*</span></label>
              <input type="datetime-local" value={rescheduleNewDate} onChange={e => setRescheduleNewDate(e.target.value)}
                className={inputCls} />
            </div>
            <Button className="w-full" disabled={saving || !rescheduleNewDate} onClick={async () => {
              if (!rescheduleDialog || !rescheduleNewDate) return;
              setSaving(true);
              const newDate = new Date(rescheduleNewDate);
              await supabase.from("campus_visits").update({ visit_date: newDate.toISOString(), status: "scheduled" }).eq("id", rescheduleDialog.visitId);
              await supabase.from("lead_activities").insert({
                lead_id: leadId, user_id: userId, type: "visit",
                description: `Visit rescheduled to ${newDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
              });
              toast({ title: "Visit rescheduled" });
              setSaving(false); setRescheduleDialog(null); onRefresh();
            }}>
              {saving ? <ButtonOrb state="working" onFilled /> : <Calendar className="h-4 w-4 mr-2" />}
              Reschedule Visit
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* No Show Dialog */}
      <Dialog open={!!noShowDialog} onOpenChange={o => { if (!o) setNoShowDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>No-Show</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Student didn't show up. Choose next action:</p>
            <div className="flex gap-2">
              <button onClick={() => setNoShowAction("followup")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  noShowAction === "followup" ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"
                }`}>Schedule Follow-up Call</button>
              <button onClick={() => setNoShowAction("reschedule")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  noShowAction === "reschedule" ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground hover:bg-muted"
                }`}>Reschedule Visit</button>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {noShowAction === "followup" ? "Follow-up Call Date" : "New Visit Date"} <span className="text-destructive">*</span>
              </label>
              <input type="datetime-local" value={noShowDate} onChange={e => setNoShowDate(e.target.value)} className={inputCls} />
            </div>
            <Button variant="destructive" className="w-full" disabled={saving || !noShowDate} onClick={async () => {
              if (!noShowDialog || !noShowDate) return;
              setSaving(true);
              await supabase.from("campus_visits").update({ status: "no_show" } as any).eq("id", noShowDialog.visitId);
              await supabase.from("lead_activities").insert({
                lead_id: leadId, user_id: userId, type: "visit", description: "Campus visit: student did not show up",
              });
              if (noShowAction === "reschedule") {
                await supabase.from("campus_visits").insert({
                  lead_id: leadId, campus_id: noShowDialog.campusId,
                  visit_date: new Date(noShowDate).toISOString(), status: "scheduled",
                  scheduled_by: userId,
                } as any);
                const transition = resolveLeadTransitionCommand({ currentStage: "visit_scheduled", command: "rescheduleVisit" });
                await applyResolvedLeadTransition(supabase as any, { leadId, transition });
                toast({ title: "No-show recorded", description: `Visit rescheduled for ${new Date(noShowDate).toLocaleDateString("en-IN")}` });
              } else {
                await supabase.from("lead_followups").insert({
                  lead_id: leadId, scheduled_at: new Date(noShowDate).toISOString(),
                  type: "call", notes: "No-show follow-up — call to reschedule or close", status: "pending",
                } as any);
                toast({ title: "No-show recorded", description: `Follow-up call scheduled for ${new Date(noShowDate).toLocaleDateString("en-IN")}` });
              }
              setSaving(false); setNoShowDialog(null); onRefresh();
            }}>
              {saving ? <ButtonOrb state="working" onFilled /> : null}
              {noShowAction === "followup" ? "Mark No-Show & Schedule Call" : "Mark No-Show & Reschedule Visit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LeadDetail;

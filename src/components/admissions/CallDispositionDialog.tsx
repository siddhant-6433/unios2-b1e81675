import { useState, useRef, useEffect, type ReactNode, type ReactElement } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Phone, CheckCircle, XCircle, PhoneMissed, PhoneOff, Clock3,
  BanIcon, Loader2, ArrowRight, MapPin, CalendarDays, ChevronDown, Clock,
  AlertCircle, MessageSquare, GraduationCap, Globe, FileText, X, FileQuestion,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SOURCE_LABELS, SOURCE_BADGE_COLORS } from "@/config/leadSources";
import { isBscNursingCourse } from "@/lib/bscNursing";
import { isBptOrBmritCourseName } from "@/lib/cahet";
import { useToast } from "@/hooks/use-toast";

export type CallDisposition =
  | "interested"
  | "not_interested"
  | "ineligible"
  | "not_answered"
  | "wrong_number"
  | "call_back"
  | "do_not_contact"
  | "voicemail"
  | "busy"
  | "course_not_listed";

export interface CallDispositionData {
  disposition: CallDisposition;
  duration_seconds: number;
  notes: string;
  schedule_followup: boolean;
  followup_date?: string;
  visit?: { visit_date: string; campus_id: string };
  /** Set when disposition is "ineligible" — lead eligible for future session */
  future_eligible_session?: "2027-28" | "2028-29" | null;
  /** Suppress the disposition-based auto WhatsApp send (counsellor opted out) */
  suppress_auto_whatsapp?: boolean;
  /** Also fire course_info_v4 after the disposition WA template */
  send_course_info?: boolean;
  /** B.Sc Nursing-only qualifier captured when the lead/course requires CNET context */
  cnet_appeared?: boolean | null;
  /** BPT/BMRIT-only qualifier captured when the lead/course requires CAHET context */
  cahet_registered?: boolean | null;
  /** Free-text course name captured when disposition is "course_not_listed" —
   *  compiled later to see which unlisted courses prospective leads are asking for. */
  requested_course_text?: string | null;
}

/**
 * Live call status passed in by the caller (e.g. LeadDetail polling
 * ai_call_records via Plivo callbacks).
 *  - "calling": ringing the counsellor or the student; dialog shows a "waiting
 *    for pickup" state and hides the disposition picker.
 *  - "connected": call answered and bridged; full picker is shown.
 *  - "no_answer" | "busy" | "failed": Plivo reported a terminal non-answer
 *    state; we auto-select the matching disposition and skip straight to the
 *    follow-up editor so the counsellor only needs to confirm the next
 *    callback time.
 *  - undefined: legacy "manual log" mode used when the counsellor opens the
 *    dialog from outside an active call. Shows the full picker as before.
 */
export type DialogCallStatus =
  | "calling"
  | "connected"
  | "no_answer"
  | "busy"
  | "failed"
  /** Counsellor's A-leg phone rang out / busy / failed before they picked up.
   *  Student was never dialed — dialog shows a "you didn't pick up — retry?"
   *  prompt with a one-tap Redial button. No disposition picker, no metrics. */
  | "counsellor_no_answer";

interface CallDispositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  leadPhone: string;
  campuses: { id: string; name: string }[];
  defaultCampusId?: string;
  onSubmit: (data: CallDispositionData) => Promise<void>;
  /** Called when counsellor clicks "Call Now" — e.g. to send tap-to-call WhatsApp */
  onCallNow?: () => void | Promise<void>;
  /** Optional live status from the dialer poll. Drives the auto-flow. */
  callStatus?: DialogCallStatus;
  /** True once Plivo has reported the bridge as ended (CallStatus=completed).
   *  Keeps the dialog in "connected" UI state but freezes the elapsed timer. */
  callEnded?: boolean;
  /** True while the caller has requested a Cloud Call but the backend has not
   *  returned the call UUID yet. The calling panel is visible, but live-call
   *  controls stay locked until cancellation/polling can target a real call. */
  callStarting?: boolean;
  /** Called when counsellor clicks "Call connected" — flips parent state */
  onManualConnect?: () => void;
  /** Called when counsellor clicks "Cancel" during the calling phase. Should
   *  hang up both Plivo legs without recording a call disposition. Awaited so
   *  the dialog stays open (with a busy state) until the hangup RPC returns. */
  onCancelCall?: () => Promise<void> | void;
  /** Called when counsellor clicks "Redial" after they missed their own A-leg
   *  (callStatus="counsellor_no_answer"). Should close this dialog and place
   *  a fresh manual-call. */
  onRetryCall?: () => Promise<void> | void;
  /** Lead context surfaced in the calling state so the counsellor knows who
   *  they're calling and why without leaving the dialog. */
  courseName?: string | null;
  leadStage?: string | null;
  personRole?: string | null;
  latestNote?: string | null;
  aiCallSummary?: string | null;
  /** Lead source (e.g. "justdial", "meta_ads") — shown as a badge so the
   *  counsellor knows which channel produced this lead before picking up. */
  leadSource?: string | null;
  /** JustDial search keyword that produced the lead. Only rendered when
   *  leadSource === "justdial" — for every other source it's irrelevant. */
  jdKeyword?: string | null;
  /** Render as an inline panel that flows within the page (used on the lead
   *  page so candidate details stay visible during the call) instead of a
   *  modal overlay that covers the rest of the page. Returns null when not
   *  open, so it can be slotted directly into the layout. */
  inline?: boolean;
}

// requiresConnected: option only makes sense when the counsellor actually
//   spoke with the lead. We hide these once callStatus="connected" is false
//   (call wasn't answered, e.g. ringing-only / busy / no-answer auto-disposal).
// onlyWhenNotConnected: opposite — only shown when the call didn't connect.
//   Hidden once the bridge has established because "Not Answered" is
//   nonsensical when the counsellor just got off a 3-minute call.
// help: short description shown as a hover tooltip on each pill so the
//   counsellor doesn't confuse e.g. "Do Not Contact" (adds lead to DNC list,
//   never call again) with "Not Answered" (couldn't reach this time).
const DISPOSITIONS: {
  value: CallDisposition;
  label: string;
  icon: LucideIcon;
  color: string;
  suggestsFollowup: boolean;
  help: string;
  onlyWhenNotConnected?: boolean;
  requiresConnected?: boolean;
}[] = [
  { value: "interested", label: "Interested", icon: CheckCircle, color: "bg-success/10 text-success border-success/30 hover:bg-success/5 dark:bg-success/80/30 dark:text-success", suggestsFollowup: true,
    help: "Lead engaged on the call and is interested in the programme. Triggers personalised follow-up WhatsApp + course info.",
    requiresConnected: true },
  { value: "not_interested", label: "Not Interested", icon: XCircle, color: "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/5 dark:bg-destructive/80/30 dark:text-destructive/80", suggestsFollowup: false,
    help: "Lead spoke with you and explicitly declined. Sends a polite closure WhatsApp with your contact for future revival.",
    requiresConnected: true },
  { value: "ineligible", label: "Ineligible", icon: AlertCircle, color: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/5 dark:bg-primary/80/30 dark:text-primary/60", suggestsFollowup: false,
    help: "Lead doesn't meet course eligibility (marks, subjects, age). Optionally deferred to a future session.",
    requiresConnected: true },
  { value: "not_answered", label: "Not Answered", icon: PhoneMissed, color: "bg-warning/10 text-warning-foreground border-warning/30 hover:bg-warning/5 dark:bg-warning/80/30 dark:text-warning", suggestsFollowup: true,
    help: "Phone rang but lead didn't pick up. Sends an apology + course-info WhatsApp.",
    onlyWhenNotConnected: true },
  { value: "call_back", label: "Call Back Later", icon: Clock3, color: "bg-info/10 text-info-foreground border-info/30 hover:bg-info/5 dark:bg-info/80/30 dark:text-info/80", suggestsFollowup: true,
    help: "Lead spoke but asked to be called back at a specific time. Schedules the follow-up + sends a WhatsApp confirming the time.",
    requiresConnected: true },
  { value: "voicemail", label: "Voicemail", icon: PhoneOff, color: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/5 dark:bg-primary/80/30 dark:text-primary/60", suggestsFollowup: true,
    help: "Call landed on voicemail / answering machine. Sends an apology WhatsApp with a tap-to-call link.",
    onlyWhenNotConnected: true },
  { value: "busy", label: "Busy", icon: Phone, color: "bg-warning/10 text-warning-foreground border-warning/25 hover:bg-warning/5 dark:bg-warning/80/30 dark:text-warning", suggestsFollowup: true,
    help: "Lead's line was busy. Will retry; an apology WhatsApp also goes out.",
    onlyWhenNotConnected: true },
  { value: "wrong_number", label: "Wrong Number", icon: BanIcon, color: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300", suggestsFollowup: false,
    help: "Number reached someone other than the lead, or is invalid. No further calls; flag for admin to clean the data." },
  { value: "course_not_listed", label: "Course Not Listed", icon: FileQuestion, color: "bg-teal-100 text-teal-700 border-teal-300 hover:bg-teal-50 dark:bg-teal-900/30 dark:text-teal-400", suggestsFollowup: false,
    help: "Lead wants a course NIMT doesn't currently offer. No follow-up — just capture the course they asked for so we can track unmet demand.",
    requiresConnected: true },
  { value: "do_not_contact", label: "Do Not Contact", icon: BanIcon, color: "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/5 dark:bg-destructive/80/30 dark:text-destructive/80", suggestsFollowup: false,
    help: "Lead requested to be removed from all outreach. Adds them to the DNC list — NO future calls or WhatsApp messages. Use only when the lead explicitly asks to be removed." },
];

const DURATION_OPTIONS = [
  { value: 0, label: "—" },
  { value: 30, label: "< 1m" },
  { value: 120, label: "1-3m" },
  { value: 300, label: "3-5m" },
  { value: 600, label: "5-10m" },
  { value: 900, label: "10m+" },
];

const VISIT_TIME_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const dateInputValue = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayStr = () => dateInputValue(new Date());
const tomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateInputValue(d);
};
const nextNoAnswerFollowupSlot = () => {
  const target = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const targetMinutes = target.getHours() * 60 + target.getMinutes();
  const businessStart = 9 * 60;
  const businessEnd = 18 * 60;
  const slot = VISIT_TIME_SLOTS.find((s) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m >= Math.max(targetMinutes, businessStart);
  });

  if (targetMinutes >= businessStart && targetMinutes <= businessEnd && slot) {
    return { date: dateInputValue(target), time: slot };
  }
  if (targetMinutes < businessStart) {
    return { date: dateInputValue(target), time: "09:00" };
  }

  const tomorrow = new Date(target);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: dateInputValue(tomorrow), time: "09:00" };
};
const slotLabel = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
};
const formatDisplayDate = (dateStr: string) => {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const day = dateObj.toLocaleDateString("en-IN", { weekday: "short" });
  return `${day}, ${d}/${m}/${y.slice(2)}`;
};

export function CallDispositionDialog({
  open, onOpenChange, leadName, leadPhone, campuses, defaultCampusId,
  onSubmit, onCallNow, callStatus, callEnded, onManualConnect, onCancelCall,
  callStarting = false, onRetryCall,
  courseName, leadStage, personRole, latestNote, aiCallSummary,
  leadSource, jdKeyword, inline = false,
}: CallDispositionDialogProps) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const [disposition, setDisposition] = useState<CallDisposition | null>(null);
  const [duration, setDuration] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Active while the cancel handler is hanging up the live Plivo call. Used
  // to lock the calling-phase buttons + show a spinner so a double-click
  // doesn't fire two hangup requests.
  const [cancelling, setCancelling] = useState(false);
  // Follow-up / Visit scheduling state
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [followupDate, setFollowupDate] = useState(tomorrowStr());
  const [followupTime, setFollowupTime] = useState("10:00");
  const [visitDate, setVisitDate] = useState(tomorrowStr());
  const [visitTime, setVisitTime] = useState("11:00");
  const [visitCampusId, setVisitCampusId] = useState(defaultCampusId || campuses[0]?.id || "");
  // Ineligible → future eligibility state
  const [futureSession, setFutureSession] = useState<"2027-28" | "2028-29" | null>(null);
  // WhatsApp nudge controls — visible when a disposition is set. Counsellor can
  // opt out of the auto-send or also fire course_info_v4 alongside.
  const [suppressAutoWa, setSuppressAutoWa] = useState(false);
  const [sendCourseInfo, setSendCourseInfo] = useState(false);
  const [cnetAppeared, setCnetAppeared] = useState<"yes" | "no" | null>(null);
  const [cahetRegistered, setCahetRegistered] = useState<"yes" | "no" | null>(null);
  const [requestedCourseText, setRequestedCourseText] = useState("");
  // Live elapsed timer for the connected phase. Starts when the parent flips
  // callStatus → "connected" and stops when the dialog closes. Pure UI; the
  // real call duration is whatever Plivo reports at hangup. Declared up here
  // (with the other hooks) so the hook order stays stable across the early
  // return for the "calling" phase below.
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (callStatus === "connected" && !connectedAt) {
      setConnectedAt(Date.now());
      setElapsedSec(0);
    }
    if (!open) {
      setConnectedAt(null);
      setElapsedSec(0);
    }
  }, [callStatus, open, connectedAt]);
  useEffect(() => {
    if (!connectedAt) return;
    // Stop ticking once the parent reports the bridge has ended. We still
    // keep the last elapsedSec showing — gives the counsellor a final talk
    // duration alongside the disposition picker.
    if (callEnded) return;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - connectedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [connectedAt, callEnded]);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const selectedDisp = DISPOSITIONS.find(d => d.value === disposition);
  const asksCnetAppeared = isBscNursingCourse(courseName || null);
  const asksCahetRegistered = isBptOrBmritCourseName(courseName);

  // Plivo-driven auto-disposition: when the caller signals busy / no_answer /
  // failed via callStatus, pre-select the matching disposition pill so the
  // counsellor only has to confirm the follow-up time. We never overwrite a
  // disposition the counsellor has already chosen manually.
  useEffect(() => {
    if (!open) return;
    if (disposition) return;
    if (callStatus === "no_answer") setDisposition("not_answered");
    else if (callStatus === "busy") setDisposition("busy");
    else if (callStatus === "failed") setDisposition("not_answered");
  }, [callStatus, open, disposition]);

  useEffect(() => {
    if (disposition !== "not_answered") return;
    const next = nextNoAnswerFollowupSlot();
    setShowVisitForm(false);
    setFollowupDate(next.date);
    setFollowupTime(next.time);
  }, [disposition]);

  // Default-on the course-info follow-up for positive dispositions so the
  // counsellor doesn't have to remember to tick it after every connected
  // call. Stays off for non-engagement dispositions (busy / not_interested /
  // ineligible / wrong_number / dnc) where pushing course info would be spammy.
  useEffect(() => {
    if (!disposition) return;
    if (disposition === "interested" || disposition === "call_back") {
      setSendCourseInfo(true);
    } else {
      setSendCourseInfo(false);
    }
  }, [disposition]);

  const resetState = () => {
    setDisposition(null);
    setDuration(0);
    setNotes("");
    setShowVisitForm(false);
    setFollowupDate(tomorrowStr());
    setFollowupTime("10:00");
    setVisitDate(tomorrowStr());
    setVisitTime("11:00");
    setFutureSession(null);
    setSuppressAutoWa(false);
    setSendCourseInfo(false);
    setCnetAppeared(null);
    setCahetRegistered(null);
    setRequestedCourseText("");
  };

  const handleSubmit = async (opts: { scheduleFollowup?: boolean; scheduleVisit?: boolean } = {}) => {
    if (!disposition) return;
    if (asksCnetAppeared && !cnetAppeared) return;
    if (asksCahetRegistered && !cahetRegistered) return;
    if (disposition === "course_not_listed" && !requestedCourseText.trim()) return;
    setSaving(true);
    try {
      const visit = opts.scheduleVisit && visitDate && visitTime
        ? { visit_date: new Date(`${visitDate}T${visitTime}:00`).toISOString(), campus_id: visitCampusId }
        : undefined;
      const followupDatetime = opts.scheduleFollowup && followupDate && followupTime
        ? new Date(`${followupDate}T${followupTime}:00`).toISOString()
        : undefined;
      await onSubmit({
        disposition,
        duration_seconds: duration,
        notes,
        schedule_followup: opts.scheduleFollowup ?? false,
        followup_date: followupDatetime,
        visit,
        future_eligible_session: disposition === "ineligible" ? futureSession : null,
        suppress_auto_whatsapp: suppressAutoWa,
        send_course_info: sendCourseInfo,
        cnet_appeared: asksCnetAppeared ? cnetAppeared === "yes" : null,
        cahet_registered: asksCahetRegistered ? cahetRegistered === "yes" : null,
        requested_course_text: disposition === "course_not_listed" ? requestedCourseText.trim() : null,
      });
      resetState();
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Please try again.";
      console.error("Call disposition save failed:", e);
      toast({
        title: "Couldn't save follow-up",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!saving && !v) resetState();
    onOpenChange(v);
  };

  // Block accidental dismissal of the disposition screen. Counsellors were
  // closing it by clicking outside the modal while a Cloud Call was in flight
  // and the call ended up missing from the lead timeline (no manual
  // disposition, no activity row, no WhatsApp follow-up — the auto
  // bridge-hangup webhook wrote a call_logs row eventually but it looked
  // "not counted"). The X button at top-right and the explicit Cancel
  // buttons remain the only ways out.
  const blockOutsideDismiss = {
    onPointerDownOutside: (e: Event) => e.preventDefault(),
    onInteractOutside: (e: Event) => e.preventDefault(),
    onEscapeKeyDown: (e: KeyboardEvent) => e.preventDefault(),
  };

  const openDatePicker = () => {
    dateInputRef.current?.showPicker?.();
    dateInputRef.current?.focus();
  };

  // Shell wrapper shared by every phase. In modal mode (default) it renders the
  // shadcn Dialog with the click-outside guard. In inline mode it renders a
  // bounded card that flows within the page so the counsellor keeps the lead's
  // course / details / timeline visible during the call (the modal used to
  // cover them entirely). This is a plain function — NOT a nested component —
  // so React reconciles the returned tree in place and the notes textarea
  // doesn't lose focus on re-render.
  const renderShell = (
    header: ReactNode,
    body: ReactNode,
    contentClassName?: string,
  ): ReactElement | null => {
    if (inline) {
      if (!open) return null;
      return (
        <div className="rounded-2xl border-2 border-primary/30 bg-card shadow-sm overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">{header}</div>
            <button
              onClick={() => handleClose(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 py-3 lg:px-4">{body}</div>
        </div>
      );
    }
    // On phones, slide up from the bottom (thumb-reachable) instead of a
    // centered modal the counsellor has to stretch to. Same dismiss guard so a
    // stray tap outside doesn't drop a call mid-disposition.
    if (isMobile) {
      return (
        <Sheet open={open} onOpenChange={handleClose}>
          <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl" {...blockOutsideDismiss}>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2">{header}</SheetTitle>
            </SheetHeader>
            <div className="mt-2">{body}</div>
          </SheetContent>
        </Sheet>
      );
    }
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className={contentClassName} {...blockOutsideDismiss}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{header}</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  };

  // ── Phase 1: still ringing — show waiting state + context, hide picker ───
  // Plivo's manual-call flow only writes ai_call_records.status on hangup, so
  // we cannot detect "answered" from the DB during the talk. The counsellor
  // therefore gets a "Call connected" button to manually advance to the
  // picker the moment the lead picks up. The surrounding context (course,
  // stage, latest note, AI summary) helps the counsellor remember who and
  // why during the few seconds of ringing.
  if (callStatus === "calling") {
    return renderShell(
      <>
        <Phone className="h-4 w-4 text-primary" />
        Calling {leadName}…
      </>,
      <div className="space-y-3 pt-1">
            {/* Lead summary: name + phone + stage / role badges */}
            <div className="rounded-xl bg-muted/40 px-3 py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground truncate">{leadName}</p>
                <div className="flex items-center gap-1.5">
                  {personRole && personRole !== "lead" && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                      {personRole.replace(/_/g, " ")}
                    </span>
                  )}
                  {leadStage && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-info/10 text-info-foreground dark:bg-info/90 dark:text-info/60">
                      {leadStage.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">{leadPhone}</p>
              {courseName && (
                <p className="text-xs text-foreground flex items-center gap-1.5 pt-0.5">
                  <span className="text-muted-foreground">Course:</span>
                  <span className="font-medium">{courseName}</span>
                </p>
              )}
              {leadSource && (
                <p className="text-xs text-foreground flex items-center gap-1.5 pt-0.5 flex-wrap">
                  <Globe className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Source:</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SOURCE_BADGE_COLORS[leadSource] || "bg-muted text-muted-foreground"}`}>
                    {SOURCE_LABELS[leadSource] || leadSource.replace(/_/g, " ")}
                  </span>
                  {leadSource === "justdial" && jdKeyword && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning-foreground dark:bg-warning/80/40 dark:text-warning/40">
                      <FileText className="h-2.5 w-2.5" />
                      {jdKeyword}
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* AI call summary if available — primary "why am I calling this lead" context */}
            {aiCallSummary && (
              <div className="rounded-xl border border-primary/20 dark:border-primary/50/40 bg-primary/5/50 dark:bg-primary/90/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary dark:text-primary/50 mb-1">AI call summary</p>
                <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-5">{aiCallSummary}</p>
              </div>
            )}

            {/* Latest counsellor note */}
            {latestNote && (
              <div className="rounded-xl border border-warning/20 dark:border-warning/60/40 bg-warning/5/40 dark:bg-warning/90/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-warning-foreground dark:text-warning/70 mb-1">Latest note</p>
                <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-3">{latestNote}</p>
              </div>
            )}

            {/* Waiting spinner */}
            <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
              <p className="text-sm font-medium text-foreground">
                {callStarting ? "Starting Cloud Call..." : `Waiting for ${leadName} to pick up...`}
              </p>
              <p className="text-[11px] text-muted-foreground max-w-xs">
                {callStarting
                  ? "We are connecting to Plivo. Controls will unlock as soon as the call is ready."
                  : <>Tap <span className="font-semibold">Call connected</span> the moment they answer,
                    or wait - the screen will auto-fill if their phone is busy / switched off / unanswered.</>}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 bg-success hover:bg-success/90 text-xs"
                onClick={() => onManualConnect?.()}
                disabled={callStarting || cancelling || !onManualConnect}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Call connected — Mark Outcome
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  // No cancel handler wired (e.g. legacy "manual log" mode) →
                  // fall back to just closing the dialog without any hangup
                  // attempt. Active Cloud Calls always supply onCancelCall.
                  if (!onCancelCall) {
                    handleClose(false);
                    return;
                  }
                  setCancelling(true);
                  try {
                    await onCancelCall();
                  } finally {
                    setCancelling(false);
                    handleClose(false);
                  }
                }}
                disabled={callStarting || cancelling}
                className="text-xs"
              >
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Cancel"}
              </Button>
            </div>
          </div>,
      "max-w-md max-h-[90vh] overflow-y-auto"
    );
  }

  // ── Phase 1b: counsellor never picked up their own A-leg ─────────────────
  // Plivo rang the counsellor's phone but they didn't answer. Student was
  // never dialed → no disposition picker, no follow-up, no metrics impact.
  // Just a "Redial" / "Close" choice.
  if (callStatus === "counsellor_no_answer") {
    return renderShell(
      <>
        <PhoneMissed className="h-4 w-4 text-warning-foreground" />
        You didn't pick up
      </>,
      <div className="space-y-3 pt-1">
            <div className="rounded-xl border border-warning/20 dark:border-warning/60/40 bg-warning/5 dark:bg-warning/90/30 px-3 py-3">
              <p className="text-sm text-warning-foreground dark:text-warning/40">
                Your phone rang but the call wasn't answered, so
                <span className="font-semibold"> {leadName}</span> was never dialed.
              </p>
              <p className="text-[11px] text-warning-foreground dark:text-warning mt-1.5">
                This attempt won't count in your call metrics. Hit Redial to try again.
              </p>
            </div>
            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Calling</p>
              <p className="text-sm font-semibold text-foreground truncate">{leadName}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{leadPhone}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-xs"
                disabled={retrying || !onRetryCall}
                onClick={async () => {
                  if (!onRetryCall) { handleClose(false); return; }
                  setRetrying(true);
                  try { await onRetryCall(); }
                  finally { setRetrying(false); }
                }}
              >
                {retrying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Phone className="h-3.5 w-3.5 mr-1.5" />}
                Redial
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={retrying}
                onClick={() => handleClose(false)}
              >
                Close
              </Button>
            </div>
          </div>,
      "max-w-md"
    );
  }

  const isAutoDisposed =
    callStatus === "no_answer" || callStatus === "busy" || callStatus === "failed";
  const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const autoBannerText: Record<string, string> = {
    no_answer: "Lead didn't pick up — auto-set to Not Answered.",
    busy: "Lead's line was busy — auto-set to Busy.",
    failed: "Call failed (switched off / unreachable) — auto-set to Not Answered.",
  };

  return renderShell(
    <>
      <Phone className="h-4 w-4 text-primary" />
      {isAutoDisposed ? "Schedule next callback" : "Log Call Outcome"}
    </>,
    <div className="space-y-3 pt-1">
          {/* Connected banner with elapsed timer. Live (pulsing green) while
              the bridge is up; switches to a muted "Call ended" state with
              frozen final duration once Plivo reports the hangup. */}
          {callStatus === "connected" && (
            <div className={`rounded-xl border px-3 py-2 flex items-center gap-2.5 ${
              callEnded
                ? "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
                : "border-success/30 dark:border-success/60/40 bg-success/5 dark:bg-success/90/30"
            }`}>
              <span className="relative flex h-2.5 w-2.5">
                {!callEnded && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-success/50 opacity-75 animate-ping" />
                )}
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${callEnded ? "bg-slate-400" : "bg-success/50"}`} />
              </span>
              <div className="flex-1">
                <p className={`text-xs font-semibold ${callEnded ? "text-slate-700 dark:text-slate-200" : "text-success-foreground dark:text-success/40"}`}>
                  {callEnded ? "Call ended" : "Call connected"}
                </p>
                <p className={`text-[10px] ${callEnded ? "text-slate-600 dark:text-slate-400" : "text-success dark:text-success/60"}`}>
                  {callEnded
                    ? `Talked with ${leadName} for ${fmtElapsed(elapsedSec)}. Mark the outcome below.`
                    : `Live with ${leadName}. Mark the outcome below — the dialog stays open through the call.`}
                </p>
              </div>
              <div className={`font-mono text-sm font-semibold tabular-nums ${
                callEnded ? "text-slate-700 dark:text-slate-200" : "text-success-foreground dark:text-success/40"
              }`}>
                {fmtElapsed(elapsedSec)}
              </div>
            </div>
          )}

          {/* Auto-disposed banner */}
          {isAutoDisposed && (
            <div className="rounded-xl border border-warning/20 dark:border-warning/60/40 bg-warning/5 dark:bg-warning/90/30 px-3 py-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-warning-foreground dark:text-warning mt-0.5 shrink-0" />
              <div className="text-xs text-warning-foreground dark:text-warning/40">
                {autoBannerText[callStatus!] || "Call did not connect."}
                <div className="text-[10px] mt-0.5 opacity-80">Edit the follow-up time below and save.</div>
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)] lg:items-start">
            <div className="space-y-3">
          {/* Lead info + Call Now button — Call Now hidden when call already in flight */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{leadName}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{leadPhone}</p>
            </div>
            {!callStatus && (
              <Button
                size="sm"
                className="shrink-0 gap-1.5 bg-info hover:bg-info/60 text-white"
                onClick={async () => {
                  if (leadPhone) window.open(`tel:${leadPhone}`);
                  if (onCallNow) await onCallNow();
                }}
              >
                <Phone className="h-3.5 w-3.5" /> Call Now
              </Button>
            )}
          </div>

          {/* Disposition pills — hidden when Plivo already auto-disposed */}
          {!isAutoDisposed && (
            <>
          {/* Disposition pills — filtered by call state so connected calls
              don't show "Not Answered" / "Busy" / "Voicemail", and pre-call
              auto-disposed cases don't show options that require an actual
              conversation (interested / not_interested / ineligible /
              call_back). Native title attribute renders as the hover tooltip
              so counsellors see what each option actually does. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Outcome * <span className="text-[10px] font-normal opacity-70">— hover for details</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {DISPOSITIONS.filter(d => {
                if (callStatus === "connected" && d.onlyWhenNotConnected) return false;
                if (isAutoDisposed && d.requiresConnected) return false;
                return true;
              }).map(d => {
                const Icon = d.icon;
                const selected = disposition === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    title={d.help}
                    onClick={() => setDisposition(d.value)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 min-h-[48px] text-sm sm:min-h-0 sm:text-xs font-medium transition-all ${
                      selected
                        ? `${d.color} ring-2 ring-offset-1 ring-current`
                        : "border-border hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5 shrink-0" />
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Inline reminder of what the selected disposition does — helps
                counsellors notice the difference between e.g. DNC and Not
                Answered without needing to hover. */}
            {disposition && (() => {
              const meta = DISPOSITIONS.find(d => d.value === disposition);
              if (!meta) return null;
              return (
                <p className="text-[10px] text-muted-foreground mt-1 px-1">
                  <span className="font-medium text-foreground">{meta.label}:</span> {meta.help}
                </p>
              );
            })()}
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Duration</label>
            <div className="flex gap-1">
              {DURATION_OPTIONS.map(d => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDuration(d.value)}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors border ${
                    duration === d.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Conversation summary, concerns, next steps..."
              rows={2}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* Future eligibility — only for "Ineligible" */}
          {disposition === "ineligible" && (
            <div className="rounded-xl border border-primary/20 dark:border-primary/50/40 bg-primary/5/50 dark:bg-primary/90/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-primary dark:text-primary/60" />
                <span className="text-xs font-semibold text-primary dark:text-primary/40">Eligible for future session?</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["2027-28", "2028-29"] as const).map((session) => (
                  <button
                    key={session}
                    type="button"
                    onClick={() => setFutureSession(futureSession === session ? null : session)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      futureSession === session
                        ? "bg-primary text-white border-primary/40"
                        : "bg-background border-border text-foreground hover:bg-primary/5 dark:hover:bg-primary/90/40"
                    }`}
                  >
                    {session}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFutureSession(null)}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    futureSession === null
                      ? "bg-slate-600 text-white border-slate-600"
                      : "bg-background border-border text-foreground hover:bg-muted"
                  }`}
                >
                  None
                </button>
              </div>
              {futureSession && (
                <p className="text-[10px] text-primary dark:text-primary/50">
                  Lead will be marked ineligible for current session but re-contacted for {futureSession} admissions.
                </p>
              )}
            </div>
          )}
            </>
          )}
          {/* end !isAutoDisposed gate — picker, duration, notes, ineligible */}
            </div>

            <div className="space-y-3">
          {/* WhatsApp follow-up nudge — visible the moment a disposition is set
              (manual or auto). Shows the template that will auto-send and lets
              the counsellor opt out, plus offers a one-tap course-info send. */}
          {disposition && (() => {
            const autoTemplate =
              disposition === "interested" || disposition === "call_back"
                ? "nimt_followup_v2"
                : disposition === "not_answered" || disposition === "busy" || disposition === "voicemail"
                ? "missed_call"
                : disposition === "not_interested"
                ? "nimt_not_interested_ack"
                : null;
            // No template = no nudge UI.
            if (!autoTemplate) return null;
            // Per-template friendly description so counsellors know what's going out.
            const templateDescription =
              autoTemplate === "missed_call"
                ? "Apology + tap-to-call back. Works outside the 24h window."
                : autoTemplate === "nimt_not_interested_ack"
                ? "Polite closure note signed off by you with your contact for future revival."
                : "Personal follow-up note with the confirmed callback date.";
            return (
              <div className="rounded-xl border border-success/20 dark:border-success/60/40 bg-success/5/60 dark:bg-success/90/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-success dark:text-success" />
                  <span className="text-xs font-semibold text-success-foreground dark:text-success/40">
                    WhatsApp follow-up
                  </span>
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!suppressAutoWa}
                    onChange={(e) => setSuppressAutoWa(!e.target.checked)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span className="text-[11px] text-foreground">
                    Send <span className="font-mono">{autoTemplate.replace(/_/g, " ")}</span> to {leadName}
                    <span className="block text-[10px] text-muted-foreground">
                      {templateDescription}
                    </span>
                  </span>
                </label>
                {/* Course-info opt-in only makes sense for engagement
                    dispositions — never for not_interested where pushing
                    course details would feel spammy. */}
                {disposition !== "not_interested" && (
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendCourseInfo}
                      onChange={(e) => setSendCourseInfo(e.target.checked)}
                      className="mt-0.5 accent-emerald-600"
                    />
                    <span className="text-[11px] text-foreground flex items-center gap-1">
                      <GraduationCap className="h-3 w-3 text-success" />
                      Also send course details
                      <span className="text-[10px] text-muted-foreground">(course_info_v4 - auto-filled from DB)</span>
                    </span>
                  </label>
                )}
              </div>
            );
          })()}

          {asksCnetAppeared && disposition && (
            <div className="rounded-xl border border-info/20 bg-info/5/60 p-3 dark:border-info/60/50 dark:bg-info/90/20">
              <label className="block text-xs font-semibold text-info-foreground dark:text-info/40 mb-2">
                CNET appeared? <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCnetAppeared(value)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      cnetAppeared === value
                        ? "border-info/40 bg-info text-white"
                        : "border-info/20 bg-background text-foreground hover:bg-info/5 dark:border-info/60"
                    }`}
                  >
                    {value === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {asksCahetRegistered && disposition && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5/60 p-3 dark:border-destructive/60/50 dark:bg-destructive/90/20">
              <label className="block text-xs font-semibold text-destructive dark:text-destructive/40 mb-2">
                Registered for CAHET? <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCahetRegistered(value)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      cahetRegistered === value
                        ? "border-destructive/40 bg-destructive text-white"
                        : "border-destructive/20 bg-background text-foreground hover:bg-destructive/5 dark:border-destructive/60"
                    }`}
                  >
                    {value === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {disposition === "course_not_listed" && (
            <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900/50 dark:bg-teal-950/20">
              <label className="block text-xs font-semibold text-teal-900 dark:text-teal-200 mb-2">
                Which course were they asking for? <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={requestedCourseText}
                onChange={(e) => setRequestedCourseText(e.target.value)}
                placeholder="e.g. B.Sc Aviation"
                className="w-full rounded-lg border border-teal-200 bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-teal-900"
              />
              <p className="mt-1.5 text-[10px] text-teal-700 dark:text-teal-400">
                Logged against this call so we can see which unlisted courses come up most often.
              </p>
            </div>
          )}

          {/* Inline follow-up scheduling — mandatory for actionable dispositions */}
          {(() => {
            const noFollowupRequired = ["not_interested", "ineligible", "wrong_number", "do_not_contact", "course_not_listed"];
            const requiresAction = disposition && !noFollowupRequired.includes(disposition);

            if (!requiresAction || !disposition) return null;

            return (
              <div className="rounded-xl border border-info/20 dark:border-info/50/40 bg-info/5/50 dark:bg-info/90/20 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-info-foreground dark:text-info/80" />
                  <span className="text-xs font-semibold text-info-foreground dark:text-info/40">Schedule Next Action *</span>
                </div>

                {/* Action type toggle */}
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setShowVisitForm(false)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium border transition-colors ${
                      !showVisitForm ? "bg-info text-white border-info/40" : "bg-background text-foreground border-border hover:bg-muted"
                    }`}>
                    <Phone className="h-3.5 w-3.5" /> Follow-up Call
                  </button>
                  <button type="button" onClick={() => setShowVisitForm(true)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium border transition-colors ${
                      showVisitForm ? "bg-success text-white border-success/40" : "bg-background text-foreground border-border hover:bg-muted"
                    }`}>
                    <MapPin className="h-3.5 w-3.5" /> Campus Visit
                  </button>
                </div>

                {/* Follow-up: date + time */}
                {!showVisitForm && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1 cursor-pointer rounded-lg border border-input bg-background px-2.5 py-1.5 flex items-center gap-2 hover:bg-muted/30"
                        onClick={openDatePicker}>
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium">{formatDisplayDate(followupDate)}</span>
                        <input ref={dateInputRef} type="date" min={todayStr()} value={followupDate}
                          onChange={e => setFollowupDate(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" tabIndex={-1} />
                      </div>
                      <select value={followupTime} onChange={e => setFollowupTime(e.target.value)}
                        className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs">
                        {VISIT_TIME_SLOTS.map(s => <option key={s} value={s}>{slotLabel(s)}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* Visit: campus + date + time */}
                {showVisitForm && (
                  <div className="space-y-2">
                    {campuses.length > 1 && (
                      <select value={visitCampusId} onChange={e => setVisitCampusId(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs">
                        <option value="">— Select campus —</option>
                        {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    <div className="flex gap-2">
                      <div className="relative flex-1 cursor-pointer rounded-lg border border-input bg-background px-2.5 py-1.5 flex items-center gap-2 hover:bg-muted/30"
                        onClick={openDatePicker}>
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium">{formatDisplayDate(visitDate)}</span>
                        <input ref={dateInputRef} type="date" min={todayStr()} value={visitDate}
                          onChange={e => setVisitDate(e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" tabIndex={-1} />
                      </div>
                      <select value={visitTime} onChange={e => setVisitTime(e.target.value)}
                        className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs">
                        {VISIT_TIME_SLOTS.map(s => <option key={s} value={s}>{slotLabel(s)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Submit */}
          {(() => {
            const noFollowupRequired = ["not_interested", "ineligible", "wrong_number", "do_not_contact", "course_not_listed"];
            const requiresAction = disposition && !noFollowupRequired.includes(disposition);
            const qualifierRequiredUnanswered =
              (asksCnetAppeared && !cnetAppeared) ||
              (asksCahetRegistered && !cahetRegistered) ||
              (disposition === "course_not_listed" && !requestedCourseText.trim());

            return (
              <div className="flex flex-col gap-2 pt-1">
                {requiresAction && showVisitForm && (
                  <Button
                    onClick={() => handleSubmit({ scheduleVisit: true })}
                    disabled={!disposition || !visitCampusId || qualifierRequiredUnanswered || saving}
                    className="w-full gap-2 bg-success hover:bg-success/90"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    Save & Schedule Visit
                  </Button>
                )}
                {requiresAction && !showVisitForm && (
                  <Button
                    onClick={() => handleSubmit({ scheduleFollowup: true })}
                    disabled={!disposition || qualifierRequiredUnanswered || saving}
                    className="w-full gap-2"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                    Save & Schedule Follow-up
                  </Button>
                )}
                {!requiresAction && (
                  <Button
                    variant="outline"
                    onClick={() => handleSubmit({})}
                    disabled={!disposition || qualifierRequiredUnanswered || saving}
                    className="w-full"
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                )}
              </div>
            );
          })()}
            </div>
          </div>
        </div>,
    "max-w-4xl max-h-[90vh] overflow-y-auto"
  );
}

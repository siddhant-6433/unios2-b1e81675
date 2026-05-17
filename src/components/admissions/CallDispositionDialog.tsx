import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Phone, CheckCircle, XCircle, PhoneMissed, PhoneOff, Clock3,
  BanIcon, Loader2, ArrowRight, MapPin, CalendarDays, ChevronDown, Clock,
  AlertCircle, MessageSquare, GraduationCap,
} from "lucide-react";

export type CallDisposition =
  | "interested"
  | "not_interested"
  | "ineligible"
  | "not_answered"
  | "wrong_number"
  | "call_back"
  | "do_not_contact"
  | "voicemail"
  | "busy";

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
  /** Also fire course_info_v1 after the disposition WA template */
  send_course_info?: boolean;
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
  | "failed";

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
  /** Called when counsellor clicks "Call connected" — flips parent state */
  onManualConnect?: () => void;
  /** Lead context surfaced in the calling state so the counsellor knows who
   *  they're calling and why without leaving the dialog. */
  courseName?: string | null;
  leadStage?: string | null;
  personRole?: string | null;
  latestNote?: string | null;
  aiCallSummary?: string | null;
}

const DISPOSITIONS: { value: CallDisposition; label: string; icon: any; color: string; suggestsFollowup: boolean }[] = [
  { value: "interested", label: "Interested", icon: CheckCircle, color: "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400", suggestsFollowup: true },
  { value: "not_interested", label: "Not Interested", icon: XCircle, color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-50 dark:bg-red-900/30 dark:text-red-400", suggestsFollowup: false },
  { value: "ineligible", label: "Ineligible", icon: AlertCircle, color: "bg-purple-100 text-purple-700 border-purple-300 hover:bg-purple-50 dark:bg-purple-900/30 dark:text-purple-400", suggestsFollowup: false },
  { value: "not_answered", label: "Not Answered", icon: PhoneMissed, color: "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400", suggestsFollowup: true },
  { value: "call_back", label: "Call Back Later", icon: Clock3, color: "bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400", suggestsFollowup: true },
  { value: "voicemail", label: "Voicemail", icon: PhoneOff, color: "bg-indigo-100 text-indigo-700 border-indigo-300 hover:bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400", suggestsFollowup: true },
  { value: "busy", label: "Busy", icon: Phone, color: "bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400", suggestsFollowup: true },
  { value: "wrong_number", label: "Wrong Number", icon: BanIcon, color: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300", suggestsFollowup: false },
  { value: "do_not_contact", label: "Do Not Contact", icon: BanIcon, color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-50 dark:bg-red-900/30 dark:text-red-400", suggestsFollowup: false },
];

const DURATION_OPTIONS = [
  { value: 0, label: "—" },
  { value: 30, label: "< 1m" },
  { value: 120, label: "1-3m" },
  { value: 300, label: "3-5m" },
  { value: 600, label: "5-10m" },
  { value: 900, label: "10m+" },
];

const VISIT_TIME_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"];
const todayStr = () => new Date().toISOString().split("T")[0];
const tomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
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
  onSubmit, onCallNow, callStatus, onManualConnect,
  courseName, leadStage, personRole, latestNote, aiCallSummary,
}: CallDispositionDialogProps) {
  const [disposition, setDisposition] = useState<CallDisposition | null>(null);
  const [duration, setDuration] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
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
  // opt out of the auto-send or also fire course_info_v1 alongside.
  const [suppressAutoWa, setSuppressAutoWa] = useState(false);
  const [sendCourseInfo, setSendCourseInfo] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const selectedDisp = DISPOSITIONS.find(d => d.value === disposition);

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
  };

  const handleSubmit = async (opts: { scheduleFollowup?: boolean; scheduleVisit?: boolean } = {}) => {
    if (!disposition) return;
    setSaving(true);
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
    });
    setSaving(false);
    resetState();
    onOpenChange(false);
  };

  const handleClose = (v: boolean) => {
    if (!saving && !v) resetState();
    onOpenChange(v);
  };

  const openDatePicker = () => {
    dateInputRef.current?.showPicker?.();
    dateInputRef.current?.focus();
  };

  // ── Phase 1: still ringing — show waiting state + context, hide picker ───
  // Plivo's manual-call flow only writes ai_call_records.status on hangup, so
  // we cannot detect "answered" from the DB during the talk. The counsellor
  // therefore gets a "Call connected" button to manually advance to the
  // picker the moment the lead picks up. The surrounding context (course,
  // stage, latest note, AI summary) helps the counsellor remember who and
  // why during the few seconds of ringing.
  if (callStatus === "calling") {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              Calling {leadName}…
            </DialogTitle>
          </DialogHeader>
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
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
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
            </div>

            {/* AI call summary if available — primary "why am I calling this lead" context */}
            {aiCallSummary && (
              <div className="rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-950/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300 mb-1">AI call summary</p>
                <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-5">{aiCallSummary}</p>
              </div>
            )}

            {/* Latest counsellor note */}
            {latestNote && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">Latest note</p>
                <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-3">{latestNote}</p>
              </div>
            )}

            {/* Waiting spinner */}
            <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
              <p className="text-sm font-medium text-foreground">Waiting for {leadName} to pick up…</p>
              <p className="text-[11px] text-muted-foreground max-w-xs">
                Tap <span className="font-semibold">Call connected</span> the moment they answer,
                or wait — the screen will auto-fill if their phone is busy / switched off / unanswered.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs"
                onClick={() => onManualConnect?.()}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Call connected — Mark Outcome
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClose(false)}
                className="text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const isAutoDisposed =
    callStatus === "no_answer" || callStatus === "busy" || callStatus === "failed";
  const autoBannerText: Record<string, string> = {
    no_answer: "Lead didn't pick up — auto-set to Not Answered.",
    busy: "Lead's line was busy — auto-set to Busy.",
    failed: "Call failed (switched off / unreachable) — auto-set to Not Answered.",
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            {isAutoDisposed ? "Schedule next callback" : "Log Call Outcome"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Auto-disposed banner */}
          {isAutoDisposed && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-900 dark:text-amber-200">
                {autoBannerText[callStatus!] || "Call did not connect."}
                <div className="text-[10px] mt-0.5 opacity-80">Edit the follow-up time below and save.</div>
              </div>
            </div>
          )}

          {/* Lead info + Call Now button — Call Now hidden when call already in flight */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{leadName}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{leadPhone}</p>
            </div>
            {!callStatus && (
              <Button
                size="sm"
                className="shrink-0 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
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
          {/* Disposition pills */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Outcome *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DISPOSITIONS.map(d => {
                const Icon = d.icon;
                const selected = disposition === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDisposition(d.value)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                      selected
                        ? `${d.color} ring-2 ring-offset-1 ring-current`
                        : "border-border hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
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
            <div className="rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-950/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-purple-700 dark:text-purple-400" />
                <span className="text-xs font-semibold text-purple-900 dark:text-purple-200">Eligible for future session?</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["2027-28", "2028-29"] as const).map((session) => (
                  <button
                    key={session}
                    type="button"
                    onClick={() => setFutureSession(futureSession === session ? null : session)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      futureSession === session
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-background border-border text-foreground hover:bg-purple-50 dark:hover:bg-purple-950/40"
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
                <p className="text-[10px] text-purple-700 dark:text-purple-300">
                  Lead will be marked ineligible for current session but re-contacted for {futureSession} admissions.
                </p>
              )}
            </div>
          )}
            </>
          )}
          {/* end !isAutoDisposed gate — picker, duration, notes, ineligible */}

          {/* WhatsApp follow-up nudge — visible the moment a disposition is set
              (manual or auto). Shows the template that will auto-send and lets
              the counsellor opt out, plus offers a one-tap course-info send. */}
          {disposition && (() => {
            const noFollowupRequired = ["not_interested", "ineligible", "wrong_number", "do_not_contact"];
            const autoTemplate =
              disposition === "interested" || disposition === "call_back"
                ? "callback_scheduled"
                : disposition === "not_answered" || disposition === "busy" || disposition === "voicemail"
                ? "missed_call"
                : null;
            const wontAutoSend = noFollowupRequired.includes(disposition);
            if (wontAutoSend && !autoTemplate) return null;
            return (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                    WhatsApp follow-up
                  </span>
                </div>
                {autoTemplate && (
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
                        {autoTemplate === "missed_call"
                          ? "Apology + tap-to-call back. Works outside the 24h window."
                          : "Thanks-for-talking note with course mention."}
                      </span>
                    </span>
                  </label>
                )}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendCourseInfo}
                    onChange={(e) => setSendCourseInfo(e.target.checked)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span className="text-[11px] text-foreground flex items-center gap-1">
                    <GraduationCap className="h-3 w-3 text-emerald-700" />
                    Also send course details
                    <span className="text-[10px] text-muted-foreground">(course_info_v1 — auto-filled from DB)</span>
                  </span>
                </label>
              </div>
            );
          })()}

          {/* Inline follow-up scheduling — mandatory for actionable dispositions */}
          {(() => {
            const noFollowupRequired = ["not_interested", "ineligible", "wrong_number", "do_not_contact"];
            const requiresAction = disposition && !noFollowupRequired.includes(disposition);

            if (!requiresAction || !disposition) return null;

            return (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
                  <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">Schedule Next Action *</span>
                </div>

                {/* Action type toggle */}
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setShowVisitForm(false)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium border transition-colors ${
                      !showVisitForm ? "bg-blue-600 text-white border-blue-600" : "bg-background text-foreground border-border hover:bg-muted"
                    }`}>
                    <Phone className="h-3.5 w-3.5" /> Follow-up Call
                  </button>
                  <button type="button" onClick={() => setShowVisitForm(true)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium border transition-colors ${
                      showVisitForm ? "bg-emerald-600 text-white border-emerald-600" : "bg-background text-foreground border-border hover:bg-muted"
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
            const noFollowupRequired = ["not_interested", "ineligible", "wrong_number", "do_not_contact"];
            const requiresAction = disposition && !noFollowupRequired.includes(disposition);

            return (
              <div className="flex flex-col gap-2 pt-1">
                {requiresAction && showVisitForm && (
                  <Button
                    onClick={() => handleSubmit({ scheduleVisit: true })}
                    disabled={!disposition || !visitCampusId || saving}
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    Save & Schedule Visit
                  </Button>
                )}
                {requiresAction && !showVisitForm && (
                  <Button
                    onClick={() => handleSubmit({ scheduleFollowup: true })}
                    disabled={!disposition || saving}
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
                    disabled={!disposition || saving}
                    className="w-full"
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                )}
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

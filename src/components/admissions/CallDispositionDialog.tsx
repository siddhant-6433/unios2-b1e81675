import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Phone, CheckCircle, XCircle, PhoneMissed, PhoneOff, Clock3,
  BanIcon, Loader2, ArrowRight, MapPin, CalendarDays, ChevronDown, Clock,
} from "lucide-react";

export type CallDisposition =
  | "interested"
  | "not_interested"
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
  visit?: { visit_date: string; campus_id: string };
}

interface CallDispositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  leadPhone: string;
  campuses: { id: string; name: string }[];
  defaultCampusId?: string;
  onSubmit: (data: CallDispositionData) => Promise<void>;
}

const DISPOSITIONS: { value: CallDisposition; label: string; icon: any; color: string; suggestsFollowup: boolean }[] = [
  { value: "interested", label: "Interested", icon: CheckCircle, color: "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400", suggestsFollowup: true },
  { value: "not_interested", label: "Not Interested", icon: XCircle, color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-50 dark:bg-red-900/30 dark:text-red-400", suggestsFollowup: false },
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

export function CallDispositionDialog({ open, onOpenChange, leadName, leadPhone, campuses, defaultCampusId, onSubmit }: CallDispositionDialogProps) {
  const [disposition, setDisposition] = useState<CallDisposition | null>(null);
  const [duration, setDuration] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Visit scheduling state
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [visitDate, setVisitDate] = useState(tomorrowStr());
  const [visitTime, setVisitTime] = useState("11:00");
  const [visitCampusId, setVisitCampusId] = useState(defaultCampusId || campuses[0]?.id || "");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const selectedDisp = DISPOSITIONS.find(d => d.value === disposition);

  const resetState = () => {
    setDisposition(null);
    setDuration(0);
    setNotes("");
    setShowVisitForm(false);
    setVisitDate(tomorrowStr());
    setVisitTime("11:00");
  };

  const handleSubmit = async (opts: { scheduleFollowup?: boolean; scheduleVisit?: boolean } = {}) => {
    if (!disposition) return;
    setSaving(true);
    const visit = opts.scheduleVisit && visitDate && visitTime
      ? { visit_date: new Date(`${visitDate}T${visitTime}:00`).toISOString(), campus_id: visitCampusId }
      : undefined;
    await onSubmit({
      disposition,
      duration_seconds: duration,
      notes,
      schedule_followup: opts.scheduleFollowup ?? false,
      visit,
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            Log Call Outcome
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Lead info */}
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-sm font-medium text-foreground">{leadName}</p>
            <p className="text-[11px] text-muted-foreground font-mono">{leadPhone}</p>
          </div>

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

          {/* Visit scheduling — only for "Interested" */}
          {disposition === "interested" && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-2">
              <button
                type="button"
                onClick={() => setShowVisitForm(!showVisitForm)}
                className="flex items-center justify-between w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">Schedule Campus Visit</span>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-emerald-700 transition-transform ${showVisitForm ? "rotate-180" : ""}`} />
              </button>

              {showVisitForm && (
                <div className="space-y-2 pt-1">
                  {/* Campus */}
                  {campuses.length > 1 && (
                    <select
                      value={visitCampusId}
                      onChange={e => setVisitCampusId(e.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    >
                      <option value="">— Select campus —</option>
                      {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}

                  {/* Date */}
                  <div
                    className="relative w-full cursor-pointer rounded-lg border border-input bg-background px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
                    onClick={openDatePicker}
                  >
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium">{formatDisplayDate(visitDate)}</span>
                    </div>
                    <input
                      ref={dateInputRef}
                      type="date"
                      min={todayStr()}
                      value={visitDate}
                      onChange={e => setVisitDate(e.target.value)}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                      tabIndex={-1}
                    />
                  </div>

                  {/* Time slot pills */}
                  <div className="grid grid-cols-4 gap-1">
                    {VISIT_TIME_SLOTS.map(slot => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setVisitTime(slot)}
                        className={`rounded-lg py-1 text-[10px] font-medium transition-colors border ${
                          visitTime === slot
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {slotLabel(slot)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="flex flex-col gap-2 pt-1">
            {disposition === "interested" && showVisitForm && (
              <Button
                onClick={() => handleSubmit({ scheduleVisit: true })}
                disabled={!disposition || !visitCampusId || saving}
                className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                Save & Schedule Visit
              </Button>
            )}
            {selectedDisp?.suggestsFollowup && (
              <Button
                onClick={() => handleSubmit({ scheduleFollowup: true })}
                disabled={!disposition || saving}
                variant={disposition === "interested" && showVisitForm ? "outline" : "default"}
                className="w-full gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Save & Schedule Follow-up
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => handleSubmit({})}
              disabled={!disposition || saving}
              className="w-full"
            >
              {saving ? "Saving..." : "Save Only"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, Clock, ChevronDown, Phone, MapPin } from "lucide-react";

interface ScheduleFollowupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (data: { scheduled_at: string; type: string; notes: string }) => Promise<void>;
}

const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00",
  "14:00", "15:00", "16:00", "17:00",
];

const FOLLOWUP_TYPES = [
  { value: "call", label: "Call", icon: Phone, color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "visit", label: "Visit", icon: MapPin, color: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400" },
];

const slotLabel = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
};

const todayStr = () => new Date().toISOString().split("T")[0];

const formatDisplayDate = (dateStr: string) => {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  const dateObj = new Date(`${dateStr}T00:00:00`);
  const day = dateObj.toLocaleDateString("en-IN", { weekday: "long" });
  return `${day}, ${d}/${m}/${y.slice(2)}`;
};

// Get next working day (Mon-Sat, skips Sunday)
function getNextWorkingDay(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1); // skip Sunday
  return d;
}

// Smart default: Call = now+2h within 9-18 Mon-Sat, Visit = next working day 10AM
function getSmartDefault(followupType: string): { date: string; time: string } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const hour = ist.getUTCHours();
  const day = ist.getUTCDay(); // 0=Sun

  if (followupType === "visit") {
    // Visit: next working day at 10:00 AM
    const nextDay = getNextWorkingDay(now);
    return { date: nextDay.toISOString().split("T")[0], time: "10:00" };
  }

  // Call: now + 2 hours, within 9AM-6PM, Mon-Sat
  let targetHour = hour + 2;
  let targetDate = new Date(now);

  // If past 6PM or Sunday → move to next working day 9AM
  if (targetHour >= 18 || day === 0) {
    targetDate = day === 0 ? targetDate : getNextWorkingDay(targetDate);
    if (day === 0) {
      targetDate.setDate(targetDate.getDate() + 1); // Monday
    }
    // Find nearest time slot at or after 9AM
    return { date: targetDate.toISOString().split("T")[0], time: "09:00" };
  }

  // If before 9AM → set to 9AM today (if working day)
  if (targetHour < 9) {
    if (day === 0) {
      targetDate = getNextWorkingDay(targetDate);
      return { date: targetDate.toISOString().split("T")[0], time: "09:00" };
    }
    return { date: targetDate.toISOString().split("T")[0], time: "09:00" };
  }

  // Round to nearest time slot
  const nearestSlot = TIME_SLOTS.find(s => parseInt(s.split(":")[0]) >= targetHour) || "17:00";
  return { date: targetDate.toISOString().split("T")[0], time: nearestSlot };
}

export function ScheduleFollowupDialog({ open, onOpenChange, onSchedule }: ScheduleFollowupDialogProps) {
  const [type, setType] = useState("call");
  const defaults = getSmartDefault("call");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Update defaults when type changes
  useEffect(() => {
    const d = getSmartDefault(type);
    setDate(d.date);
    setTime(d.time);
  }, [type]);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      const d = getSmartDefault("call");
      setType("call");
      setDate(d.date);
      setTime(d.time);
      setNotes("");
    }
  }, [open]);

  const handleSchedule = async () => {
    if (!date || !time) return;
    setSaving(true);
    const scheduled_at = new Date(`${date}T${time}:00`).toISOString();
    await onSchedule({ scheduled_at, type, notes });
    setSaving(false);
    setNotes("");
    setType("call");
    onOpenChange(false);
  };

  const openDatePicker = () => {
    dateInputRef.current?.showPicker?.();
    dateInputRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Schedule Follow-up
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Follow-up type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {FOLLOWUP_TYPES.map(ft => {
                const Icon = ft.icon;
                return (
                  <button
                    key={ft.value}
                    type="button"
                    onClick={() => setType(ft.value)}
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium transition-colors border ${
                      type === ft.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {ft.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <div
              className="relative w-full cursor-pointer rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors focus-within:ring-2 focus-within:ring-primary/30"
              onClick={openDatePicker}
            >
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">
                  {formatDisplayDate(date)}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                ref={dateInputRef}
                type="date"
                min={todayStr()}
                value={date}
                onChange={e => setDate(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                tabIndex={-1}
              />
            </div>
          </div>

          {/* Time slot pills */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Time
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {TIME_SLOTS.map(slot => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setTime(slot)}
                  className={`rounded-lg py-1.5 text-xs font-medium transition-colors border ${
                    time === slot
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  {slotLabel(slot)}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Discuss fee structure"
              className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <Button
            className="w-full"
            disabled={!date || !time || saving}
            onClick={handleSchedule}
          >
            {saving ? "Scheduling…" : "Schedule Follow-up"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

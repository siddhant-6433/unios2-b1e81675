import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TextField, DatePickerField } from "@/components/ui/state-fields";
import { Clock } from "lucide-react";

interface ScheduleFollowupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (data: { scheduled_at: string; type: string; notes: string }) => Promise<void>;
}

const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00",
  "14:00", "15:00", "16:00", "17:00",
];

// Follow-ups are calls. Campus visits are scheduled through the visit flow
// (campus_visits), which gets reminders, confirmations, and the Visit funnel.
// The old "Visit" follow-up type wrote dead lead_followups rows that bypassed
// all of that — retired in the pipelines redesign.

const slotLabel = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
};

// Get next working day (Mon-Sat, skips Sunday)
function getNextWorkingDay(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1); // skip Sunday
  return d;
}

// Smart default for a call follow-up: now+2h within 9-18 Mon-Sat.
function getSmartDefault(): { date: string; time: string } {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const hour = ist.getUTCHours();
  const day = ist.getUTCDay(); // 0=Sun

  // Call: now + 2 hours, within 9AM-6PM, Mon-Sat
  const targetHour = hour + 2;
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
  const defaults = getSmartDefault();
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      const d = getSmartDefault();
      setDate(d.date);
      setTime(d.time);
      setNotes("");
    }
  }, [open]);

  const handleSchedule = async () => {
    if (!date || !time) return;
    setSaving(true);
    const scheduled_at = new Date(`${date}T${time}:00`).toISOString();
    await onSchedule({ scheduled_at, type: "call", notes });
    setSaving(false);
    setNotes("");
    onOpenChange(false);
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
          <DatePickerField
            value={date}
            onValueChange={setDate}
            label="Date"
            minDate={(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()}
          />

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

          <TextField
            value={notes}
            onValueChange={setNotes}
            label="Notes (optional)"
            placeholder="e.g. Discuss fee structure"
          />

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

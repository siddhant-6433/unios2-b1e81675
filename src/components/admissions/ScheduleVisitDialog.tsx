import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, Clock, ChevronDown } from "lucide-react";

interface ScheduleVisitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campuses: { id: string; name: string }[];
  defaultCampusId?: string;
  onSchedule: (data: { visit_date: string; campus_id: string }) => Promise<void>;
}

const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00",
  "14:00", "15:00", "16:00", "17:00",
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

export function ScheduleVisitDialog({ open, onOpenChange, campuses, defaultCampusId, onSchedule }: ScheduleVisitDialogProps) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("10:00");
  const [campusId, setCampusId] = useState(defaultCampusId || campuses[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleSchedule = async () => {
    if (!date || !time) return;
    setSaving(true);
    const visit_date = new Date(`${date}T${time}:00`).toISOString();
    await onSchedule({ visit_date, campus_id: campusId });
    setSaving(false);
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
            <CalendarDays className="h-4 w-4 text-primary" />
            Schedule Campus Visit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Campus */}
          {campuses.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Campus</label>
              <select
                className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={campusId}
                onChange={e => setCampusId(e.target.value)}
              >
                <option value="">— Select campus —</option>
                {campuses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            {/* Clickable display row — opens native calendar */}
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
              {/* Hidden native date input — positioned over the row so showPicker() works */}
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
              <Clock className="h-3 w-3" /> Time Slot
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

          <Button
            className="w-full"
            disabled={!date || !time || saving}
            onClick={handleSchedule}
          >
            {saving ? "Scheduling…" : "Schedule Visit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

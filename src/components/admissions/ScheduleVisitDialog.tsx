import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SelectField, DatePickerField } from "@/components/ui/state-fields";
import { Clock } from "lucide-react";

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

export function ScheduleVisitDialog({ open, onOpenChange, campuses, defaultCampusId, onSchedule }: ScheduleVisitDialogProps) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState("10:00");
  const [campusId, setCampusId] = useState(defaultCampusId || campuses[0]?.id || "");
  const [saving, setSaving] = useState(false);

  const handleSchedule = async () => {
    if (!date || !time) return;
    setSaving(true);
    const visit_date = new Date(`${date}T${time}:00`).toISOString();
    await onSchedule({ visit_date, campus_id: campusId });
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Schedule Campus Visit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {campuses.length > 1 && (
            <SelectField
              value={campusId}
              onValueChange={setCampusId}
              options={[
                { value: "", label: "— Select campus —" },
                ...campuses.map(c => ({ value: c.id, label: c.name })),
              ]}
              label="Campus"
              placeholder="— Select campus —"
            />
          )}

          <DatePickerField
            value={date}
            onValueChange={setDate}
            label="Date"
            minDate={(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()}
          />

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

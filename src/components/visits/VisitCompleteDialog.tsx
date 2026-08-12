// VisitCompleteDialog — capture a visit outcome + feedback and, optionally,
// schedule the post-visit follow-up in one transaction (visit_complete RPC,
// which stamps visit_id on the follow-up).

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectField, TextAreaField, DatePickerField } from "@/components/ui/state-fields";
import { CheckCircle2, Clock } from "lucide-react";

const OUTCOMES = [
  { value: "interested", label: "Interested" },
  { value: "token_collected", label: "Token collected" },
  { value: "offer_discussed", label: "Offer discussed" },
  { value: "needs_followup", label: "Needs follow-up" },
  { value: "not_interested", label: "Not interested" },
  { value: "other", label: "Other" },
];

const TIME_SLOTS = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"];
const slotLabel = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  visitId: string | null;
  leadName?: string;
  onCompleted?: () => void;
}

export function VisitCompleteDialog({ open, onOpenChange, visitId, leadName, onCompleted }: Props) {
  const { toast } = useToast();
  const [outcome, setOutcome] = useState("interested");
  const [feedback, setFeedback] = useState("");
  const [wantFollowup, setWantFollowup] = useState(false);
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [time, setTime] = useState("11:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOutcome("interested");
      setFeedback("");
      setWantFollowup(false);
      const d = new Date(); d.setDate(d.getDate() + 1);
      setDate(d.toISOString().slice(0, 10));
      setTime("11:00");
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!visitId) return;
    setSaving(true);
    const followupAt = wantFollowup && date && time
      ? new Date(`${date}T${time}:00`).toISOString()
      : null;
    const { error } = await supabase.rpc("visit_complete" as any, {
      _visit_id: visitId,
      _outcome: outcome,
      _feedback: feedback.trim() || null,
      _followup_at: followupAt,
      _followup_type: "call",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not complete visit", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Visit completed", description: wantFollowup ? "Follow-up scheduled." : undefined });
    onCompleted?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Complete Visit{leadName ? ` — ${leadName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <SelectField
            value={outcome}
            onValueChange={setOutcome}
            options={OUTCOMES}
            label="Outcome"
            allowEmpty={false}
          />
          <TextAreaField
            value={feedback}
            onValueChange={setFeedback}
            label="Feedback (optional)"
            placeholder="What happened during the visit?"
          />

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={wantFollowup} onCheckedChange={(v) => setWantFollowup(!!v)} />
            <span className="flex items-center gap-1.5 text-foreground">
              <Clock className="h-3.5 w-3.5" /> Schedule a follow-up
            </span>
          </label>

          {wantFollowup && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <DatePickerField
                value={date}
                onValueChange={setDate}
                label="Follow-up date"
                minDate={(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()}
              />
              <div className="grid grid-cols-4 gap-1.5">
                {TIME_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setTime(slot)}
                    className={`rounded-lg py-1.5 text-xs font-medium transition-colors border ${
                      time === slot
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-transparent hover:bg-muted"
                    }`}
                  >
                    {slotLabel(slot)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <ButtonOrb state="working" onFilled /> : null}
            {saving ? "Saving…" : "Complete Visit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

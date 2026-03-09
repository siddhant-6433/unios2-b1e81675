import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, UserCheck } from "lucide-react";

interface InterviewScoringDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  currentScore: number | null;
  currentResult: string | null;
  onSuccess: () => void;
}

export function InterviewScoringDialog({ open, onOpenChange, leadId, leadName, currentScore, currentResult, onSuccess }: InterviewScoringDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [score, setScore] = useState(currentScore ?? 0);
  const [result, setResult] = useState(currentResult || "pending");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const updates: any = { interview_score: score, interview_result: result };
    // Auto-advance: scoring means interview stage at minimum
    // If passed → move toward offer_sent, if failed → rejected
    if (result === "passed") updates.stage = "offer_sent";
    else if (result === "failed") updates.stage = "rejected";
    else updates.stage = "interview";

    const { error } = await supabase.from("leads").update(updates).eq("id", leadId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id: leadId, user_id: user?.id || null, type: "interview",
      description: `Interview scored: ${score}/100 — Result: ${result}${notes ? `. ${notes}` : ""}`,
    });

    toast({ title: "Interview saved" });
    setSaving(false);
    onOpenChange(false);
    onSuccess();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5" /> Interview — {leadName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Score (0–100)</label>
            <input type="number" min={0} max={100} value={score} onChange={e => setScore(Number(e.target.value))} className={inputCls} />
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(score, 100)}%` }} />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Result</label>
            <div className="flex gap-2">
              {["pending", "passed", "failed", "waitlisted"].map(r => (
                <button key={r} onClick={() => setResult(r)}
                  className={`rounded-lg px-4 py-2 text-xs font-medium capitalize transition-colors ${
                    result === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Interviewer Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Observations, strengths, areas of concern..." className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />} Save Score
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

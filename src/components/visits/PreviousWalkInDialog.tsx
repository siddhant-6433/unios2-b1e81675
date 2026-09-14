import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useToast } from "@/hooks/use-toast";
import { completeCampusVisit } from "@/lib/visitCompletion";
import { fetchWalkInHistory, formatWalkInWhen, walkInOnDay, type WalkInHistoryRow } from "@/lib/walkInHistory";
import { Footprints, MapPin } from "lucide-react";

interface Campus { id: string; name: string; code?: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  userId: string | null;
  counsellorLabel: string;
  campuses: Campus[];
  defaultCampusId?: string;
  onLogged?: () => void;
}

export function PreviousWalkInDialog({
  open, onOpenChange, leadId, leadName, userId, counsellorLabel,
  campuses, defaultCampusId, onLogged,
}: Props) {
  const { toast } = useToast();
  const [history, setHistory] = useState<WalkInHistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [campusId, setCampusId] = useState(defaultCampusId || "");
  const [feedback, setFeedback] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [followupDate, setFollowupDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCampusId(defaultCampusId || "");
    setFeedback("");
    setVisitDate("");
    setFollowupDate("");
    setHistoryError(null);
    fetchWalkInHistory(leadId)
      .then(setHistory)
      .catch((e: any) => setHistoryError(e?.message || "Could not load walk-in history"));
  }, [open, leadId, defaultCampusId]);

  const duplicate = walkInOnDay(history, visitDate);

  const save = async () => {
    if (!visitDate) {
      toast({ title: "Visit date required", description: "Pick the date they walked in.", variant: "destructive" });
      return;
    }
    if (duplicate) {
      toast({ title: "Already logged", description: "A walk-in for this date is already on the Visit Center. Don't create a duplicate.", variant: "destructive" });
      return;
    }
    if (!followupDate) {
      toast({ title: "Follow-up required", description: "Pick a post-visit follow-up date.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await completeCampusVisit({
        leadId,
        userId,
        visitId: null,
        campusId: campusId || null,
        campusLabel: campuses.find(c => c.id === campusId)?.name || "Campus",
        counsellorLabel,
        feedback,
        visitDate,
        followupDate,
      });
      toast({ title: "Previous walk-in logged", description: "It will show on Visit Center → Walk-ins." });
      onLogged?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not save walk-in", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onOpenChange(false)}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Log a Previous Walk-In — {leadName}</h3>
          <button onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Existing walk-ins</p>
          {historyError ? (
            <p className="text-xs text-destructive">{historyError}</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">None recorded yet for this lead.</p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((row) => (
                <li key={row.id} className={`rounded-md border bg-background px-2 py-1.5 text-xs ${duplicate?.id === row.id ? "border-destructive/50 bg-destructive/5" : "border-border/60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-foreground">{formatWalkInWhen(row.checked_in_at || row.visit_date)}</span>
                    <span className="shrink-0 text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {row.campus_code || row.campus_name}
                    </span>
                  </div>
                  {(row.feedback || row.purpose) && (
                    <p className="mt-0.5 text-muted-foreground line-clamp-2">{row.feedback || row.purpose}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Visit date <span className="text-destructive">*</span>
          </label>
          <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs" />
          {duplicate && (
            <p className="text-[11px] text-destructive">A walk-in is already logged for this date. Use that row instead of adding another.</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Campus</label>
          <select value={campusId} onChange={e => setCampusId(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs">
            <option value="">Select campus…</option>
            {campuses.map(c => <option key={c.id} value={c.id}>{c.code ? `${c.name} (${c.code})` : c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Comments</label>
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={2}
            placeholder="What happened on campus?"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Post-visit follow-up <span className="text-destructive">*</span>
          </label>
          <input type="date" value={followupDate} onChange={e => setFollowupDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            max={new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs" />
        </div>
        <Button size="sm" className="w-full h-8 text-xs" onClick={save} disabled={saving || !visitDate || !followupDate || !!duplicate}>
          {saving ? <ButtonOrb state="connecting" onFilled /> : <Footprints className="h-3 w-3 mr-1" />}
          Log a Previous Walk-In
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, StickyNote, PauseCircle } from "lucide-react";

export interface PendingOfferNoteTarget {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string;
  phone?: string | null;
  course_name?: string | null;
  pending_offer_note?: string | null;
}

interface Props {
  target: PendingOfferNoteTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

const WAITING_FOR_COUNSELLING = "Waiting for Counselling";

export function PendingOfferNoteDialog({ target, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setNote(target.pending_offer_note || "");
  }, [target?.id]);

  if (!target) return null;

  const saveNote = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("applications" as any)
      .update({ pending_offer_note: note.trim() || null })
      .eq("id", target.id);
    if (error) {
      toast({ title: "Couldn't save note", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    toast({ title: "Note saved", description: target.application_id });
    setSaving(false);
    onSaved();
  };

  const moveToHold = async () => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("applications" as any)
      .update({
        status: "on_hold",
        hold_reason: WAITING_FOR_COUNSELLING,
        held_at: new Date().toISOString(),
        held_by: userData?.user?.id || null,
        pending_offer_note: note.trim() || null,
      })
      .eq("id", target.id);
    if (error) {
      toast({ title: "Couldn't move to on hold", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    toast({ title: "Moved to On Hold", description: `${target.application_id} — ${WAITING_FOR_COUNSELLING}` });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-orange-500" />
            Pending Offer — Add Note
          </DialogTitle>
          <DialogDescription className="text-xs">
            {target.full_name} · {target.application_id}
            {target.course_name ? ` · ${target.course_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pending-offer-note">Why is the offer pending?</Label>
            <Textarea
              id="pending-offer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Waiting for counselling session, documents under review…"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="outline"
            onClick={moveToHold}
            disabled={saving}
            className="border-warning/30 text-warning-foreground hover:bg-warning/5"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <PauseCircle className="h-4 w-4 mr-1.5" />}
            Move to On Hold — {WAITING_FOR_COUNSELLING}
          </Button>
          <Button onClick={saveNote} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <StickyNote className="h-4 w-4 mr-1.5" />}
            Save Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Share2 } from "lucide-react";
import { referLeadsToPartner, REFERRAL_PARTNER_LABEL } from "@/lib/leadReferral";

interface ReferToPartnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess?: () => void;
}

export function ReferToPartnerDialog({ open, onOpenChange, leadIds, onSuccess }: ReferToPartnerDialogProps) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  const handleRefer = async () => {
    setLoading(true);
    try {
      const { referred, failed } = await referLeadsToPartner(leadIds, note.trim());
      if (referred > 0) {
        toast({
          title: `Referred to ${REFERRAL_PARTNER_LABEL}`,
          description: `${referred} lead${referred === 1 ? "" : "s"} referred.${failed.length ? ` ${failed.length} skipped.` : ""}`,
        });
        onSuccess?.();
        onOpenChange(false);
      }
      if (failed.length > 0 && referred === 0) {
        toast({ title: "Referral failed", description: failed[0].message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Refer to {REFERRAL_PARTNER_LABEL}
          </DialogTitle>
          <DialogDescription>
            {leadIds.length === 1
              ? `This lead will appear in ${REFERRAL_PARTNER_LABEL}'s Referrals tab, where they can call it and report the outcome.`
              : `${leadIds.length} leads will appear in ${REFERRAL_PARTNER_LABEL}'s Referrals tab, where they can call them and report outcomes.`}
            {" "}The counsellor assignment does not change. Only BPT / BMRIT leads can be referred.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="referral-note">Note for {REFERRAL_PARTNER_LABEL} (optional)</Label>
          <Textarea
            id="referral-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything they should know before calling"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleRefer} disabled={loading || leadIds.length === 0} className="gap-2">
            {loading ? <ButtonOrb state="working" /> : <Share2 className="h-4 w-4" />}
            Refer {leadIds.length > 1 ? `${leadIds.length} leads` : "lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

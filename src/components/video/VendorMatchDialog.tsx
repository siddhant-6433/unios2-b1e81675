import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";

export type VendorCandidate = {
  contact_id: string;
  contact_name: string;
  phone: string | null;
  email: string | null;
  company_name: string | null;
};

const CREATE_NEW = "__create_new__";

// Shown when an approved video bill is sent to Zoho but its editor is not yet linked
// to a Zoho vendor. Staff pick an existing vendor (matched by phone) or create a new one;
// the choice is persisted onto the editor so future syncs never prompt again.
export function VendorMatchDialog({
  editorName,
  billId,
  pdfBase64,
  candidates,
  onDone,
  onClose,
}: {
  editorName: string;
  billId: string;
  pdfBase64?: string;
  candidates: VendorCandidate[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [choice, setChoice] = useState<string>(candidates[0]?.contact_id || CREATE_NEW);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    setSubmitting(true);
    const body: Record<string, unknown> = { bill_id: billId, action: "create_bill", pdf_base64: pdfBase64 };
    if (choice === CREATE_NEW) body.force_create_vendor = true;
    else body.vendor_id = choice;
    const { data, error } = await supabase.functions.invoke("zoho-video-bill-sync", { body });
    setSubmitting(false);
    const errMsg = error?.message || (data as { error?: string } | null)?.error;
    if (errMsg) { toast({ title: "Zoho sync failed", description: errMsg, variant: "destructive" }); return; }
    toast({ title: "Sent to Zoho Books" });
    onDone();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link {editorName} to a Zoho vendor</DialogTitle>
          <DialogDescription>
            {candidates.length > 0
              ? "We found existing Zoho vendors matching this editor's phone. Pick the right one to avoid creating a duplicate, or create a new vendor."
              : "No existing Zoho vendor matched this editor's phone. Create a new vendor to continue."}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={choice} onValueChange={setChoice} className="space-y-2 py-2">
          {candidates.map((c) => (
            <Label
              key={c.contact_id}
              htmlFor={c.contact_id}
              className="flex items-start gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem value={c.contact_id} id={c.contact_id} className="mt-0.5" />
              <div className="min-w-0">
                <div className="font-medium text-sm">{c.contact_name}{c.company_name ? ` · ${c.company_name}` : ""}</div>
                <div className="text-xs text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No phone/email on record"}
                </div>
              </div>
            </Label>
          ))}
          <Label
            htmlFor={CREATE_NEW}
            className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 p-3 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <RadioGroupItem value={CREATE_NEW} id={CREATE_NEW} />
            <span className="font-medium text-sm">Create a new vendor</span>
          </Label>
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={confirm} disabled={submitting} className="gap-1.5">
            {submitting ? <ButtonOrb state="composing" onFilled /> : null}
            {choice === CREATE_NEW ? "Create & send" : "Link & send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

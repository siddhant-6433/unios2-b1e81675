import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle2, Loader2, Upload } from "lucide-react";

export interface UpdeledRegisterTarget {
  lead_id: string;
  lead_name: string;
  phone?: string | null;
  course_name?: string | null;
}

interface Props {
  target: UpdeledRegisterTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

interface UpdeledRegistrationRpc {
  rpc(
    functionName: "updeled_mark_registered",
    args: {
      p_lead_id: string;
      p_registration_no: string;
      p_document_url: string | null;
      p_notes: string | null;
    },
  ): Promise<{ error: { message: string } | null }>;
}

const updeledRpc = supabase as unknown as UpdeledRegistrationRpc;

export function UpdeledRegisterDialog({ target, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [regNo, setRegNo] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const regInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (target) {
      setRegNo("");
      setNotes("");
      setFile(null);
      setTimeout(() => regInputRef.current?.focus(), 50);
    }
  }, [target]);

  if (!target) return null;

  const submit = async () => {
    const trimmed = regNo.trim();
    if (!trimmed) {
      toast({ title: "Registration number is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    let documentPath: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${target.lead_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("updeled-registrations")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) {
        toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      documentPath = path;
    }

    const { error } = await updeledRpc.rpc("updeled_mark_registered", {
      p_lead_id: target.lead_id,
      p_registration_no: trimmed,
      p_document_url: documentPath,
      p_notes: notes.trim() || null,
    });
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({ title: "UPDELED registration recorded", description: `${target.lead_name} · ${trimmed}` });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark UPDELED registration</DialogTitle>
          <DialogDescription>
            {target.lead_name}
            {target.course_name ? ` · ${target.course_name}` : ""}
            {target.phone ? ` · ${target.phone}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="updeled-reg-no">
              UPDELED registration no. <span className="text-destructive">*</span>
            </Label>
            <Input
              id="updeled-reg-no"
              ref={regInputRef}
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              placeholder="e.g. UPDELED-2026-12345"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="updeled-doc">Registration screenshot / PDF (optional)</Label>
            <Input
              id="updeled-doc"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Upload className="h-3 w-3" />
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="updeled-notes">Notes (optional)</Label>
            <Textarea
              id="updeled-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything to flag for follow-up"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-primary hover:bg-primary/60">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
            )}
            Mark Registered
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

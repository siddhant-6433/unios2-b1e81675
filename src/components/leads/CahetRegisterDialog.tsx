import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle2, Upload } from "lucide-react";
import { isBptOrBmritCourseName } from "@/lib/cahet";

export interface CahetRegisterTarget {
  lead_id: string;
  lead_name: string;
  phone?: string | null;
  course_name?: string | null;
}

interface Props {
  target: CahetRegisterTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CahetRegisterDialog({ target, onClose, onSaved }: Props) {
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
  }, [target?.lead_id]);

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
        .from("cahet-registrations")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) {
        toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      documentPath = path;
    }

    const { error } = await supabase.rpc("cahet_mark_registered", {
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

    toast({ title: "CAHET registration recorded", description: `${target.lead_name} · ${trimmed}` });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark CAHET registration</DialogTitle>
          <DialogDescription>
            {target.lead_name}
            {target.course_name ? ` · ${target.course_name}` : ""}
            {target.phone ? ` · ${target.phone}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cahet-reg-no">
              CAHET registration no. <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cahet-reg-no"
              ref={regInputRef}
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              placeholder="e.g. CAHET-2026-12345"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cahet-doc">Registration screenshot / PDF (optional)</Label>
            <Input
              id="cahet-doc"
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
            <Label htmlFor="cahet-notes">Notes (optional)</Label>
            <Textarea
              id="cahet-notes"
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
          <Button onClick={submit} disabled={saving} className="bg-destructive hover:bg-destructive">
            {saving ? (
              <ButtonOrb state="working" onFilled />
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

/** Client-side BPT/BMRIT detection by course name (avoids extra DB call in dialer). */
export function isBptOrBmritCourse(courseName: string | null | undefined): boolean {
  return isBptOrBmritCourseName(courseName);
}

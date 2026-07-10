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
import { CheckCircle2, Loader2, Upload, XCircle, HelpCircle } from "lucide-react";
import {
  type ExamCode,
  type ExamRegistrationStatus,
  EXAM_DISPLAY_NAMES,
  EXAM_SHORT_LABELS,
} from "@/lib/examRegistration";

export interface ExamRegisterTarget {
  lead_id: string;
  lead_name: string;
  exam_code: ExamCode;
  phone?: string | null;
  course_name?: string | null;
}

interface Props {
  target: ExamRegisterTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Generic "record entrance-exam registration" dialog. Replaces the
 * per-exam CahetRegisterDialog / UpdeledRegisterDialog — driven entirely by
 * target.exam_code. Lets staff capture a registration number (+ optional
 * doc), or record that the candidate is NOT registered / status Unknown.
 */
export function ExamRegisterDialog({ target, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [regNo, setRegNo] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState<null | "registered" | ExamRegistrationStatus>(null);
  const regInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (target) {
      setRegNo("");
      setNotes("");
      setFile(null);
      setTimeout(() => regInputRef.current?.focus(), 50);
    }
  }, [target?.lead_id, target?.exam_code]);

  if (!target) return null;

  const examLabel = EXAM_SHORT_LABELS[target.exam_code];
  const examFullName = EXAM_DISPLAY_NAMES[target.exam_code];

  const saveRegistered = async () => {
    const trimmed = regNo.trim();
    if (!trimmed) {
      toast({ title: "Registration number is required", variant: "destructive" });
      return;
    }
    setSaving("registered");

    let documentPath: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${target.lead_id}/${target.exam_code}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("exam-registrations")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) {
        toast({ title: "Upload failed", description: upErr.message, variant: "destructive" });
        setSaving(null);
        return;
      }
      documentPath = path;
    }

    const { error } = await supabase.rpc("exam_mark_registered" as any, {
      p_lead_id: target.lead_id,
      p_exam_code: target.exam_code,
      p_registration_no: trimmed,
      p_document_url: documentPath,
      p_notes: notes.trim() || null,
    });
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      setSaving(null);
      return;
    }
    toast({ title: `${examLabel} registration recorded`, description: `${target.lead_name} · ${trimmed}` });
    setSaving(null);
    onSaved();
  };

  const setStatus = async (status: ExamRegistrationStatus, successMsg: string) => {
    setSaving(status);
    const { error } = await supabase.rpc("exam_set_status" as any, {
      p_lead_id: target.lead_id,
      p_exam_code: target.exam_code,
      p_status: status,
      p_notes: notes.trim() || null,
    });
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      setSaving(null);
      return;
    }
    toast({ title: successMsg, description: target.lead_name });
    setSaving(null);
    onSaved();
  };

  const busy = saving !== null;

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record {examLabel} registration</DialogTitle>
          <DialogDescription>
            {examFullName}
            <br />
            {target.lead_name}
            {target.course_name ? ` · ${target.course_name}` : ""}
            {target.phone ? ` · ${target.phone}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="exam-reg-no">
              {examLabel} registration no.
            </Label>
            <Input
              id="exam-reg-no"
              ref={regInputRef}
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              placeholder={`e.g. ${examLabel}-2026-12345`}
              onKeyDown={(e) => { if (e.key === "Enter") saveRegistered(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exam-doc">Registration screenshot / PDF (optional)</Label>
            <Input
              id="exam-doc"
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
            <Label htmlFor="exam-notes">Notes (optional)</Label>
            <Textarea
              id="exam-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything to flag for follow-up"
            />
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2.5">
            <p className="mb-2 text-xs text-muted-foreground">
              Or record the registration state without a number:
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setStatus("registered_no_number", `${examLabel}: registered, number pending`)}
              >
                {saving === "registered_no_number"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-warning-foreground" />}
                Registered, no number
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setStatus("not_registered", `${examLabel}: marked not registered`)}
              >
                {saving === "not_registered"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <XCircle className="h-3.5 w-3.5 mr-1 text-destructive" />}
                Not registered
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setStatus("unknown", `${examLabel}: reset to unknown`)}
              >
                {saving === "unknown"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <HelpCircle className="h-3.5 w-3.5 mr-1 text-muted-foreground" />}
                Unknown
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={saveRegistered} disabled={busy} className="bg-success hover:bg-success/90">
            {saving === "registered"
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            Mark Registered
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// WalkInDialog — one-form instant walk-in registration. Calls the
// create_walk_in_visit SECURITY DEFINER RPC (dedupes lead by phone, creates
// lead + checked-in campus_visits + activity atomically). On success it offers
// an immediate "Send token payment link" (the token-at-visit moment).

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { SendPaymentLinkDialog } from "@/components/finance/SendPaymentLinkDialog";
import { Footprints, IndianRupee, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

interface Course { id: string; name: string }
interface Campus { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  courses: Course[];
  campuses: Campus[];
  defaultCampusId?: string;
  onRecorded?: () => void;
}

export function WalkInDialog({ open, onOpenChange, courses, campuses, defaultCampusId, onRecorded }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [courseId, setCourseId] = useState("");
  const [campusId, setCampusId] = useState(defaultCampusId || "");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ lead_id: string; visit_id: string; name: string } | null>(null);
  const [showSendLink, setShowSendLink] = useState(false);

  const reset = () => {
    setName(""); setPhone(""); setEmail(""); setCourseId("");
    setCampusId(defaultCampusId || ""); setPurpose(""); setNotes("");
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!phone.trim()) { toast({ title: "Phone is required", variant: "destructive" }); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("create_walk_in_visit" as any, {
      _name: name.trim(),
      _phone: phone.trim(),
      _email: email.trim() || null,
      _course_id: courseId || null,
      _campus_id: campusId || null,
      _purpose: purpose.trim() || null,
      _notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Could not record walk-in", description: error.message, variant: "destructive" });
      return;
    }
    const payload = data as { lead_id: string; visit_id: string };
    setResult({ lead_id: payload.lead_id, visit_id: payload.visit_id, name: name.trim() });
    toast({ title: "Walk-in recorded", description: `${name.trim()} checked in.` });
    onRecorded?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-primary" />
              Record Walk-in
            </DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-foreground">
                <span className="font-semibold">{result.name}</span> is checked in. Collect the token fee now to lock the candidate in.
              </p>
              <div className="flex flex-col gap-2">
                <Button onClick={() => setShowSendLink(true)} className="gap-2">
                  <IndianRupee className="h-4 w-4" /> Send token payment link
                </Button>
                <Link
                  to={`/admissions/${result.lead_id}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  Open candidate <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <FieldShell label="Name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Candidate name" autoFocus />
                </FieldShell>
                <FieldShell label="Phone">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" inputMode="tel" />
                </FieldShell>
              </div>
              <FieldShell label="Email (optional)">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email" />
              </FieldShell>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  value={courseId}
                  onValueChange={setCourseId}
                  options={[{ value: "", label: "Select course" }, ...courses.map((c) => ({ value: c.id, label: c.name }))]}
                  label="Course (optional)"
                  placeholder="Select course"
                />
                <SelectField
                  value={campusId}
                  onValueChange={setCampusId}
                  options={[{ value: "", label: "Select campus" }, ...campuses.map((c) => ({ value: c.id, label: c.name }))]}
                  label="Campus (optional)"
                  placeholder="Select campus"
                />
              </div>
              <FieldShell label="Purpose (optional)">
                <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Campus tour, fee discussion" />
              </FieldShell>
              <TextAreaField value={notes} onValueChange={setNotes} label="Notes (optional)" placeholder="Anything worth capturing" />
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <ButtonOrb state="working" onFilled /> : null}
                  {submitting ? "Recording…" : "Check in"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {result && (
        <SendPaymentLinkDialog
          open={showSendLink}
          onOpenChange={setShowSendLink}
          leadId={result.lead_id}
          defaultPurpose="pre_admission_token"
        />
      )}
    </>
  );
}

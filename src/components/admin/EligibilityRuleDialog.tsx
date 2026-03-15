import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";

export interface EligibilityRuleRow {
  id: string;
  course_id: string;
  min_age: number | null;
  max_age: number | null;
  class_12_min_marks: number | null;
  graduation_min_marks: number | null;
  requires_graduation: boolean;
  entrance_exam_name: string | null;
  entrance_exam_required: boolean;
  subject_prerequisites: string[] | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName: string;
  existingRule?: EligibilityRuleRow | null;
  onSaved: () => void;
}

export default function EligibilityRuleDialog({ open, onOpenChange, courseId, courseName, existingRule, onSaved }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [class12Min, setClass12Min] = useState("");
  const [gradMin, setGradMin] = useState("");
  const [requiresGrad, setRequiresGrad] = useState(false);
  const [examName, setExamName] = useState("");
  const [examRequired, setExamRequired] = useState(false);
  const [subjectPrereqs, setSubjectPrereqs] = useState("");
  const [notes, setNotes] = useState("");
  const [subjectMinMarks, setSubjectMinMarks] = useState<{ subject: string; min: string }[]>([]);

  useEffect(() => {
    if (existingRule) {
      setMinAge(existingRule.min_age?.toString() || "");
      setMaxAge(existingRule.max_age?.toString() || "");
      setClass12Min(existingRule.class_12_min_marks?.toString() || "");
      setGradMin(existingRule.graduation_min_marks?.toString() || "");
      setRequiresGrad(existingRule.requires_graduation);
      setExamName(existingRule.entrance_exam_name || "");
      setExamRequired(existingRule.entrance_exam_required);
      setSubjectPrereqs(existingRule.subject_prerequisites?.join(", ") || "");
      setNotes(existingRule.notes || "");
      // Parse subject_min_marks from existing rule
      const smm = (existingRule as any).subject_min_marks;
      if (smm && typeof smm === 'object') {
        setSubjectMinMarks(Object.entries(smm).map(([subject, min]) => ({ subject, min: String(min) })));
      } else {
        setSubjectMinMarks([]);
      }
    } else {
      setMinAge(""); setMaxAge(""); setClass12Min(""); setGradMin("");
      setRequiresGrad(false); setExamName(""); setExamRequired(false);
      setSubjectPrereqs(""); setNotes(""); setSubjectMinMarks([]);
    }
  }, [existingRule, open]);

  const handleSave = async () => {
    setSaving(true);
    const prereqs = subjectPrereqs
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const payload = {
      course_id: courseId,
      min_age: minAge ? parseInt(minAge) : null,
      max_age: maxAge ? parseInt(maxAge) : null,
      class_12_min_marks: class12Min ? parseFloat(class12Min) : null,
      graduation_min_marks: gradMin ? parseFloat(gradMin) : null,
      requires_graduation: requiresGrad,
      entrance_exam_name: examName || null,
      entrance_exam_required: examRequired,
      subject_prerequisites: prereqs.length > 0 ? prereqs : null,
      notes: notes || null,
      subject_min_marks: subjectMinMarks.length > 0
        ? Object.fromEntries(subjectMinMarks.filter(s => s.subject && s.min).map(s => [s.subject, parseFloat(s.min)]))
        : null,
    };

    const { error } = existingRule
      ? await supabase.from("eligibility_rules").update(payload).eq("id", existingRule.id)
      : await supabase.from("eligibility_rules").insert(payload);

    if (error) {
      toast({ title: "Error saving rule", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Eligibility rule saved" });
      onSaved();
      onOpenChange(false);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Eligibility Rules — {courseName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* Age limits */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Min Age (as of July 31)</Label>
              <Input type="number" value={minAge} onChange={e => setMinAge(e.target.value)} placeholder="e.g. 17" />
            </div>
            <div>
              <Label className="text-xs">Max Age (as of July 31)</Label>
              <Input type="number" value={maxAge} onChange={e => setMaxAge(e.target.value)} placeholder="e.g. 25" />
            </div>
          </div>

          {/* Marks */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Class 12 Min %</Label>
              <Input type="number" value={class12Min} onChange={e => setClass12Min(e.target.value)} placeholder="e.g. 45" />
            </div>
            <div>
              <Label className="text-xs">Graduation Min %</Label>
              <Input type="number" value={gradMin} onChange={e => setGradMin(e.target.value)} placeholder="e.g. 50" />
            </div>
          </div>

          {/* Requires Graduation */}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <Label className="text-xs">Requires completed Graduation (UG)</Label>
            <Switch checked={requiresGrad} onCheckedChange={setRequiresGrad} />
          </div>

          {/* Entrance Exam */}
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <Label className="text-xs">Entrance Exam Required</Label>
              <Switch checked={examRequired} onCheckedChange={setExamRequired} />
            </div>
            {examRequired && (
              <div>
                <Label className="text-xs">Exam Name</Label>
                <Input value={examName} onChange={e => setExamName(e.target.value)} placeholder="e.g. CAT, CTET, CUET" />
              </div>
            )}
          </div>

          {/* Subject Prerequisites */}
          <div>
            <Label className="text-xs">Subject / Stream Prerequisites</Label>
            <Input value={subjectPrereqs} onChange={e => setSubjectPrereqs(e.target.value)} placeholder="e.g. PCM, PCB, Commerce (comma-separated)" />
            <p className="text-[11px] text-muted-foreground mt-1">Comma-separated list of accepted streams/subjects in Class 12</p>
          </div>

          {/* Subject-wise Minimum Marks */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Subject-wise Minimum Marks (Class 12)</Label>
            <p className="text-[11px] text-muted-foreground">e.g. English 40% for GNM</p>
            {subjectMinMarks.map((entry, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input
                    value={entry.subject}
                    onChange={e => {
                      const updated = [...subjectMinMarks];
                      updated[idx] = { ...updated[idx], subject: e.target.value };
                      setSubjectMinMarks(updated);
                    }}
                    placeholder="Subject name (e.g. English)"
                  />
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    value={entry.min}
                    onChange={e => {
                      const updated = [...subjectMinMarks];
                      updated[idx] = { ...updated[idx], min: e.target.value };
                      setSubjectMinMarks(updated);
                    }}
                    placeholder="Min %"
                  />
                </div>
                <Button variant="ghost" size="sm" className="h-10 px-2 text-destructive" onClick={() => setSubjectMinMarks(subjectMinMarks.filter((_, i) => i !== idx))}>✕</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSubjectMinMarks([...subjectMinMarks, { subject: '', min: '' }])} className="text-xs">
              + Add Subject
            </Button>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs">Notes (shown to applicant)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. SC/ST relaxation: 5%" rows={2} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save Rules
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

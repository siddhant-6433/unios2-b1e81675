import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, CloudUpload, CheckCircle2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { DuplicateLeadWarning } from "@/components/admissions/DuplicateLeadWarning";
import { LEAD_SOURCES } from "@/config/leadSources";

interface AddLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /** Resume an existing draft instead of starting blank. */
  resumeDraftId?: string;
  /** Fired after a draft is saved/updated, so the parent can refresh its drafts list. */
  onDraftChange?: () => void;
}

const EMPTY_FORM = {
  name: "", phone: "", email: "", guardian_name: "", guardian_phone: "",
  source: "" as string, course_id: "", campus_id: "", counsellor_id: "", notes: "",
};

export function AddLeadDialog({ open, onOpenChange, onSuccess, resumeDraftId, onDraftChange }: AddLeadDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [counsellors, setCounsellors] = useState<{ id: string; display_name: string }[]>([]);
  const { coursesByDepartment, getCampusesForCourse } = useCourseCampusLink();

  const [form, setForm] = useState(EMPTY_FORM);

  // Autosave state — mirrors AddStudentDialog: draft id is null until first
  // non-empty edit persists, "saving"/"saved" drives the status pill.
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const draftIdRef = useRef<string | null>(null);
  const skipNextAutosave = useRef(false);

  const filteredCampuses = getCampusesForCourse(form.course_id || null);

  // Counsellor list — fetched once on open.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roles || roles.length === 0) { setCounsellors([]); return; }
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("user_id", userIds);
      if (profiles) setCounsellors(profiles.filter((p: any) => p.display_name));
    })();
  }, [open]);

  // On open: reset form, OR load draft if resuming.
  useEffect(() => {
    if (!open) return;
    setDraftStatus("idle");

    if (resumeDraftId) {
      draftIdRef.current = resumeDraftId;
      skipNextAutosave.current = true; // don't immediately re-save what we just loaded
      supabase.from("lead_drafts" as any)
        .select("data")
        .eq("id", resumeDraftId)
        .maybeSingle()
        .then(({ data }: { data: any }) => {
          if (data?.data) setForm(prev => ({ ...prev, ...(data.data as typeof EMPTY_FORM) }));
        });
    } else {
      draftIdRef.current = null;
      setForm(EMPTY_FORM);
    }
  }, [open, resumeDraftId]);

  // Debounced auto-save. Kicks in once the user has typed a name — empty rows
  // would litter the drafts table. Each save is a single upsert; the row id
  // is tracked in a ref so concurrent renders don't race.
  useEffect(() => {
    if (!open) return;
    if (saving) return;
    if (!form.name.trim()) return;
    if (skipNextAutosave.current) { skipNextAutosave.current = false; return; }

    const handle = setTimeout(async () => {
      if (!user?.id) return;
      setDraftStatus("saving");
      const courseEntry = coursesByDepartment.flatMap(g => g.courses).find(c => c.id === form.course_id);
      const payload = {
        created_by: user.id,
        data: form,
        display_name: form.name.trim() || null,
        phone: form.phone.trim() || null,
        course_name: courseEntry?.name || null,
      };
      const existing = draftIdRef.current;
      if (existing) {
        const { error } = await supabase.from("lead_drafts" as any).update(payload).eq("id", existing);
        if (error) { setDraftStatus("idle"); console.error("[lead-draft] update", error); return; }
      } else {
        const { data, error } = await supabase.from("lead_drafts" as any).insert(payload).select("id").single();
        if (error) { setDraftStatus("idle"); console.error("[lead-draft] insert", error); return; }
        draftIdRef.current = (data as any).id;
      }
      setDraftStatus("saved");
      onDraftChange?.();
    }, 800);

    return () => clearTimeout(handle);
  }, [form, open, user?.id, coursesByDepartment, saving, onDraftChange]);

  // Auto-select campus when course changes
  const handleCourseChange = (courseId: string) => {
    const campuses = getCampusesForCourse(courseId || null);
    setForm(p => ({ ...p, course_id: courseId, campus_id: campuses.length === 1 ? campuses[0].id : "" }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.source) {
      toast({ title: "Required", description: "Name, phone and source are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Use RPC to bypass RLS on RETURNING (counsellor may not have SELECT on the new row)
    const { data: newId, error } = await supabase.rpc("insert_lead" as any, {
      _name: form.name.trim(),
      _phone: form.phone.trim(),
      _email: form.email.trim() || null,
      _guardian_name: form.guardian_name.trim() || null,
      _guardian_phone: form.guardian_phone.trim() || null,
      _source: form.source || "website",
      _course_id: form.course_id || null,
      _campus_id: form.campus_id || null,
      _counsellor_id: form.counsellor_id || null,
      _notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    const leadId = newId as string;
    if (leadId) {
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        type: "lead_created",
        description: `Lead created via manual entry`,
        user_id: user?.id || null,
      });
    }
    // Mark draft completed so it disappears from the drafts panel.
    if (draftIdRef.current) {
      await supabase.from("lead_drafts" as any)
        .update({ completed_at: new Date().toISOString() })
        .eq("id", draftIdRef.current);
      onDraftChange?.();
      draftIdRef.current = null;
    }
    toast({ title: "Lead added" });
    setForm(EMPTY_FORM);
    onOpenChange(false);
    onSuccess();
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Add New Lead</span>
            {/* Autosave status pill — silent unless something is saving or saved. */}
            {draftStatus !== "idle" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
                {draftStatus === "saving" ? (
                  <><CloudUpload className="h-3 w-3 animate-pulse" />Saving draft…</>
                ) : (
                  <><CheckCircle2 className="h-3 w-3 text-emerald-600" />Draft saved</>
                )}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Student name" className={inputCls} />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
              <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} required />
            </div>
          </div>
          <DuplicateLeadWarning phone={form.phone} />
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Guardian Name</label>
              <input value={form.guardian_name} onChange={e => setForm(p => ({ ...p, guardian_name: e.target.value }))} className={inputCls} />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Guardian Phone</label>
              <PhoneInput value={form.guardian_phone} onChange={phone => setForm(p => ({ ...p, guardian_phone: phone }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Source <span className="text-destructive">*</span></label>
              <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))} className={`${inputCls} ${!form.source ? "text-muted-foreground" : ""}`}>
                <option value="">Select source *</option>
                {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course</label>
              <select value={form.course_id} onChange={e => handleCourseChange(e.target.value)} className={inputCls}>
                <option value="">Select course</option>
                {coursesByDepartment.map(g => (
                  <optgroup key={g.department} label={g.department}>
                    {g.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
              <select
                value={form.campus_id}
                onChange={e => setForm(p => ({ ...p, campus_id: e.target.value }))}
                className={inputCls}
                disabled={filteredCampuses.length <= 1}
              >
                {!form.course_id ? (
                  <option value="">Select course first</option>
                ) : filteredCampuses.length === 1 ? (
                  <option value={filteredCampuses[0].id}>{filteredCampuses[0].name}</option>
                ) : (
                  <>
                    <option value="">Select campus</option>
                    {filteredCampuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Counsellor</label>
              <select value={form.counsellor_id} onChange={e => setForm(p => ({ ...p, counsellor_id: e.target.value }))} className={inputCls}>
                <option value="">Unassigned</option>
                {counsellors.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

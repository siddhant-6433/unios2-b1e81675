import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TextField, SelectField, TextAreaField } from "@/components/ui/state-fields";
import { Loader2, Plus, CloudUpload, CheckCircle2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { DuplicateLeadWarning } from "@/components/admissions/DuplicateLeadWarning";
import { LEAD_SOURCES } from "@/config/leadSources";
import { isBscNursingCourse } from "@/lib/bscNursing";
import { isBptOrBmritCourseName } from "@/lib/cahet";

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
  source: "" as string, course_id: "", campus_id: "", counsellor_id: "", consultant_id: "", notes: "",
  cnet_appeared: "" as "" | "yes" | "no",
  cahet_registered: "" as "" | "yes" | "no",
};

export function AddLeadDialog({ open, onOpenChange, onSuccess, resumeDraftId, onDraftChange }: AddLeadDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [counsellors, setCounsellors] = useState<{ id: string; display_name: string }[]>([]);
  const [consultants, setConsultants] = useState<{ id: string; name: string; organization: string | null }[]>([]);
  const { coursesByDepartment, getCampusesForCourse } = useCourseCampusLink();

  const [form, setForm] = useState(EMPTY_FORM);

  // Autosave state — mirrors AddStudentDialog: draft id is null until first
  // non-empty edit persists, "saving"/"saved" drives the status pill.
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const draftIdRef = useRef<string | null>(null);
  const skipNextAutosave = useRef(false);

  const filteredCampuses = getCampusesForCourse(form.course_id || null);
  const courseChoices = useMemo(
    () => coursesByDepartment.flatMap(g => g.courses ?? []),
    [coursesByDepartment],
  );
  const selectedCourse = courseChoices.find(c => c.id === form.course_id);
  const asksCnetAppeared = isBscNursingCourse(selectedCourse || null);
  const asksCahetRegistered = isBptOrBmritCourseName(selectedCourse?.name);

  // Counsellor list — fetched once on open.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "counsellor");
      if (!roles || roles.length === 0) { setCounsellors([]); return; }
      const userIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("user_id", userIds).eq("login_disabled", false);
      if (profiles) setCounsellors(profiles.filter((p: any) => p.display_name));
    })();
  }, [open]);

  // Consultants list — only loaded when the dialog opens; powers the optional
  // "Consultant" select shown when Source = 'consultant'.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("consultants")
        .select("id, name, organization, stage")
        .neq("stage", "inactive")
        .order("name", { ascending: true });
      if (data) setConsultants(data.map(({ id, name, organization }: any) => ({ id, name, organization })));
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
      const courseEntry = courseChoices.find(c => c.id === form.course_id);
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
  }, [form, open, user?.id, courseChoices, saving, onDraftChange]);

  // Auto-select campus when course changes
  const handleCourseChange = (courseId: string) => {
    const campuses = getCampusesForCourse(courseId || null);
    const course = courseChoices.find(c => c.id === courseId);
    setForm(p => ({
      ...p,
      course_id: courseId,
      campus_id: campuses.length === 1 ? campuses[0].id : "",
      cnet_appeared: isBscNursingCourse(course || null) ? p.cnet_appeared : "",
      cahet_registered: isBptOrBmritCourseName(course?.name) ? p.cahet_registered : "",
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.source) {
      toast({ title: "Required", description: "Name, phone and source are required", variant: "destructive" });
      return;
    }
    if (asksCnetAppeared && !form.cnet_appeared) {
      toast({ title: "Required", description: "Please mark whether the B.Sc Nursing lead appeared for CNET", variant: "destructive" });
      return;
    }
    if (asksCahetRegistered && !form.cahet_registered) {
      toast({ title: "Required", description: "Please mark whether the BPT/BMRIT lead registered for CAHET", variant: "destructive" });
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
      _consultant_id: form.source === "consultant" ? (form.consultant_id || null) : null,
      _cnet_appeared: asksCnetAppeared ? form.cnet_appeared === "yes" : null,
      _cahet_registered: asksCahetRegistered ? form.cahet_registered === "yes" : null,
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
                  <><CheckCircle2 className="h-3 w-3 text-success" />Draft saved</>
                )}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              value={form.name}
              onValueChange={value => setForm(p => ({ ...p, name: value }))}
              label="Name"
              required
              placeholder="Student name"
            />
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
              <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} required />
            </div>
          </div>
          <DuplicateLeadWarning phone={form.phone} />
          <TextField
            value={form.email}
            onValueChange={value => setForm(p => ({ ...p, email: value }))}
            label="Email"
            type="email"
            placeholder="email@example.com"
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              value={form.guardian_name}
              onValueChange={value => setForm(p => ({ ...p, guardian_name: value }))}
              label="Guardian Name"
            />
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Guardian Phone</label>
              <PhoneInput value={form.guardian_phone} onChange={phone => setForm(p => ({ ...p, guardian_phone: phone }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              value={form.source}
              onValueChange={value => setForm(p => ({
                ...p,
                source: value,
                consultant_id: value === "consultant" ? p.consultant_id : "",
              }))}
              options={LEAD_SOURCES.map(s => ({ value: s.value, label: s.label }))}
              label="Source"
              required
              placeholder="Select source"
            />
            <SelectField
              value={form.course_id}
              onValueChange={handleCourseChange}
              groups={coursesByDepartment.map(g => ({
                label: g.department,
                options: (g.courses ?? []).map(c => ({ value: c.id, label: c.name })),
              }))}
              label="Course"
              placeholder="Select course"
            />
          </div>
          {asksCnetAppeared && (
            <div className="rounded-xl border border-info/20 bg-info/5/60 p-3 dark:border-info/60/50 dark:bg-info/90/20">
              <label className="block text-[11px] font-medium text-info-foreground dark:text-info/40 mb-2">
                CNET appeared? <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, cnet_appeared: value }))}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      form.cnet_appeared === value
                        ? "border-info/40 bg-info text-white"
                        : "border-info/20 bg-background text-foreground hover:bg-info/5 dark:border-info/60"
                    }`}
                  >
                    {value === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {asksCahetRegistered && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5/60 p-3 dark:border-destructive/60/50 dark:bg-destructive/90/20">
              <label className="block text-[11px] font-medium text-destructive dark:text-destructive/40 mb-2">
                Registered for CAHET? <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, cahet_registered: value }))}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      form.cahet_registered === value
                        ? "border-destructive/40 bg-destructive text-white"
                        : "border-destructive/20 bg-background text-foreground hover:bg-destructive/5 dark:border-destructive/60"
                    }`}
                  >
                    {value === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              value={form.campus_id}
              onValueChange={value => setForm(p => ({ ...p, campus_id: value }))}
              options={
                !form.course_id
                  ? [{ value: "", label: "Select course first" }]
                  : filteredCampuses.length === 1
                    ? [{ value: filteredCampuses[0].id, label: filteredCampuses[0].name }]
                    : [
                        { value: "", label: "Select campus" },
                        ...filteredCampuses.map(c => ({ value: c.id, label: c.name })),
                      ]
              }
              label="Campus"
              disabled={filteredCampuses.length <= 1}
              allowEmpty={false}
            />
            <SelectField
              value={form.counsellor_id}
              onValueChange={value => setForm(p => ({ ...p, counsellor_id: value }))}
              options={[
                { value: "", label: "Unassigned" },
                ...counsellors.map(c => ({ value: c.id, label: c.display_name })),
              ]}
              label="Counsellor"
              placeholder="Unassigned"
            />
          </div>
          {form.source === "consultant" && (
            <SelectField
              value={form.consultant_id}
              onValueChange={value => setForm(p => ({ ...p, consultant_id: value }))}
              options={[
                { value: "", label: "Select consultant (optional)" },
                ...consultants.map(c => ({
                  value: c.id,
                  label: c.organization ? `${c.name} — ${c.organization}` : c.name,
                })),
              ]}
              label="Consultant"
              placeholder="Select consultant"
            />
          )}
          <TextAreaField
            value={form.notes}
            onValueChange={value => setForm(p => ({ ...p, notes: value }))}
            label="Notes"
            rows={2}
          />
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

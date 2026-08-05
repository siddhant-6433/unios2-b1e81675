import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TextField, SelectField, DatePickerField } from "@/components/ui/state-fields";
import { Loader2, UserPlus, School, Users, Banknote, ChevronRight, ChevronLeft, Save } from "lucide-react";
import { SCHOOL_SESSION_YEARS, isSchoolSessionYear, sessionYearLabel } from "@/lib/sessionYears";

interface Campus      { id: string; name: string; code: string; }
interface Institution { id: string; name: string; code: string; type: string; }
interface Course      { id: string; name: string; code: string; }
interface Session     { id: string; name: string; }

interface AddStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /** Pre-select a campus. */
  defaultCampusId?: string;
  /** Resume an existing draft instead of starting blank. */
  resumeDraftId?: string | null;
  /** Fired after a draft is saved/updated, so the parent can refresh its list. */
  onDraftChange?: () => void;
}

type FeeVersion = "new_admission" | "existing_parent" | "standard" | "stetho_batch";
type StudentInsert = Database["public"]["Tables"]["students"]["Insert"];
type StudentForm = {
  name: string;
  dob: string;
  gender: string;
  campus_id: string;
  institution_id: string;
  course_id: string;
  session_id: string;
  joining_academic_year: string;
  semester: string;
  section: string;
  class_roll_no: string;
  student_type: string;
  school_admission_no: string;
  father_name: string;
  father_phone: string;
  mother_name: string;
  mother_phone: string;
  admission_date: string;
  fee_version: FeeVersion;
};

// School grade suffix → readable label
const GRADE_LABELS: Record<string, string> = {
  TOD: "Toddler", NUR: "Nursery", LKG: "LKG", UKG: "UKG",
  G1: "Grade I",   G2: "Grade II",   G3: "Grade III",  G4: "Grade IV",
  G5: "Grade V",   G6: "Grade VI",   G7: "Grade VII",  G8: "Grade VIII",
  G9: "Grade IX",  G10: "Grade X",   G11: "Grade XI",  G12: "Grade XII",
};

function isSchoolInstitution(inst: Institution | null) {
  if (!inst) return false;
  return inst.type === "school" ||
    /bsa|bsav|mirai|beacon/i.test(inst.code) ||
    /school/i.test(inst.name);
}

function courseLabel(c: Course) {
  const suffix = c.code.split("-").pop() || "";
  return GRADE_LABELS[suffix] ? `${GRADE_LABELS[suffix]} (${c.code})` : c.name;
}

function isDaottCourse(course: Course | null) {
  return course ? ["DAOTT-GN", "OTT-GN"].includes(course.code) : false;
}

const STEPS = ["Student Details", "Parent / Guardian", "Programme & Session"];
const HIGHER_ED_TERMS = [
  "Sem 1", "Sem 2", "Sem 3", "Sem 4", "Sem 5", "Sem 6", "Sem 7", "Sem 8", "Sem 9", "Sem 10",
  "Year 1", "Year 2", "Year 3", "Year 4", "Year 5",
];

export function AddStudentDialog({ open, onOpenChange, onSuccess, defaultCampusId, resumeDraftId, onDraftChange }: AddStudentDialogProps) {
  const { user, role, profile } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [allCampuses,   setAllCampuses]   = useState<Campus[]>([]);
  const [campusesLoaded, setCampusesLoaded] = useState(false);
  const [institutions,  setInstitutions]  = useState<Institution[]>([]);
  const [courses,       setCourses]       = useState<Course[]>([]);
  const [sessions,      setSessions]      = useState<Session[]>([]);

  // Draft state — id is null until first auto-save persists; "saving" / "saved"
  // surfaces a small status pill in the header so the user knows the form's safe.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const draftIdRef = useRef<string | null>(null);
  const skipNextAutosave = useRef(false);

  const [form, setForm] = useState<StudentForm>({
    name: "", dob: "", gender: "", campus_id: defaultCampusId || "",
    institution_id: "", course_id: "", session_id: "",
    joining_academic_year: "", semester: "",
    section: "", class_roll_no: "", student_type: "day_scholar",
    school_admission_no: "",                // existing no from previous system
    father_name: "", father_phone: "",
    mother_name: "", mother_phone: "",
    admission_date: new Date().toISOString().slice(0, 10),
    fee_version: "standard" as FeeVersion,
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // A student added here with no lead_id is cut off from the lead-scoped money:
  // offer waivers hang off the lead's offer letter and payments are applied by
  // provision_student_fees(lead_id). One real admission lost ₹27,000 of payments
  // and a ₹10,000 waiver that way. So: look the phone up, and when the matched
  // lead is holding money, make linking an explicit decision before saving.
  const [leadMatch, setLeadMatch] = useState<
    { id: string; name: string; stage: string; paid: number; waived: number } | null
  >(null);
  const [linkLeadId, setLinkLeadId] = useState<string | null>(null);
  const [ignoreLead, setIgnoreLead] = useState(false);

  useEffect(() => {
    const digits = form.father_phone.replace(/\D/g, "").slice(-10);
    if (digits.length < 10) { setLeadMatch(null); setLinkLeadId(null); setIgnoreLead(false); return; }

    let cancelled = false;
    (async () => {
      const { data: leads } = await (supabase as any)
        .from("leads")
        .select("id, name, stage")
        .or([`phone.eq.${digits}`, `phone.eq.+91${digits}`, `phone.eq.91${digits}`].join(","))
        .limit(5);
      if (cancelled || !leads?.length) { setLeadMatch(null); return; }

      // Skip leads that already have a student — those are not this admission.
      const { data: taken } = await (supabase as any)
        .from("students").select("lead_id").in("lead_id", leads.map((l: any) => l.id));
      const takenIds = new Set((taken || []).map((t: any) => t.lead_id));
      const free = leads.filter((l: any) => !takenIds.has(l.id));
      if (cancelled || !free.length) { setLeadMatch(null); return; }

      const ids = free.map((l: any) => l.id);
      const [{ data: pays }, { data: offers }] = await Promise.all([
        (supabase as any).from("lead_payments").select("lead_id, amount").in("lead_id", ids).eq("status", "confirmed"),
        (supabase as any).from("offer_letters").select("id, lead_id").in("lead_id", ids).eq("approval_status", "approved"),
      ]);
      let waivers: any[] = [];
      if (offers?.length) {
        const { data } = await (supabase as any)
          .from("offer_waivers").select("offer_letter_id, amount")
          .in("offer_letter_id", offers.map((o: any) => o.id)).eq("status", "approved");
        waivers = data || [];
      }
      if (cancelled) return;

      const scored = free.map((l: any) => {
        const paid = (pays || []).filter((p: any) => p.lead_id === l.id)
          .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
        const offerIds = (offers || []).filter((o: any) => o.lead_id === l.id).map((o: any) => o.id);
        const waived = waivers.filter((w: any) => offerIds.includes(w.offer_letter_id))
          .reduce((s: number, w: any) => s + Number(w.amount || 0), 0);
        return { id: l.id, name: l.name, stage: l.stage, paid, waived };
      }).sort((a, b) => (b.paid + b.waived) - (a.paid + a.waived));

      setLeadMatch(scored[0]);
    })();
    return () => { cancelled = true; };
  }, [form.father_phone]);

  // Money on the matched lead ⇒ the choice can't be skipped.
  const leadHasMoney = !!leadMatch && (leadMatch.paid > 0 || leadMatch.waived > 0);
  const leadDecisionPending = leadHasMoney && !linkLeadId && !ignoreLead;

  // Office assistants and principals may add students only for their OWN assigned
  // campus (the students INSERT RLS policy enforces user_can_access_assigned_campus).
  // Restrict the picker so a scoped user can't pick a campus the DB would reject
  // with a 42501. Other roles (admin / admission_head / counsellor / ...) keep the
  // full list.
  const isCampusScoped = role === "office_assistant" || role === "school_coordinator" || role === "principal";
  const assignedCampusNames = useMemo(
    () => (profile?.campus || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    [profile?.campus],
  );
  const allowedCampuses = useMemo(
    () =>
      isCampusScoped
        ? allCampuses.filter(
            (c) =>
              assignedCampusNames.includes(c.name.toLowerCase()) ||
              assignedCampusNames.includes((c.code || "").toLowerCase()),
          )
        : allCampuses,
    [allCampuses, assignedCampusNames, isCampusScoped],
  );
  const noCampusAssigned = isCampusScoped && campusesLoaded && allowedCampuses.length === 0;
  const campusLocked = isCampusScoped && allowedCampuses.length === 1;

  // On open: reset + load campuses & sessions, OR load a draft if resuming.
  useEffect(() => {
    if (!open) return;

    // Reset transient state regardless of mode.
    setStep(0);
    setDraftStatus("idle");
    setCampusesLoaded(false);
    setLeadMatch(null);
    setLinkLeadId(null);
    setIgnoreLead(false);

    Promise.all([
      supabase.from("campuses").select("id, name, code").order("name"),
      supabase.from("admission_sessions").select("id, name").eq("is_active", true).order("start_date"),
    ]).then(([cam, ses]) => {
      if (cam.data) setAllCampuses(cam.data);
      setCampusesLoaded(true);
      if (ses.data) {
        const schoolSessions = ses.data.filter((session) => isSchoolSessionYear(session.name));
        setSessions(schoolSessions);
        if (schoolSessions.length === 1 && !resumeDraftId) set("session_id", schoolSessions[0].id);
      }
    });

    if (resumeDraftId) {
      // Resume mode — load saved snapshot.
      draftIdRef.current = resumeDraftId;
      setDraftId(resumeDraftId);
      skipNextAutosave.current = true; // don't immediately re-save what we just loaded
      supabase.from("student_drafts")
        .select("data, step")
        .eq("id", resumeDraftId)
        .maybeSingle()
        .then(({ data }) => {
          const draftData = data?.data;
          if (draftData && typeof draftData === "object" && !Array.isArray(draftData)) {
            setForm(prev => ({ ...prev, ...(draftData as Partial<StudentForm>) }));
          }
          if (typeof data?.step === "number") setStep(data.step);
        });
    } else {
      // Fresh dialog — clear any prior draft id and reset the form.
      draftIdRef.current = null;
      setDraftId(null);
      setForm(f => ({
        ...f, name: "", dob: "", gender: "", institution_id: "", course_id: "",
        joining_academic_year: "", semester: "", section: "", class_roll_no: "", school_admission_no: "",
        father_name: "", father_phone: "", mother_name: "", mother_phone: "",
        fee_version: "standard",
        campus_id: defaultCampusId || f.campus_id,
      }));
    }
  }, [open, defaultCampusId, resumeDraftId]);

  // Debounced auto-save. Only kicks in once the user has typed a name — we
  // don't want to litter the drafts table with empty rows. Each save is a
  // single upsert; the row id is tracked in a ref so concurrent renders don't
  // race.
  useEffect(() => {
    if (!open) return;
    if (saving) return;
    if (!form.name.trim()) return;
    if (skipNextAutosave.current) { skipNextAutosave.current = false; return; }

    const handle = setTimeout(async () => {
      if (!user?.id) return;
      setDraftStatus("saving");
      const campus = allCampuses.find(c => c.id === form.campus_id);
      const course = courses.find(c => c.id === form.course_id);
      const payload = {
        created_by: user.id,
        data: form,
        display_name: form.name.trim() || null,
        campus_name: campus?.name || null,
        course_name: course ? courseLabel(course) : null,
        step,
      };
      const existing = draftIdRef.current;
      if (existing) {
        const { error } = await supabase.from("student_drafts").update(payload).eq("id", existing);
        if (error) { setDraftStatus("idle"); console.error("[draft] update", error); return; }
      } else {
        const { data, error } = await supabase.from("student_drafts").insert(payload).select("id").single();
        if (error) { setDraftStatus("idle"); console.error("[draft] insert", error); return; }
        draftIdRef.current = data.id;
        setDraftId(data.id);
      }
      setDraftStatus("saved");
      onDraftChange?.();
    }, 800);

    return () => clearTimeout(handle);
  }, [form, step, open, user?.id, allCampuses, courses, saving, onDraftChange]);

  // Campus changed → load institutions
  useEffect(() => {
    if (!form.campus_id) { setInstitutions([]); setCourses([]); return; }
    setForm(f => ({ ...f, institution_id: "", course_id: "" }));
    supabase.from("institutions").select("id, name, code, type")
      .eq("campus_id", form.campus_id).order("name")
      .then(({ data }) => setInstitutions(data || []));
  }, [form.campus_id]);

  // Institution changed → load courses via departments
  useEffect(() => {
    if (!form.institution_id) { setCourses([]); return; }
    setForm(f => ({ ...f, course_id: "" }));

    const inst = institutions.find(i => i.id === form.institution_id) || null;
    const isSchool = isSchoolInstitution(inst);

    // Set fee_version default based on institution type
    setForm(f => ({ ...f, fee_version: isSchool ? "new_admission" : "standard" }));

    supabase.from("courses")
      .select("id, name, code, departments!inner(institution_id)")
      .eq("departments.institution_id", form.institution_id)
      .order("code")
      .then(({ data }) => setCourses((data || []).map(c => ({ id: c.id, name: c.name, code: c.code }))));
  }, [form.institution_id, institutions]);

  const selectedInstitution = institutions.find(i => i.id === form.institution_id) || null;
  const selectedCourse = courses.find(c => c.id === form.course_id) || null;
  const isSchool = isSchoolInstitution(selectedInstitution);
  const selectedSession = sessions.find(s => s.id === form.session_id) || null;

  // Auto-switch to existing_parent when admission no entered (school only)
  useEffect(() => {
    if (form.school_admission_no.trim() && selectedInstitution && isSchoolInstitution(selectedInstitution)) {
      setForm(f => ({ ...f, fee_version: "existing_parent" }));
    }
  }, [form.school_admission_no, selectedInstitution]);

  useEffect(() => {
    if (isDaottCourse(selectedCourse)) {
      setForm(f => ({ ...f, fee_version: "stetho_batch" }));
    }
  }, [selectedCourse]);

  useEffect(() => {
    if (isSchool) {
      setForm(f => ({
        ...f,
        joining_academic_year: sessionYearLabel(selectedSession?.name),
        semester: "",
      }));
    } else {
      setForm(f => ({ ...f, joining_academic_year: "" }));
    }
  }, [isSchool, selectedSession?.name]);

  // Keep a scoped user's campus selection within what the INSERT policy allows:
  // pin to their one allowed campus, or clear it entirely if none is assigned
  // (e.g. a draft carried a campus the user can't write to).
  useEffect(() => {
    if (!open || !isCampusScoped) return;
    if (campusLocked && form.campus_id !== allowedCampuses[0].id) {
      set("campus_id", allowedCampuses[0].id);
    } else if (noCampusAssigned && form.campus_id) {
      set("campus_id", "");
    }
  }, [open, isCampusScoped, campusLocked, noCampusAssigned, allowedCampuses, form.campus_id]);

  const step0Valid = !!form.name && !!form.dob && !!form.gender && !!form.campus_id && !!form.institution_id && !!form.course_id;
  // leadDecisionPending: a phone-matched lead is holding money and nobody has
  // said whether it's the same candidate. Saving blind is how the money gets lost.
  const canSubmit  = step0Valid && !!form.session_id && !leadDecisionPending
    && (isSchool ? !!form.admission_date && !!form.joining_academic_year : !!form.semester);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);

    const pan = form.school_admission_no.trim()
      ? null
      : `PAN-${Date.now().toString(36).toUpperCase()}`;

    const student: StudentInsert = {
      name: form.name.trim(),
      dob:  form.dob  || null,
      gender: form.gender ? form.gender.toLowerCase() : null,
      course_id:  form.course_id,
      campus_id:  form.campus_id,
      session_id: form.session_id || null,
      joining_academic_year: isSchool ? form.joining_academic_year || selectedSession?.name || null : null,
      semester: !isSchool ? form.semester || null : null,
      admission_date: form.admission_date || null,
      admission_no: form.school_admission_no.trim() || null,
      pre_admission_no: pan,
      section: form.section || null,
      class_roll_no: form.class_roll_no || null,
      student_type:  form.student_type,
      school_admission_no: form.school_admission_no.trim() || null,
      father_name:  form.father_name.trim()  || null,
      father_phone: form.father_phone.trim() || null,
      mother_name:  form.mother_name.trim()  || null,
      mother_phone: form.mother_phone.trim() || null,
      guardian_name:  form.father_name.trim()  || null,
      guardian_phone: form.father_phone.trim() || null,
      // Carries the candidate's payments and offer waivers onto this ledger.
      lead_id: linkLeadId,
      fee_structure_version: form.fee_version,
      status: "active",
      created_by: user?.id || null,
    };

    const { error } = await supabase.from("students").insert(student);

    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    // Promote the draft to "completed" so it drops out of the drafts list. We
    // keep the row for audit (who created which student from which draft).
    if (draftIdRef.current) {
      await supabase.from("student_drafts")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", draftIdRef.current);
      onDraftChange?.();
    }

    toast({ title: "Student added", description: `${form.name} has been added successfully.` });
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {resumeDraftId ? "Resume Draft" : "Add Student"}
            {draftStatus === "saving" && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving draft…
              </span>
            )}
            {draftStatus === "saved" && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-normal text-success">
                <Save className="h-3 w-3" /> Draft saved
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mt-1 mb-4 flex-wrap">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <button onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  i === step ? "bg-primary text-primary-foreground" :
                  i < step   ? "bg-primary/15 text-primary cursor-pointer" :
                               "bg-muted text-muted-foreground"
                }`}>
                <span>{i + 1}</span> {s}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
            </div>
          ))}
        </div>

        {/* ── Step 0: Student Details ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <School className="h-3.5 w-3.5" /> Student Details
            </div>

            <TextField
              value={form.name}
              onValueChange={value => set("name", value)}
              label="Full Name"
              required
              placeholder="Student's full name"
            />

            <div className="grid grid-cols-2 gap-3">
              <DatePickerField
                value={form.dob}
                onValueChange={value => set("dob", value)}
                label="Date of Birth"
                required
              />
              <SelectField
                value={form.gender}
                onValueChange={value => set("gender", value)}
                options={[
                  { value: "", label: "Select" },
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                ]}
                label="Gender"
                required
                allowEmpty={false}
              />
            </div>

            {/* Campus → Institution → Course cascade */}
            <SelectField
              value={form.campus_id}
              onValueChange={value => set("campus_id", value)}
              options={allowedCampuses.map(c => ({ value: c.id, label: c.name }))}
              label="Campus"
              required
              disabled={!campusesLoaded || campusLocked}
              placeholder={campusesLoaded ? "Select campus" : "Loading campuses..."}
            />
            {noCampusAssigned && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                No campus is assigned to your account, so a student can't be added. Contact an administrator.
              </p>
            )}

            <SelectField
              value={form.institution_id}
              onValueChange={value => set("institution_id", value)}
              options={institutions.map(i => ({ value: i.id, label: i.name }))}
              label="Institution"
              required
              disabled={!form.campus_id}
              placeholder={form.campus_id ? "Select institution" : "Select campus first"}
            />

            <div className="grid grid-cols-2 gap-3">
              <SelectField
                value={form.course_id}
                onValueChange={value => set("course_id", value)}
                options={courses.map(c => ({ value: c.id, label: courseLabel(c) }))}
                label={isSchool ? "Class / Grade" : "Programme"}
                required
                disabled={!form.institution_id}
                placeholder={form.institution_id ? "Select" : "Select institution first"}
              />
              <TextField
                value={form.section}
                onValueChange={value => set("section", value)}
                label={isSchool ? "Section" : "Batch / Section"}
                placeholder="e.g. A, B"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <TextField
                  value={form.school_admission_no}
                  onValueChange={value => set("school_admission_no", value)}
                  label={isSchool ? "Existing Admission No." : "Previous Institution Admission No."}
                  placeholder={isSchool ? "e.g. 1803188" : "Optional"}
                />
                {form.school_admission_no.trim() && isSchool && (
                  <p className="text-[10px] text-primary mt-1">✓ Existing student — existing parent fee rates will apply</p>
                )}
              </div>
              {isSchool && (
                <TextField
                  value={form.class_roll_no}
                  onValueChange={value => set("class_roll_no", value)}
                  label="Class Roll No."
                  placeholder="Optional"
                />
              )}
            </div>

            {isSchool && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Student Type</label>
                <div className="flex gap-2">
                  {["day_scholar", "boarder"].map(t => (
                    <button key={t} onClick={() => set("student_type", t)}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${form.student_type === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                      {t === "day_scholar" ? "Day Scholar" : "Boarder"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setStep(1)} disabled={!step0Valid} className="gap-1.5">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 1: Parent / Guardian ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Users className="h-3.5 w-3.5" /> Parent / Guardian Details
            </div>
            <p className="text-xs text-muted-foreground">Optional but recommended for contact and fee communication.</p>

            <div>
              <p className="text-[11px] font-semibold text-foreground mb-2">Father</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  value={form.father_name}
                  onValueChange={value => set("father_name", value)}
                  label="Name"
                  placeholder="Full name"
                />
                <TextField
                  value={form.father_phone}
                  onValueChange={value => set("father_phone", value)}
                  label="Mobile"
                  placeholder="10-digit"
                />
              </div>
            </div>

            {leadMatch && (
              <div className={`rounded-lg border p-3 text-xs ${
                leadDecisionPending
                  ? "border-warning/40 bg-warning/5"
                  : linkLeadId ? "border-success/40 bg-success/5" : "border-border bg-muted/30"
              }`}>
                <p className="font-semibold text-foreground">
                  Existing lead on this number: {leadMatch.name?.trim() || "Unnamed"} · {leadMatch.stage?.replace(/_/g, " ")}
                </p>
                {leadHasMoney ? (
                  <p className="mt-0.5 text-muted-foreground">
                    Holding{leadMatch.paid > 0 ? ` ₹${leadMatch.paid.toLocaleString("en-IN")} in payments` : ""}
                    {leadMatch.paid > 0 && leadMatch.waived > 0 ? " and" : ""}
                    {leadMatch.waived > 0 ? ` ₹${leadMatch.waived.toLocaleString("en-IN")} in approved waivers` : ""}.
                    Link them, or this money will not reach the fee ledger.
                  </p>
                ) : (
                  <p className="mt-0.5 text-muted-foreground">
                    Link so any future payments and offer waivers land on this student's ledger.
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant={linkLeadId ? "default" : "outline"}
                    onClick={() => { setLinkLeadId(leadMatch.id); setIgnoreLead(false); }}
                  >
                    {linkLeadId ? "Linked" : "Link this lead"}
                  </Button>
                  <Button
                    size="sm"
                    variant={ignoreLead ? "default" : "outline"}
                    onClick={() => { setIgnoreLead(true); setLinkLeadId(null); }}
                  >
                    {ignoreLead ? "Not linked" : "Different person"}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold text-foreground mb-2">Mother</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  value={form.mother_name}
                  onValueChange={value => set("mother_name", value)}
                  label="Name"
                  placeholder="Full name"
                />
                <TextField
                  value={form.mother_phone}
                  onValueChange={value => set("mother_phone", value)}
                  label="Mobile"
                  placeholder="10-digit"
                />
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(0)} className="gap-1.5"><ChevronLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={() => setStep(2)} className="gap-1.5">Next <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Programme & Session ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Banknote className="h-3.5 w-3.5" /> Session & Fee Structure
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField
                value={form.session_id}
                onValueChange={value => set("session_id", value)}
                options={sessions.map(s => ({ value: s.id, label: sessionYearLabel(s.name) }))}
                label="Session"
                required
                placeholder="Select session"
              />
              <DatePickerField
                value={form.admission_date}
                onValueChange={value => set("admission_date", value)}
                label="Admission Date"
                required={isSchool}
              />
            </div>

            {isSchool ? (
              <SelectField
                value={form.joining_academic_year}
                onValueChange={value => set("joining_academic_year", value)}
                options={SCHOOL_SESSION_YEARS.map(year => ({ value: year, label: year }))}
                label="Admission Year"
                required
                placeholder="Select admission year"
              />
            ) : (
              <SelectField
                value={form.semester}
                onValueChange={value => set("semester", value)}
                options={HIGHER_ED_TERMS.map(term => ({ value: term, label: term }))}
                label="Current Semester / Year"
                required
                placeholder="Select current semester/year"
              />
            )}

            {/* Fee structure — school gets 2-option toggle, DAOTT gets Stetho Batch */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-2">
                Fee Structure
                {form.school_admission_no.trim() && isSchool && (
                  <Badge className="ml-2 text-[10px] bg-warning/10 text-warning-foreground border-warning/20">Auto: Existing Parent</Badge>
                )}
              </label>
              {isSchool ? (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => set("fee_version", "new_admission")}
                    className={`p-3 rounded-xl border text-left transition-colors ${form.fee_version === "new_admission" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <p className="text-xs font-semibold text-foreground">New Admission</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Standard rates for new families</p>
                  </button>
                  <button onClick={() => set("fee_version", "existing_parent")}
                    className={`p-3 rounded-xl border text-left transition-colors ${form.fee_version === "existing_parent" ? "border-warning/35 bg-warning/5" : "border-border"}`}>
                    <p className="text-xs font-semibold text-foreground">Existing Parent</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">CPI-revised rates for continuing families</p>
                  </button>
                </div>
              ) : isDaottCourse(selectedCourse) ? (
                <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => set("fee_version", "stetho_batch")}
                    className={`p-3 rounded-xl border text-left transition-colors ${form.fee_version === "stetho_batch" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <p className="text-xs font-semibold text-foreground">Stetho Batch</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">₹1,85,000 across 5 semesters</p>
                  </button>
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-border bg-muted/30">
                  <p className="text-xs text-muted-foreground">Standard fee structure will be applied based on programme.</p>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="p-3 rounded-xl bg-muted/40 space-y-1 text-xs">
              <p className="font-semibold text-foreground text-[11px]">Summary</p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{form.name || "—"}</span>
                {form.gender && ` · ${form.gender.charAt(0).toUpperCase() + form.gender.slice(1)}`}
                {form.dob && ` · DOB: ${form.dob}`}
              </p>
              <p className="text-muted-foreground">
                {allCampuses.find(c => c.id === form.campus_id)?.name || "—"}
                {" › "}{selectedInstitution?.name || "—"}
                {" › "}{selectedCourse ? courseLabel(selectedCourse) : "—"}
              </p>
              <p className="text-muted-foreground">
                {isSchool ? `Session: ${sessionYearLabel(selectedSession?.name) || "—"} · Admission year: ${form.joining_academic_year || "—"}` : `Current: ${form.semester || "—"}`}
              </p>
              {form.school_admission_no && <p className="text-muted-foreground font-mono">Admission No: {form.school_admission_no}</p>}
              {linkLeadId && leadMatch && (
                <p className="text-success">
                  Linked to lead {leadMatch.name?.trim() || "Unnamed"} — their payments and waivers will post to this ledger.
                </p>
              )}
            </div>

            {leadDecisionPending && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-foreground">
                A lead on this mobile is holding money. Go back to <b>Parent / Guardian</b> and choose whether
                it is the same candidate before saving.
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5"><ChevronLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={handleSubmit} disabled={saving || !canSubmit} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Add Student
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

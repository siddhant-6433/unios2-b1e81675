import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, School, Users, Banknote, ChevronRight, ChevronLeft } from "lucide-react";

interface Campus      { id: string; name: string; }
interface Institution { id: string; name: string; code: string; type: string; }
interface Course      { id: string; name: string; code: string; }
interface Session     { id: string; name: string; }

interface AddStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  /** Pre-select a campus. */
  defaultCampusId?: string;
}

type FeeVersion = "new_admission" | "existing_parent" | "standard";

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

const STEPS = ["Student Details", "Parent / Guardian", "Programme & Session"];

export function AddStudentDialog({ open, onOpenChange, onSuccess, defaultCampusId }: AddStudentDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [allCampuses,   setAllCampuses]   = useState<Campus[]>([]);
  const [institutions,  setInstitutions]  = useState<Institution[]>([]);
  const [courses,       setCourses]       = useState<Course[]>([]);
  const [sessions,      setSessions]      = useState<Session[]>([]);

  const [form, setForm] = useState({
    name: "", dob: "", gender: "", campus_id: defaultCampusId || "",
    institution_id: "", course_id: "", session_id: "",
    section: "", class_roll_no: "", student_type: "day_scholar",
    school_admission_no: "",                // existing no from previous system
    father_name: "", father_phone: "",
    mother_name: "", mother_phone: "",
    admission_date: new Date().toISOString().slice(0, 10),
    fee_version: "standard" as FeeVersion,
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // On open: reset + load campuses & sessions
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm(f => ({
      ...f, name: "", dob: "", gender: "", institution_id: "", course_id: "",
      section: "", class_roll_no: "", school_admission_no: "",
      father_name: "", father_phone: "", mother_name: "", mother_phone: "",
      fee_version: "standard",
      campus_id: defaultCampusId || f.campus_id,
    }));

    Promise.all([
      supabase.from("campuses").select("id, name").order("name"),
      supabase.from("admission_sessions").select("id, name").eq("is_active", true),
    ]).then(([cam, ses]) => {
      if (cam.data) setAllCampuses(cam.data);
      if (ses.data) { setSessions(ses.data); if (ses.data.length === 1) set("session_id", ses.data[0].id); }
    });
  }, [open, defaultCampusId]);

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
      .then(({ data }) => setCourses((data as any) || []));
  }, [form.institution_id, institutions]);

  // Auto-switch to existing_parent when admission no entered (school only)
  useEffect(() => {
    if (form.school_admission_no.trim() && selectedInstitution && isSchoolInstitution(selectedInstitution)) {
      setForm(f => ({ ...f, fee_version: "existing_parent" }));
    }
  }, [form.school_admission_no]);

  const selectedInstitution = institutions.find(i => i.id === form.institution_id) || null;
  const isSchool = isSchoolInstitution(selectedInstitution);

  const step0Valid = !!form.name && !!form.dob && !!form.gender && !!form.campus_id && !!form.institution_id && !!form.course_id;
  const canSubmit  = step0Valid && !!form.session_id;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);

    const pan = form.school_admission_no.trim()
      ? null
      : `PAN-${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabase.from("students").insert({
      name: form.name.trim(),
      dob:  form.dob  || null,
      gender: form.gender || null,
      course_id:  form.course_id,
      campus_id:  form.campus_id,
      session_id: form.session_id || null,
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
      fee_structure_version: form.fee_version,
      status: "active" as any,
    } as any);

    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Student added", description: `${form.name} has been added successfully.` });
    onOpenChange(false);
    onSuccess();
  };

  const inp = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50";
  const sel = `${inp} cursor-pointer`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Add Student
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

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Full Name <span className="text-destructive">*</span></label>
              <input className={inp} placeholder="Student's full name" value={form.name} onChange={e => set("name", e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Date of Birth <span className="text-destructive">*</span></label>
                <input type="date" className={inp} value={form.dob} onChange={e => set("dob", e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Gender <span className="text-destructive">*</span></label>
                <select className={sel} value={form.gender} onChange={e => set("gender", e.target.value)}>
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            {/* Campus → Institution → Course cascade */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus <span className="text-destructive">*</span></label>
              <select className={sel} value={form.campus_id} onChange={e => set("campus_id", e.target.value)}>
                <option value="">Select campus</option>
                {allCampuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Institution <span className="text-destructive">*</span></label>
              <select className={sel} value={form.institution_id} onChange={e => set("institution_id", e.target.value)}
                disabled={!form.campus_id}>
                <option value="">{form.campus_id ? "Select institution" : "Select campus first"}</option>
                {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  {isSchool ? "Class / Grade" : "Programme"} <span className="text-destructive">*</span>
                </label>
                <select className={sel} value={form.course_id} onChange={e => set("course_id", e.target.value)}
                  disabled={!form.institution_id}>
                  <option value="">{form.institution_id ? "Select" : "Select institution first"}</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{courseLabel(c)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  {isSchool ? "Section" : "Batch / Section"}
                </label>
                <input className={inp} placeholder="e.g. A, B" value={form.section} onChange={e => set("section", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  {isSchool ? "Existing Admission No." : "Previous Institution Admission No."}
                  <span className="ml-1 text-muted-foreground/50 text-[10px]">(if migrating)</span>
                </label>
                <input className={inp}
                  placeholder={isSchool ? "e.g. 1803188" : "Optional"}
                  value={form.school_admission_no}
                  onChange={e => set("school_admission_no", e.target.value)} />
                {form.school_admission_no.trim() && isSchool && (
                  <p className="text-[10px] text-primary mt-1">✓ Existing student — existing parent fee rates will apply</p>
                )}
              </div>
              {isSchool && (
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Class Roll No.</label>
                  <input className={inp} placeholder="Optional" value={form.class_roll_no} onChange={e => set("class_roll_no", e.target.value)} />
                </div>
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
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
                  <input className={inp} placeholder="Full name" value={form.father_name} onChange={e => set("father_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Mobile</label>
                  <input className={inp} placeholder="10-digit" value={form.father_phone} onChange={e => set("father_phone", e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-foreground mb-2">Mother</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
                  <input className={inp} placeholder="Full name" value={form.mother_name} onChange={e => set("mother_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Mobile</label>
                  <input className={inp} placeholder="10-digit" value={form.mother_phone} onChange={e => set("mother_phone", e.target.value)} />
                </div>
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
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Session <span className="text-destructive">*</span></label>
                <select className={sel} value={form.session_id} onChange={e => set("session_id", e.target.value)}>
                  <option value="">Select session</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Admission Date</label>
                <input type="date" className={inp} value={form.admission_date} onChange={e => set("admission_date", e.target.value)} />
              </div>
            </div>

            {/* Fee structure — school gets 2-option toggle, others get standard */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-2">
                Fee Structure
                {form.school_admission_no.trim() && isSchool && (
                  <Badge className="ml-2 text-[10px] bg-amber-100 text-amber-700 border-amber-200">Auto: Existing Parent</Badge>
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
                    className={`p-3 rounded-xl border text-left transition-colors ${form.fee_version === "existing_parent" ? "border-amber-500 bg-amber-50" : "border-border"}`}>
                    <p className="text-xs font-semibold text-foreground">Existing Parent</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">CPI-revised rates for continuing families</p>
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
                {form.gender && ` · ${form.gender}`}
                {form.dob && ` · DOB: ${form.dob}`}
              </p>
              <p className="text-muted-foreground">
                {allCampuses.find(c => c.id === form.campus_id)?.name || "—"}
                {" › "}{selectedInstitution?.name || "—"}
                {" › "}{courses.find(c => c.id === form.course_id) ? courseLabel(courses.find(c => c.id === form.course_id)!) : "—"}
              </p>
              {form.school_admission_no && <p className="text-muted-foreground font-mono">Admission No: {form.school_admission_no}</p>}
            </div>

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

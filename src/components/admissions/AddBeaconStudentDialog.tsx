import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, School, Users, Banknote, ChevronRight, ChevronLeft } from "lucide-react";

interface Course { id: string; name: string; code: string; }
interface Campus { id: string; name: string; }
interface Session { id: string; name: string; }

interface AddBeaconStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type FeeVersion = "new_admission" | "existing_parent";

const GRADE_LABELS: Record<string, string> = {
  TOD: "Toddler", NUR: "Nursery", LKG: "LKG", UKG: "UKG",
  G1: "Grade I", G2: "Grade II", G3: "Grade III", G4: "Grade IV", G5: "Grade V",
  G6: "Grade VI", G7: "Grade VII", G8: "Grade VIII", G9: "Grade IX", G10: "Grade X",
  G11: "Grade XI", G12: "Grade XII",
};

const STEPS = ["Student Details", "Parent Details", "Fee & Session"];

export function AddBeaconStudentDialog({ open, onOpenChange, onSuccess }: AddBeaconStudentDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  const [form, setForm] = useState({
    // Student
    name: "", dob: "", gender: "", course_id: "", campus_id: "",
    section: "", class_roll_no: "", student_type: "day_scholar",
    school_admission_no: "",   // existing SchoolKnot admission no
    transport_required: false, transport_zone: "", hostel_type: "",
    // Parents
    father_name: "", father_phone: "",
    mother_name: "", mother_phone: "",
    // Fee & Session
    session_id: "", admission_date: new Date().toISOString().slice(0, 10),
    fee_version: "new_admission" as FeeVersion,
  });

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm(f => ({ ...f, name: "", dob: "", gender: "", course_id: "", section: "",
      class_roll_no: "", school_admission_no: "", transport_required: false, transport_zone: "",
      hostel_type: "", father_name: "", father_phone: "",
      mother_name: "", mother_phone: "", fee_version: "new_admission" }));

    Promise.all([
      supabase.from("courses").select("id, name, code")
        .or("code.like.BSAV-%,code.like.BSA-%")
        .order("code"),
      supabase.from("campuses").select("id, name")
        .or("name.ilike.%beacon%,name.ilike.%avantika%,name.ilike.%arthala%"),
      supabase.from("admission_sessions").select("id, name").eq("is_active", true),
    ]).then(([c, cam, s]) => {
      if (c.data) setCourses(c.data);
      if (cam.data) setCampuses(cam.data);
      if (s.data) setSessions(s.data);
    });
  }, [open]);

  // Auto-set fee version when school_admission_no changes
  useEffect(() => {
    if (form.school_admission_no.trim()) {
      setForm(f => ({ ...f, fee_version: "existing_parent" }));
    }
  }, [form.school_admission_no]);

  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const step0Valid = !!form.name && !!form.dob && !!form.gender && !!form.course_id;
  const step1Valid = true; // parent details optional
  const canSubmit = step0Valid && !!form.campus_id && !!form.session_id;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);

    // Generate a pre-admission number if no existing admission no
    const pan = form.school_admission_no.trim()
      ? null
      : `BSAV-${Date.now().toString(36).toUpperCase()}`;

    const { data: inserted, error } = await supabase.from("students").insert({
      name: form.name.trim(),
      dob: form.dob || null,
      gender: form.gender || null,
      course_id: form.course_id,
      campus_id: form.campus_id,
      session_id: form.session_id || null,
      admission_date: form.admission_date || null,
      admission_no: form.school_admission_no.trim() || null,
      pre_admission_no: pan,
      section: form.section || null,
      class_roll_no: form.class_roll_no || null,
      student_type: form.student_type,
      transport_required: form.transport_required,
      transport_zone: form.transport_zone || null,
      hostel_type: form.hostel_type || null,
      school_admission_no: form.school_admission_no.trim() || null,
      father_name: form.father_name.trim() || null,
      father_phone: form.father_phone.trim() || null,
      mother_name: form.mother_name.trim() || null,
      mother_phone: form.mother_phone.trim() || null,
      guardian_name: form.father_name.trim() || null,
      guardian_phone: form.father_phone.trim() || null,
      fee_structure_version: form.fee_version,
      status: "active" as any,
    } as any).select("id").single();

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Auto-provision fees
    if (inserted?.id) {
      supabase.functions.invoke("provision-student-fees", {
        body: { student_id: inserted.id },
      }).then(({ error: provErr }) => {
        if (provErr) console.error("Fee provisioning failed:", provErr);
      });
    }

    toast({ title: "Student added", description: `${form.name} has been added as an active student. Fees are being provisioned.` });
    onOpenChange(false);
    onSuccess();
  };

  const inp = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50";
  const sel = `${inp} cursor-pointer`;

  const courseLabel = (c: Course) => {
    const suffix = c.code.split("-").pop() || "";
    return GRADE_LABELS[suffix] || c.name;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Add Beacon School Student
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mt-1 mb-4">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  i === step ? "bg-primary text-primary-foreground" :
                  i < step ? "bg-primary/15 text-primary cursor-pointer" :
                  "bg-muted text-muted-foreground"
                }`}>
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-current/10">{i + 1}</span>
                {s}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
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
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Class / Grade <span className="text-destructive">*</span></label>
                <select className={sel} value={form.course_id} onChange={e => set("course_id", e.target.value)}>
                  <option value="">Select grade</option>
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{courseLabel(c)} ({c.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Section</label>
                <input className={inp} placeholder="e.g. A, B, C" value={form.section} onChange={e => set("section", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Existing Admission No.
                  <span className="ml-1 text-muted-foreground/60">(SchoolKnot)</span>
                </label>
                <input className={inp} placeholder="e.g. 1803188" value={form.school_admission_no}
                  onChange={e => set("school_admission_no", e.target.value)} />
                {form.school_admission_no.trim() && (
                  <p className="text-[10px] text-primary mt-1">
                    ✓ Existing student — will use <strong>existing parent</strong> fee rates
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Class Roll No.</label>
                <input className={inp} placeholder="Optional" value={form.class_roll_no} onChange={e => set("class_roll_no", e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Student Type</label>
              <div className="flex gap-2">
                {["day_scholar", "day_boarder", "boarder"].map(t => (
                  <button key={t} onClick={() => {
                    set("student_type", t);
                    if (t === "day_scholar") { set("hostel_type", ""); }
                  }}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${form.student_type === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                    {t === "day_scholar" ? "Day Scholar" : t === "day_boarder" ? "Day Boarder" : "Boarder"}
                  </button>
                ))}
              </div>
            </div>

            {/* Transport zone — shown when transport required */}
            <div>
              <label className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground mb-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.transport_required}
                  onChange={e => {
                    setForm(f => ({ ...f, transport_required: e.target.checked, transport_zone: e.target.checked ? f.transport_zone : "" }));
                  }}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                Transport Required
              </label>
              {form.transport_required && (
                <select className={sel} value={form.transport_zone} onChange={e => set("transport_zone", e.target.value)}>
                  <option value="">Select zone</option>
                  <option value="zone_1">Zone 1 — Within 5 Kms</option>
                  <option value="zone_2">Zone 2 — 5-10 Kms</option>
                  <option value="zone_3">Zone 3 — Over 10 Kms</option>
                </select>
              )}
            </div>

            {/* Hostel type — shown when boarder or day_boarder */}
            {(form.student_type === "boarder") && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Hostel Type</label>
                <select className={sel} value={form.hostel_type} onChange={e => set("hostel_type", e.target.value)}>
                  <option value="">Select hostel type</option>
                  <option value="non_ac">Non-AC</option>
                  <option value="ac_central">AC — C Block</option>
                  <option value="ac_individual">AC — B Block</option>
                </select>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setStep(1)} disabled={!step0Valid} className="gap-1.5">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 1: Parent Details ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Users className="h-3.5 w-3.5" /> Parent / Guardian Details
            </div>

            <div className="p-3 rounded-xl bg-muted/40 text-xs text-muted-foreground">
              Parent details are optional but recommended for fee communication and school records.
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-foreground">Father</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Father's Name</label>
                  <input className={inp} placeholder="Full name" value={form.father_name} onChange={e => set("father_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Father's Mobile</label>
                  <input className={inp} placeholder="10-digit number" value={form.father_phone} onChange={e => set("father_phone", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-foreground">Mother</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Mother's Name</label>
                  <input className={inp} placeholder="Full name" value={form.mother_name} onChange={e => set("mother_name", e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Mother's Mobile</label>
                  <input className={inp} placeholder="10-digit number" value={form.mother_phone} onChange={e => set("mother_phone", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(0)} className="gap-1.5">
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(2)} className="gap-1.5">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Fee & Session ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Banknote className="h-3.5 w-3.5" /> Fee Structure & Session
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus <span className="text-destructive">*</span></label>
                <select className={sel} value={form.campus_id} onChange={e => set("campus_id", e.target.value)}>
                  <option value="">Select campus</option>
                  {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Session <span className="text-destructive">*</span></label>
                <select className={sel} value={form.session_id} onChange={e => set("session_id", e.target.value)}>
                  <option value="">Select session</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Admission Date</label>
              <input type="date" className={inp} value={form.admission_date} onChange={e => set("admission_date", e.target.value)} />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-2">
                Fee Structure
                {form.school_admission_no.trim() && (
                  <Badge className="ml-2 text-[10px] bg-amber-100 text-amber-700 border-amber-200">Auto-set: Existing Parent</Badge>
                )}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => set("fee_version", "new_admission")}
                  className={`p-3 rounded-xl border text-left transition-colors ${form.fee_version === "new_admission" ? "border-primary bg-primary/5" : "border-border"}`}>
                  <p className="text-xs font-semibold text-foreground">New Admission</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Standard rates for new families joining Beacon</p>
                </button>
                <button onClick={() => set("fee_version", "existing_parent")}
                  className={`p-3 rounded-xl border text-left transition-colors ${form.fee_version === "existing_parent" ? "border-amber-500 bg-amber-50" : "border-border"}`}>
                  <p className="text-xs font-semibold text-foreground">Existing Parent</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">CPI-revised rates for continuing families (2026–27)</p>
                </button>
              </div>
            </div>

            {/* Summary */}
            <div className="p-3 rounded-xl bg-muted/40 space-y-1 text-xs">
              <p className="font-semibold text-foreground text-[11px]">Summary</p>
              <p className="text-muted-foreground">
                <span className="text-foreground font-medium">{form.name || "—"}</span>
                {form.dob && ` · DOB: ${form.dob}`}
                {form.gender && ` · ${form.gender.charAt(0).toUpperCase() + form.gender.slice(1)}`}
              </p>
              {form.school_admission_no && (
                <p className="text-muted-foreground">Admission No: <span className="font-mono text-foreground">{form.school_admission_no}</span></p>
              )}
              {form.father_name && <p className="text-muted-foreground">Father: {form.father_name} {form.father_phone && `(${form.father_phone})`}</p>}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5">
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
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

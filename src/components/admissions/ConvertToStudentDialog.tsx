import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField, DatePickerField } from "@/components/ui/state-fields";
import { Loader2, UserCheck, ArrowRight } from "lucide-react";
import { getApplicationPhotoUrlsByLeadId } from "@/lib/applicationPhotos";
import { SCHOOL_SESSION_YEARS, isSchoolSessionYear, sessionYearLabel } from "@/lib/sessionYears";
import { resolveLeadTransitionCommand } from "@/lib/leadTransitions";
import { applyResolvedLeadTransition } from "@/lib/leadTransitionCommands";

interface ConvertToStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string; name: string; phone: string; email: string | null;
    guardian_name: string | null; guardian_phone: string | null;
    course_id: string | null; campus_id: string | null;
    stage: string; pre_admission_no: string | null; admission_no: string | null;
  };
  courseName?: string;
  campusName?: string;
  onSuccess: () => void;
}

export function ConvertToStudentDialog({ open, onOpenChange, lead, courseName, campusName, onSuccess }: ConvertToStudentDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);
  const [isSchoolCourse, setIsSchoolCourse] = useState(false);
  const [conversionType, setConversionType] = useState<"pre_admit" | "admit">("pre_admit");
  const [form, setForm] = useState({
    session_id: "",
    batch_id: "",
    admission_date: new Date().toISOString().slice(0, 10),
    joining_academic_year: "",
    semester: "",
  });

  const higherEdTerms = [
    "Sem 1", "Sem 2", "Sem 3", "Sem 4", "Sem 5", "Sem 6", "Sem 7", "Sem 8", "Sem 9", "Sem 10",
    "Year 1", "Year 2", "Year 3", "Year 4", "Year 5",
  ];

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("admission_sessions").select("id, name").eq("is_active", true).order("start_date"),
      supabase.from("batches").select("id, name").eq("course_id", lead.course_id || ""),
      lead.course_id
        ? supabase.from("courses").select("id, departments!inner(institutions!inner(type))").eq("id", lead.course_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]).then(([s, b, c]) => {
      if (s.data) setSessions(s.data.filter((session) => isSchoolSessionYear(session.name)));
      const batchRows = b.data ?? [];
      setBatches(batchRows);
      setForm((previous) => {
        const currentBatchStillValid = batchRows.some((batch) => batch.id === previous.batch_id);
        return {
          ...previous,
          batch_id: currentBatchStillValid ? previous.batch_id : batchRows.length === 1 ? batchRows[0].id : "",
        };
      });
      const departments = (c.data as any)?.departments;
      const instType = Array.isArray(departments)
        ? departments[0]?.institutions?.type
        : departments?.institutions?.type;
      setIsSchoolCourse(instType === "school");
    });
    // Pre-select type based on lead stage
    if (["token_paid", "pre_admitted"].includes(lead.stage) && !lead.admission_no) {
      setConversionType(lead.pre_admission_no ? "admit" : "pre_admit");
    }
  }, [open, lead]);

  useEffect(() => {
    const sessionName = sessionYearLabel(sessions.find(s => s.id === form.session_id)?.name);
    setForm(p => isSchoolCourse ? { ...p, joining_academic_year: sessionName, semester: "" } : { ...p, joining_academic_year: "" });
  }, [isSchoolCourse, form.session_id, sessions]);

  const generatePAN = () => `PAN-${Date.now().toString(36).toUpperCase()}`;
  const generateAN = () => `AN-${Date.now().toString(36).toUpperCase()}`;

  const handleConvert = async () => {
    setSaving(true);
    const isPreadmit = conversionType === "pre_admit";
    const pan = isPreadmit ? generatePAN() : (lead.pre_admission_no || generatePAN());
    const an = isPreadmit ? null : generateAN();
    const applicationPhotoUrl = (await getApplicationPhotoUrlsByLeadId([lead.id])).get(lead.id) || null;

    // Create student record
    const { data: student, error: studentErr } = await supabase.from("students").insert({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      photo_url: applicationPhotoUrl,
      guardian_name: lead.guardian_name,
      guardian_phone: lead.guardian_phone,
      course_id: lead.course_id,
      campus_id: lead.campus_id,
      lead_id: lead.id,
      session_id: form.session_id || null,
      batch_id: form.batch_id || null,
      joining_academic_year: isSchoolCourse ? form.joining_academic_year || null : null,
      semester: !isSchoolCourse ? form.semester || null : null,
      admission_date: form.admission_date || null,
      pre_admission_no: pan,
      admission_no: an,
      status: isPreadmit ? "pre_admitted" as any : "active" as any,
      created_by: user?.id || null,
    } as any).select("id").single();

    if (studentErr) {
      toast({ title: "Error", description: studentErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Update lead
    const transition = resolveLeadTransitionCommand({
      currentStage: lead.stage,
      command: isPreadmit ? "convertPreAdmitted" : "convertAdmitted",
    });
    try {
      await applyResolvedLeadTransition(supabase as any, {
        leadId: lead.id,
        transition,
        extraPatch: {
          pre_admission_no: pan,
          ...(an ? { admission_no: an } : {}),
        },
      });
    } catch (error: any) {
      if (student?.id) {
        await supabase.from("students").delete().eq("id", student.id);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Activity log
    await supabase.from("lead_activities").insert({
      lead_id: lead.id, user_id: user?.id || null, type: "conversion",
      description: isPreadmit
        ? `Pre-admitted with PAN: ${pan}`
        : `Admitted with AN: ${an} (PAN: ${pan})`,
      new_stage: isPreadmit ? "pre_admitted" as any : "admitted" as any,
    });

    // Send student_welcome WhatsApp (fire-and-forget)
    if (lead.phone) {
      const admNo = an || pan;
      supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: "student_welcome",
          phone: lead.phone,
          params: [lead.name, admNo, courseName || "your course", campusName || "NIMT Educational Institutions"],
          lead_id: lead.id,
        },
      }).catch(() => {});
    }

    toast({ title: isPreadmit ? "Pre-admission complete" : "Admission complete", description: isPreadmit ? `PAN: ${pan}` : `AN: ${an}` });
    setSaving(false);
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5" /> Convert to Student</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="p-4 rounded-xl bg-muted/50">
            <p className="text-sm font-semibold text-foreground">{lead.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{lead.phone} · {lead.email || "No email"}</p>
            {lead.pre_admission_no && <Badge variant="outline" className="mt-2 text-xs text-primary border-primary/30">Existing PAN: {lead.pre_admission_no}</Badge>}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-2">Conversion Type</label>
            <div className="flex gap-2">
              <button onClick={() => setConversionType("pre_admit")}
                className={`flex-1 rounded-xl p-3 text-left transition-colors border ${conversionType === "pre_admit" ? "border-primary bg-primary/5" : "border-border"}`}>
                <p className="text-sm font-semibold text-foreground">Pre-Admit</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Assign PAN, token paid</p>
              </button>
              <button onClick={() => setConversionType("admit")}
                className={`flex-1 rounded-xl p-3 text-left transition-colors border ${conversionType === "admit" ? "border-primary bg-primary/5" : "border-border"}`}>
                <p className="text-sm font-semibold text-foreground">Full Admit</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Assign AN, 25%+ fee</p>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              value={form.session_id}
              onValueChange={value => setForm(p => ({ ...p, session_id: value }))}
              options={sessions.map(s => ({ value: s.id, label: sessionYearLabel(s.name) }))}
              label="Session"
              placeholder="Select session"
            />
            <SelectField
              value={form.batch_id}
              onValueChange={value => setForm(p => ({ ...p, batch_id: value }))}
              options={batches.map(b => ({ value: b.id, label: b.name }))}
              label="Batch"
              placeholder="Select batch"
            />
          </div>

          <DatePickerField
            value={form.admission_date}
            onValueChange={value => setForm(p => ({ ...p, admission_date: value }))}
            label="Admission Date"
          />

          {isSchoolCourse ? (
            <SelectField
              value={form.joining_academic_year}
              onValueChange={value => setForm(p => ({ ...p, joining_academic_year: value }))}
              options={SCHOOL_SESSION_YEARS.map(year => ({ value: year, label: year }))}
              label="Admission Year"
              placeholder="Select admission year"
            />
          ) : (
            <SelectField
              value={form.semester}
              onValueChange={value => setForm(p => ({ ...p, semester: value }))}
              options={higherEdTerms.map(term => ({ value: term, label: term }))}
              label="Current Semester / Year"
              placeholder="Select current semester/year"
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleConvert} disabled={saving || !form.session_id || (isSchoolCourse ? !form.admission_date || !form.joining_academic_year : !form.batch_id || !form.semester)} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {conversionType === "pre_admit" ? "Pre-Admit" : "Admit"} Student
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

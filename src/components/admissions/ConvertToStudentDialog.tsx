import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserCheck, ArrowRight } from "lucide-react";

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
  const [conversionType, setConversionType] = useState<"pre_admit" | "admit">("pre_admit");
  const [form, setForm] = useState({ session_id: "", batch_id: "", admission_date: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("admission_sessions").select("id, name").eq("is_active", true),
      supabase.from("batches").select("id, name").eq("course_id", lead.course_id || ""),
    ]).then(([s, b]) => {
      if (s.data) setSessions(s.data);
      if (b.data) setBatches(b.data);
    });
    // Pre-select type based on lead stage
    if (["token_paid", "pre_admitted"].includes(lead.stage) && !lead.admission_no) {
      setConversionType(lead.pre_admission_no ? "admit" : "pre_admit");
    }
  }, [open, lead]);

  const generatePAN = () => `PAN-${Date.now().toString(36).toUpperCase()}`;
  const generateAN = () => `AN-${Date.now().toString(36).toUpperCase()}`;

  const handleConvert = async () => {
    setSaving(true);
    const isPreadmit = conversionType === "pre_admit";
    const pan = isPreadmit ? generatePAN() : (lead.pre_admission_no || generatePAN());
    const an = isPreadmit ? null : generateAN();

    // Create student record
    const { data: student, error: studentErr } = await supabase.from("students").insert({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      guardian_name: lead.guardian_name,
      guardian_phone: lead.guardian_phone,
      course_id: lead.course_id,
      campus_id: lead.campus_id,
      lead_id: lead.id,
      session_id: form.session_id || null,
      batch_id: form.batch_id || null,
      admission_date: form.admission_date || null,
      pre_admission_no: pan,
      admission_no: an,
      status: isPreadmit ? "pre_admitted" as any : "active" as any,
    }).select("id").single();

    if (studentErr) {
      toast({ title: "Error", description: studentErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Update lead
    const leadUpdate: any = {
      pre_admission_no: pan,
      stage: isPreadmit ? "pre_admitted" as any : "admitted" as any,
    };
    if (an) leadUpdate.admission_no = an;
    await supabase.from("leads").update(leadUpdate).eq("id", lead.id);

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

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

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
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Session</label>
              <select value={form.session_id} onChange={e => setForm(p => ({ ...p, session_id: e.target.value }))} className={inputCls}>
                <option value="">Select session</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Batch</label>
              <select value={form.batch_id} onChange={e => setForm(p => ({ ...p, batch_id: e.target.value }))} className={inputCls}>
                <option value="">Select batch</option>
                {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Admission Date</label>
            <input type="date" value={form.admission_date} onChange={e => setForm(p => ({ ...p, admission_date: e.target.value }))} className={inputCls} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleConvert} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {conversionType === "pre_admit" ? "Pre-Admit" : "Admit"} Student
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

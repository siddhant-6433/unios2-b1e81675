import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { CustomFeeForm, type CustomFeePayload, type FeeCodeOption } from "./CustomFeeForm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: any;
  onSuccess: () => void;
}

export function AddCustomFeeDialog({ open, onOpenChange, student, onSuccess }: Props) {
  const { toast } = useToast();
  const [feeCodes, setFeeCodes] = useState<FeeCodeOption[]>([]);
  const [anchorYear, setAnchorYear] = useState<number>(new Date().getFullYear());
  const [payload, setPayload] = useState<CustomFeePayload | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("fee_codes").select("id, code, name, category").neq("code", "LATE-FEE").order("name")
      .then(({ data }) => setFeeCodes((data as FeeCodeOption[]) || []));
    if (student?.session_id) {
      supabase.from("admission_sessions").select("start_date").eq("id", student.session_id).maybeSingle()
        .then(({ data }) => { if (data?.start_date) setAnchorYear(new Date(data.start_date).getFullYear()); });
    }
  }, [open, student?.session_id]);

  const submit = async () => {
    if (!payload) return;
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("add_custom_fee", {
      p_mode: payload.mode,
      p_student_ids: payload.mode === "one_off" ? [student.id] : null,
      p_course_id: payload.mode === "template" ? student.course_id : null,
      p_session_id: payload.mode === "template" ? student.session_id : null,
      p_fee_code_id: payload.feeCodeId,
      p_new_code: payload.newCode,
      p_new_name: payload.newName,
      p_new_category: payload.newCategory,
      p_installments: payload.installments,
      p_late_fee_config: payload.lateFeeConfig,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add fee", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fee added", description: `${data?.rows_created ?? 0} charge(s) posted to ${data?.students_affected ?? 1} student(s)` });
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Add custom fee</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <CustomFeeForm
            feeCodes={feeCodes}
            anchorYear={anchorYear}
            allowTemplate
            templateLabel="Whole course + session"
            onChange={setPayload}
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !payload} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add fee
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

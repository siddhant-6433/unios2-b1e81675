import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCampus } from "@/contexts/CampusContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Plus } from "lucide-react";
import { CustomFeeForm, type CustomFeePayload, type FeeCodeOption } from "./CustomFeeForm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface StudentRow {
  id: string; name: string; admission_no: string | null; pre_admission_no: string | null;
  course_id: string | null; batch_id: string | null; session_id: string | null;
  course_name: string; batch_name: string | null; session_name: string | null;
}

const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

export function BulkCustomFeeDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const { selectedCampusId } = useCampus();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [feeCodes, setFeeCodes] = useState<FeeCodeOption[]>([]);
  const [sessionYear, setSessionYear] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [courseFilter, setCourseFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payload, setPayload] = useState<CustomFeePayload | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(new Set());
    (async () => {
      // ponytail: 1000-row cap is fine — a fee cohort is filtered by course well below it.
      let q = supabase.from("students")
        .select("id, name, admission_no, pre_admission_no, course_id, batch_id, session_id, courses:course_id(name, code), batches:batch_id(name, section), admission_sessions:session_id(name)")
        .is("deleted_at", null).order("name").limit(1000);
      if (selectedCampusId !== "all") q = q.eq("campus_id", selectedCampusId);
      const [{ data: st }, { data: fc }, { data: sess }] = await Promise.all([
        q,
        supabase.from("fee_codes").select("id, code, name, category").neq("code", "LATE-FEE").order("name"),
        supabase.from("admission_sessions").select("id, start_date"),
      ]);
      setStudents(((st as any[]) || []).map((s) => ({
        ...s,
        course_name: s.courses?.name || "—",
        batch_name: s.batches ? `${s.batches.name}${s.batches.section ? " " + s.batches.section : ""}` : null,
        session_name: s.admission_sessions?.name || null,
      })));
      setFeeCodes((fc as FeeCodeOption[]) || []);
      const yMap: Record<string, number> = {};
      for (const s of (sess as any[]) || []) if (s.start_date) yMap[s.id] = new Date(s.start_date).getFullYear();
      setSessionYear(yMap);
      setLoading(false);
    })();
  }, [open, selectedCampusId]);

  const courses = useMemo(() =>
    Array.from(new Map(students.filter(s => s.course_id).map(s => [s.course_id!, s.course_name])).entries()), [students]);
  const batches = useMemo(() =>
    Array.from(new Map(students.filter(s => s.batch_id && (!courseFilter || s.course_id === courseFilter))
      .map(s => [s.batch_id!, s.batch_name || "—"])).entries()), [students, courseFilter]);
  const sessions = useMemo(() =>
    Array.from(new Map(students.filter(s => s.session_id).map(s => [s.session_id!, s.session_name || "—"])).entries()), [students]);

  const filtered = useMemo(() => students.filter(s => {
    if (courseFilter && s.course_id !== courseFilter) return false;
    if (batchFilter && s.batch_id !== batchFilter) return false;
    if (sessionFilter && s.session_id !== sessionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !(s.admission_no || s.pre_admission_no || "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [students, courseFilter, batchFilter, sessionFilter, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev);
    if (allFilteredSelected) filtered.forEach(s => next.delete(s.id));
    else filtered.forEach(s => next.add(s.id));
    return next;
  });
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const selectedStudents = students.filter(s => selected.has(s.id));
  // Common course+session across the selection → enables template mode.
  const commonCourse = selectedStudents.length > 0 && selectedStudents.every(s => s.course_id === selectedStudents[0].course_id) ? selectedStudents[0].course_id : null;
  const commonSession = selectedStudents.length > 0 && selectedStudents.every(s => s.session_id === selectedStudents[0].session_id) ? selectedStudents[0].session_id : null;
  const anchorYear = (commonSession && sessionYear[commonSession]) || (sessionFilter && sessionYear[sessionFilter]) || new Date().getFullYear();

  const submit = async () => {
    if (!payload) return;
    if (selected.size === 0) { toast({ title: "Select at least one student", variant: "destructive" }); return; }
    if (payload.mode === "template" && (!commonCourse || !commonSession)) {
      toast({ title: "Template mode needs one course + session", description: "Selected students span multiple courses/sessions. Filter to a single course + session, or use 'Selected students only'.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase.rpc as any)("add_custom_fee", {
      p_mode: payload.mode,
      p_student_ids: payload.mode === "one_off" ? Array.from(selected) : null,
      p_course_id: payload.mode === "template" ? commonCourse : null,
      p_session_id: payload.mode === "template" ? commonSession : null,
      p_fee_code_id: payload.feeCodeId,
      p_new_code: payload.newCode,
      p_new_name: payload.newName,
      p_new_category: payload.newCategory,
      p_installments: payload.installments,
      p_late_fee_config: payload.lateFeeConfig,
    });
    setSaving(false);
    if (error) { toast({ title: "Bulk add failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Fees added", description: `${data?.rows_created ?? 0} charge(s) across ${data?.students_affected ?? selected.size} student(s)` });
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Bulk add fee to students</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid md:grid-cols-2 gap-5 mt-2">
            {/* Left: cohort selector */}
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <select value={courseFilter} onChange={e => { setCourseFilter(e.target.value); setBatchFilter(""); }} className={inputCls}>
                  <option value="">All courses</option>
                  {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select value={batchFilter} onChange={e => setBatchFilter(e.target.value)} className={inputCls}>
                  <option value="">All batches</option>
                  {batches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} className={inputCls}>
                  <option value="">All sessions</option>
                  {sessions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / admission no…" className={inputCls} />
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} />
                  Select all ({filtered.length})
                </label>
                <span className="font-medium text-primary">{selected.size} selected</span>
              </div>
              <div className="rounded-xl border border-border/60 divide-y divide-border/60 max-h-[46vh] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">No students match.</div>
                ) : filtered.map(s => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-foreground">{s.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {s.admission_no || s.pre_admission_no || "—"} · {s.course_name}{s.batch_name ? ` · ${s.batch_name}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Right: fee config */}
            <div>
              <CustomFeeForm
                feeCodes={feeCodes}
                anchorYear={anchorYear}
                allowTemplate
                templateLabel="Course + session (future admissions too)"
                onChange={setPayload}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !payload || selected.size === 0} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add to {selected.size} student{selected.size !== 1 ? "s" : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

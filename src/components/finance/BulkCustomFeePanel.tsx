// BulkCustomFeePanel — super_admin: apply a fee head to one or many batches
// (course + session), optionally unticking individual students, with a due
// date per installment. Backed by apply_custom_fee_bulk (super_admin-only RPC).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/state-fields";

type Batch = { key: string; course_id: string; session_id: string; label: string };
type Student = { id: string; name: string; admission_no: string | null; course_id: string; session_id: string | null };
type FsRow = { course_id: string; session_id: string; courses: { name: string } | null; admission_sessions: { name: string } | null };
type Inst = { term: string; amount: string; due_date: string };

const rpc = (args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: { rows_created?: number; students_affected: number } | null; error: { message: string } | null }>)(
    "apply_custom_fee_bulk", args);

export function BulkCustomFeePanel() {
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [codes, setCodes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [students, setStudents] = useState<Student[]>([]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [codeId, setCodeId] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [insts, setInsts] = useState<Inst[]>([{ term: "adhoc", amount: "", due_date: "" }]);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [fs, fc] = await Promise.all([
        supabase.from("fee_structures").select("course_id, session_id, courses:course_id(name), admission_sessions:session_id(name)").eq("is_active", true),
        supabase.from("fee_codes").select("id, code, name").order("name"),
      ]);
      setBatches(((fs.data || []) as unknown as FsRow[]).map((r) => ({
        key: `${r.course_id}|${r.session_id}`, course_id: r.course_id, session_id: r.session_id,
        label: `${r.courses?.name ?? "?"} — ${r.admission_sessions?.name ?? "?"}`,
      })).sort((a, b) => a.label.localeCompare(b.label)));
      setCodes(fc.data || []);
    })();
  }, []);

  const sel = batches.filter((b) => picked.has(b.key));

  useEffect(() => {
    setUnticked(new Set());
    if (!sel.length) { setStudents([]); return; }
    (async () => {
      const { data } = await supabase.from("students").select("id, name, admission_no, course_id, session_id")
        .in("course_id", sel.map((b) => b.course_id)).order("name").limit(1000);
      setStudents(((data || []) as Student[]).filter((s) => picked.has(`${s.course_id}|${s.session_id}`)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const setInst = (i: number, p: Partial<Inst>) => setInsts(insts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const targets = students.filter((s) => !unticked.has(s.id));

  const run = async (dry: boolean) => {
    if (!sel.length) return toast({ title: "Pick at least one batch", variant: "destructive" });
    if (!codeId && !(newCode && newName)) return toast({ title: "Pick a fee head or name a new one", variant: "destructive" });
    if (insts.some((i) => !i.term || i.amount === "" || Number(i.amount) < 0)) return toast({ title: "Each installment needs a term and amount", variant: "destructive" });
    setBusy(true);
    const { data, error } = await rpc({
      p_batches: sel.map((b) => ({ course_id: b.course_id, session_id: b.session_id })),
      p_installments: insts.map((i) => ({ term: i.term, amount: Number(i.amount), due_date: i.due_date || null })),
      p_fee_code_id: codeId || null, p_new_code: codeId ? null : newCode, p_new_name: codeId ? null : newName,
      p_include_students: unticked.size ? targets.map((s) => s.id) : null,
      p_save_template: saveTemplate, p_dry_run: dry,
    });
    setBusy(false);
    if (error || !data) return toast({ title: "Failed", description: error?.message ?? "No response", variant: "destructive" });
    toast({ title: dry ? "Dry run" : "Applied", description: dry
      ? `${data.students_affected} students would be charged`
      : `${data.rows_created} fee rows created for ${data.students_affected} students` });
  };

  return (
    <Card><CardContent className="space-y-5 p-5">
      <div>
        <p className="mb-2 text-sm font-medium">1. Batches</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {batches.map((b) => (
            <label key={b.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.has(b.key)} onChange={() => setPicked(toggle(picked, b.key))} />
              {b.label}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">2. Fee head</p>
        <SelectField value={codeId} onValueChange={setCodeId} label="Existing head"
          options={[{ value: "", label: "— create new —" }, ...codes.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))]} />
        {!codeId && (
          <div className="flex gap-2">
            <Input placeholder="CODE" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
            <Input placeholder="Display name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">3. Installments & due dates</p>
        {insts.map((i, k) => (
          <div key={k} className="flex gap-2">
            <Input placeholder="Term" value={i.term} onChange={(e) => setInst(k, { term: e.target.value })} />
            <Input type="number" min={0} placeholder="Amount ₹" value={i.amount} onChange={(e) => setInst(k, { amount: e.target.value })} />
            <Input type="date" value={i.due_date} onChange={(e) => setInst(k, { due_date: e.target.value })} />
            {insts.length > 1 && <Button variant="ghost" onClick={() => setInsts(insts.filter((_, j) => j !== k))}>✕</Button>}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setInsts([...insts, { term: "", amount: "", due_date: "" }])}>+ Installment</Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
          Also add to these batches' fee structures (future admissions get it)
        </label>
      </div>

      {students.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">4. Students ({targets.length} of {students.length} selected)</p>
          <div className="max-h-60 overflow-y-auto rounded border p-2">
            {students.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!unticked.has(s.id)} onChange={() => setUnticked(toggle(unticked, s.id))} />
                {s.name} <span className="text-muted-foreground">{s.admission_no}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => run(true)}>Dry run</Button>
        <Button disabled={busy} onClick={() => confirm(`Charge ${targets.length} students?`) && run(false)}>Apply</Button>
      </div>
    </CardContent></Card>
  );
}

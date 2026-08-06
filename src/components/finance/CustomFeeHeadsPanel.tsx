// CustomFeeHeadsPanel — super_admin configuration for ad-hoc fee heads.
//
// A head is a (fee_code, fixed amount) pair plus an optional scope. Every
// non-empty scope field is AND-ed, so leaving them all blank enables the head
// for everyone, while campus + course together pins it to one batch. Leads
// carry a campus and course but no session, so a session-scoped head only ever
// reaches admitted students.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField, TextAreaField, FieldShell } from "@/components/ui/state-fields";
import { PageLoader } from "@/components/ui/page-loader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Tag, Power, Trash2, Search } from "lucide-react";

type Option = { id: string; name: string };
type StudentHit = { id: string; name: string; admission_no: string | null };

type HeadRow = {
  id: string;
  fee_code_id: string;
  amount: number;
  campus_id: string | null;
  course_id: string | null;
  session_id: string | null;
  student_id: string | null;
  is_active: boolean;
  notes: string | null;
  fee_codes?: { code: string; name: string } | null;
  campuses?: { name: string } | null;
  courses?: { name: string } | null;
  admission_sessions?: { name: string } | null;
  students?: { name: string; admission_no: string | null } | null;
};

export function CustomFeeHeadsPanel() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<HeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const [feeCodes, setFeeCodes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [campuses, setCampuses] = useState<Option[]>([]);
  const [courses, setCourses] = useState<Option[]>([]);
  const [sessions, setSessions] = useState<Option[]>([]);

  // form
  const [feeCodeId, setFeeCodeId] = useState("");
  const [amount, setAmount] = useState("");
  const [campusId, setCampusId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentHits, setStudentHits] = useState<StudentHit[]>([]);
  const [student, setStudent] = useState<StudentHit | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Every pre-existing fee_code is a recurring structure component, so the
  // counter charges (Sports, Transfer Certificate…) have to be minted here.
  const NEW_CODE = "__new__";
  const [newHeadName, setNewHeadName] = useState("");
  const creatingNewCode = feeCodeId === NEW_CODE;

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [headsRes, codesRes, campusRes, courseRes, sessionRes] = await Promise.all([
      (supabase.from("optional_fee_heads" as any)
        .select("*, fee_codes:fee_code_id(code, name), campuses:campus_id(name), courses:course_id(name), admission_sessions:session_id(name), students:student_id(name, admission_no)")
        .order("created_at", { ascending: false }) as any),
      supabase.from("fee_codes").select("id, code, name").order("name"),
      supabase.from("campuses").select("id, name").order("name"),
      supabase.from("courses").select("id, name").order("name"),
      supabase.from("admission_sessions").select("id, name").order("name"),
    ]);
    setRows((headsRes.data || []) as HeadRow[]);
    setFeeCodes((codesRes.data || []) as { id: string; code: string; name: string }[]);
    setCampuses((campusRes.data || []) as Option[]);
    setCourses((courseRes.data || []) as Option[]);
    setSessions((sessionRes.data || []) as Option[]);
    setLoading(false);
  };

  // Student pin lookup — same ilike shape as the header omnibox.
  useEffect(() => {
    const q = studentQuery.trim();
    if (q.length < 2) { setStudentHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("students")
        .select("id, name, admission_no")
        .or(`name.ilike.%${q}%,admission_no.ilike.%${q}%,pre_admission_no.ilike.%${q}%`)
        .limit(8);
      setStudentHits((data || []) as StudentHit[]);
    }, 250);
    return () => clearTimeout(t);
  }, [studentQuery]);

  const resetForm = () => {
    setFeeCodeId(""); setAmount(""); setCampusId(""); setCourseId("");
    setSessionId(""); setStudent(null); setStudentQuery(""); setStudentHits([]); setNotes("");
    setNewHeadName("");
  };

  const handleCreate = async () => {
    const amt = parseFloat(amount);
    if (!feeCodeId) { toast({ title: "Select a fee head", variant: "destructive" }); return; }
    if (creatingNewCode && !newHeadName.trim()) {
      toast({ title: "Name the new fee head", variant: "destructive" }); return;
    }
    if (!amt || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }

    setSaving(true);

    // Mint the fee_code first when the super admin is creating a brand-new head.
    let codeId = feeCodeId;
    if (creatingNewCode) {
      const { data: newId, error: codeErr } = await (supabase.rpc as any)("create_fee_head", {
        _name: newHeadName.trim(), _code: null, _category: "other",
      });
      if (codeErr || !newId) {
        setSaving(false);
        toast({ title: "Could not create the fee head", description: codeErr?.message, variant: "destructive" });
        return;
      }
      codeId = newId as string;
    }

    const { error } = await (supabase.from("optional_fee_heads" as any) as any).insert({
      fee_code_id: codeId,
      amount: amt,
      campus_id: campusId || null,
      course_id: courseId || null,
      session_id: sessionId || null,
      student_id: student?.id || null,
      notes: notes.trim() || null,
      created_by: profile?.id || null,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fee head enabled" });
    resetForm();
    setOpen(false);
    fetchAll();
  };

  const toggleActive = async (row: HeadRow) => {
    const { error } = await (supabase.from("optional_fee_heads" as any) as any)
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) toast({ title: "Could not update", description: error.message, variant: "destructive" });
    else fetchAll();
  };

  const remove = async (row: HeadRow) => {
    if (!window.confirm(`Delete the ${row.fee_codes?.name || "fee"} head? Charges already levied stay on their ledgers.`)) return;
    const { error } = await (supabase.from("optional_fee_heads" as any) as any).delete().eq("id", row.id);
    if (error) toast({ title: "Could not delete", description: error.message, variant: "destructive" });
    else fetchAll();
  };

  const scopeLabel = (r: HeadRow) => {
    const bits: string[] = [];
    if (r.students) bits.push(`${r.students.name}${r.students.admission_no ? ` (${r.students.admission_no})` : ""}`);
    if (r.campuses) bits.push(r.campuses.name);
    if (r.courses) bits.push(r.courses.name);
    if (r.admission_sessions) bits.push(r.admission_sessions.name);
    return bits.length ? bits.join(" · ") : "Everyone";
  };

  const selectedCode = useMemo(() => feeCodes.find(c => c.id === feeCodeId), [feeCodes, feeCodeId]);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">Custom Fee Heads</h3>
          <span className="text-xs text-muted-foreground">
            On-demand charges the cashier can add to a ledger
          </span>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Enable a head
        </Button>
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Head</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Available to</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Note</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No custom heads yet. Enable one to let the cashier levy it at the counter.
                  </td>
                </tr>
              ) : rows.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.fee_codes?.name || "—"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{r.fee_codes?.code}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">
                    ₹{Number(r.amount).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{scopeLabel(r)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate" title={r.notes || ""}>
                    {r.notes || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] border-0 ${r.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {r.is_active ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleActive(r)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title={r.is_active ? "Disable" : "Enable"}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => remove(r)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" /> Enable a fee head
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <SelectField
              value={feeCodeId}
              onValueChange={setFeeCodeId}
              options={[
                { value: "", label: "Select a fee code" },
                { value: NEW_CODE, label: "+ Create a new fee head…" },
                ...feeCodes.map(c => ({ value: c.id, label: `${c.name} (${c.code})` })),
              ]}
              label="Fee Code"
              placeholder="Select a fee code"
            />

            {creatingNewCode && (
              <FieldShell label="New fee head name">
                <Input
                  value={newHeadName}
                  onChange={e => setNewHeadName(e.target.value)}
                  placeholder="e.g. Sports, Transfer Certificate, Arrear Fee"
                  autoFocus
                />
              </FieldShell>
            )}
            <FieldShell label="Amount (₹) — fixed, the cashier cannot change it">
              <Input
                type="number" min="1" step="1" inputMode="numeric"
                value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
              />
            </FieldShell>

            <div className="rounded-lg border border-input bg-muted/20 p-3 space-y-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Scope — leave everything blank to enable this head for everyone. Each filter
                you set narrows it further.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  value={campusId} onValueChange={setCampusId}
                  options={[{ value: "", label: "Any campus" }, ...campuses.map(c => ({ value: c.id, label: c.name }))]}
                  label="Campus" placeholder="Any campus"
                />
                <SelectField
                  value={courseId} onValueChange={setCourseId}
                  options={[{ value: "", label: "Any course" }, ...courses.map(c => ({ value: c.id, label: c.name }))]}
                  label="Course" placeholder="Any course"
                />
              </div>
              <SelectField
                value={sessionId} onValueChange={setSessionId}
                options={[{ value: "", label: "Any batch / session" }, ...sessions.map(s => ({ value: s.id, label: s.name }))]}
                label="Batch / Session" placeholder="Any batch / session"
              />
              <p className="text-[10px] text-muted-foreground -mt-1">
                Applicants and leads have no session, so a batch-scoped head reaches admitted students only.
              </p>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Specific student (optional)</label>
                {student ? (
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-xs">
                    <span className="flex-1 truncate text-foreground">
                      {student.name}{student.admission_no ? ` · ${student.admission_no}` : ""}
                    </span>
                    <button onClick={() => { setStudent(null); setStudentQuery(""); }} className="text-muted-foreground hover:text-foreground">
                      Clear
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative mt-1">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={studentQuery}
                        onChange={e => setStudentQuery(e.target.value)}
                        placeholder="Search name or admission no."
                      />
                    </div>
                    {studentHits.length > 0 && (
                      <div className="mt-1 rounded-lg border border-input bg-card divide-y divide-border">
                        {studentHits.map(h => (
                          <button
                            key={h.id}
                            onClick={() => { setStudent(h); setStudentHits([]); }}
                            className="w-full px-3 py-2 text-left text-xs hover:bg-muted/40"
                          >
                            {h.name}{h.admission_no ? ` · ${h.admission_no}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <TextAreaField
              value={notes} onValueChange={setNotes}
              label="Note (optional)" placeholder="Shown to the cashier alongside the head"
            />

            {(selectedCode || (creatingNewCode && newHeadName.trim())) && (
              <p className="text-[11px] text-muted-foreground">
                Cashiers will see <span className="font-medium text-foreground">{selectedCode?.name || newHeadName.trim()}</span> for{" "}
                {student ? "one student" : [campusId && "this campus", courseId && "this course", sessionId && "this batch"].filter(Boolean).join(", ") || "everyone"}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <ButtonOrb state="working" onFilled /> : null}
              {saving ? "Saving…" : "Enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AcademicField, AcademicPanel, academicInput } from "./AcademicFields";
import type { CbseAction, CbseConfiguration, PolicyRules } from "@/lib/cbseExams";
import { CBSE_GRADE_BANDS, CBSE_SOURCE_URL, cbseComponentPresets, cbseDefaultSubjectRule } from "@/lib/cbseDefaults";

type SubjectRule = PolicyRules["subjects"][number];
export type AcademicAction = (action: CbseAction, payload: Record<string, unknown>) => Promise<boolean>;

/** Editable CBSE starting point for every subject of a class. */
function subjectDefaults(courseId: string, configuration: CbseConfiguration): SubjectRule[] {
  const grade = configuration.courses.find(c => c.id === courseId)?.grade ?? null;
  return configuration.subjects
    .filter(s => s.course_id === courseId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => cbseDefaultSubjectRule(s.id, s.code, grade, s.is_co_scholastic));
}

export function PolicyEditor({ configuration, disabled, onAction, canApprove }: {
  configuration: CbseConfiguration; disabled: boolean; onAction: AcademicAction; canApprove: boolean;
}) {
  const [course, setCourse] = useState(configuration.courses[0]?.id || "");
  const [session, setSession] = useState(configuration.sessions[0]?.id || "");
  const [name, setName] = useState("");
  const [subjects, setSubjects] = useState<SubjectRule[]>(() => subjectDefaults(configuration.courses[0]?.id || "", configuration));
  const [bands, setBands] = useState<{ min: number; grade: string }[]>(() => CBSE_GRADE_BANDS.map(b => ({ ...b })));
  const [weights, setWeights] = useState<PolicyRules["annual_weights"]>([]);
  const [rounding, setRounding] = useState<0 | 1 | 2>(2);
  const [absence, setAbsence] = useState<"zero" | "exclude">("zero");
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState(CBSE_SOURCE_URL);
  const [approvalRemarks, setApprovalRemarks] = useState("");
  const courseSubjects = configuration.subjects.filter(s => s.course_id === course);
  const grade = configuration.courses.find(c => c.id === course)?.grade ?? null;
  const changeSubject = (id: string, patch: Partial<SubjectRule>) => setSubjects(rows => rows.map(s => s.subject_id === id ? { ...s, ...patch } : s));
  const create = async () => {
    const ok = await onAction("create_policy", { course_id: course, session_id: session, name, rules: {
      subjects, grade_bands: bands, annual_weights: weights, rounding, absent_treatment: absence,
      exempt_treatment: "exclude", additional_subject_treatment: "all_applicable", confirmed, source_url: source,
    } });
    if (ok) setName("");
  };
  return <div className="space-y-5">
    <AcademicPanel title="Assessment policies" description="Each approved version freezes subject components, thresholds and school rules. Create another version for corrections.">
      {configuration.policies.length === 0 && <p className="text-sm text-muted-foreground">No policies yet. Configure one below before opening marks entry.</p>}
      <div className="space-y-3">{configuration.policies.map(p => <div key={p.id} className="rounded-lg border p-3 flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium text-sm">{p.name} · v{p.version}</p><p className="text-xs text-muted-foreground">{configuration.courses.find(c => c.id === p.course_id)?.name} · {configuration.sessions.find(s => s.id === p.session_id)?.name} · {p.status}</p>
          <details className="mt-2 text-xs"><summary className="cursor-pointer">Review rules</summary><div className="space-y-2 mt-2"><p>Rounding: {p.rules.rounding} decimals · Absent: {p.rules.absent_treatment} · Exempt: excluded</p><p>Grades: {p.rules.grade_bands.map(b => `${b.grade} ≥ ${b.min}%`).join(" · ")}</p>{p.rules.subjects.map(s => <p key={s.subject_id}>{configuration.subjects.find(subject => subject.id === s.subject_id)?.name}: {s.components.map(c => `${c.label} / ${c.max}${c.pass_percent === null ? "" : ` (pass ${c.pass_percent}%)`}`).join("; ")} · Subject pass: {s.pass_percent ?? "No threshold"} · {s.contributes_to_total === false ? "Excluded from aggregate" : "Included in aggregate"}</p>)}<p>Annual: {p.rules.annual_weights.map(w => `${w.category.replace(/_/g, " ")} ${w.sequence}: ${w.weight}%`).join(" · ") || "Not configured"}</p><a href={p.rules.source_url} target="_blank" rel="noreferrer" className="underline">Curriculum source</a></div></details></div>
        {p.status === "draft" && canApprove && <Button disabled={disabled || !approvalRemarks.trim()} onClick={() => onAction("approve_policy", { policy_id: p.id, remarks: approvalRemarks })}>Approve policy</Button>}
      </div>)}</div>
      {canApprove && <AcademicField label="Policy approval remarks"><textarea className={academicInput} value={approvalRemarks} onChange={e => setApprovalRemarks(e.target.value)} placeholder="Confirm the school assessment rules and source reviewed" disabled={disabled} /></AcademicField>}
    </AcademicPanel>
    <AcademicPanel title="New policy version" description="Enter the approved school values. No marks, pass threshold or annual weighting is inferred from a universal CBSE rule.">
      <fieldset disabled={disabled} className="space-y-5 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-3">
          <AcademicField label="Class and campus"><select className={academicInput} value={course} onChange={e => { setCourse(e.target.value); setSubjects(subjectDefaults(e.target.value, configuration)); }}><option value="">Select class</option>{configuration.courses.map(c => <option key={c.id} value={c.id}>{c.institution_name} · {c.name}</option>)}</select></AcademicField>
          <AcademicField label="Academic session"><select className={academicInput} value={session} onChange={e => setSession(e.target.value)}><option value="">Select session</option>{configuration.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></AcademicField>
          <AcademicField label="Policy name"><input className={academicInput} value={name} onChange={e => setName(e.target.value)} placeholder="Class IX · School assessment 2026–27" /></AcademicField>
        </div>
        <AcademicField label="Curriculum source URL" hint="Use the relevant subject curriculum. Principal confirmation is required for all school-specific choices."><input type="url" className={academicInput} value={source} onChange={e => setSource(e.target.value)} /></AcademicField>
        <a className="text-sm text-primary underline" href={CBSE_SOURCE_URL} target="_blank" rel="noreferrer">Review CBSE 2026–27 curriculum</a>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={disabled || !courseSubjects.length} onClick={() => setSubjects(subjectDefaults(course, configuration))}>Apply CBSE defaults</Button>
          <span className="text-xs text-muted-foreground">Pre-fills the CBSE grade bands and component maxima for this class. Every value stays editable.</span>
        </div>
        <div className="space-y-3">{courseSubjects.map(subject => {
          const rule = subjects.find(s => s.subject_id === subject.id);
          return <div key={subject.id} className="rounded-lg border p-4 space-y-3">
            <label className="flex gap-2 items-center text-sm font-medium"><input type="checkbox" checked={!!rule} onChange={e => setSubjects(rows => e.target.checked ? [...rows, cbseDefaultSubjectRule(subject.id, subject.code, grade, subject.is_co_scholastic)] : rows.filter(s => s.subject_id !== subject.id))} />{subject.name} ({subject.code}){subject.is_elective ? " · elective" : ""}</label>
            {rule && <>
              <AcademicField label={`Class ${grade ?? ""} component starting point`} hint="Choose the pattern for this subject from its curriculum, then review every school value. Pass thresholds remain your explicit choice."><select className={academicInput} value="" onChange={e => { const preset = cbseComponentPresets(grade).find(p => p.value === e.target.value); if (!preset) return; changeSubject(subject.id, { components: preset.components.map(c => ({ ...c })) }); setConfirmed(false); }}><option value="">Select a source-linked preset (optional)</option>{cbseComponentPresets(grade).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></AcademicField>
              <div className="flex gap-4 flex-wrap items-end"><AcademicField label="Subject pass percentage" hint="Blank means no subject-level threshold"><input type="number" min="0" max="100" step="0.01" className={academicInput} value={rule.pass_percent ?? ""} onChange={e => changeSubject(subject.id, { pass_percent: e.target.value === "" ? null : Number(e.target.value) })} /></AcademicField>
                <label className="text-sm flex gap-2 items-center pb-2"><input type="checkbox" checked={rule.contributes_to_total !== false} onChange={e => changeSubject(subject.id, { contributes_to_total: e.target.checked })} />Contributes to aggregate</label>
              </div>
              {rule.components.map((component, i) => <div key={i} className="grid gap-3 sm:grid-cols-4 items-end">
                <AcademicField label="Label"><input className={academicInput} value={component.label} onChange={e => changeSubject(subject.id, { components: rule.components.map((r, j) => j === i ? { ...r, label: e.target.value, key: `component_${i + 1}_${e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "assessment"}` } : r) })} placeholder="Theory" /></AcademicField>
                <AcademicField label="Maximum marks"><input type="number" min="0.01" step="0.01" className={academicInput} value={component.max || ""} onChange={e => changeSubject(subject.id, { components: rule.components.map((r, j) => j === i ? { ...r, max: Number(e.target.value) } : r) })} /></AcademicField>
                <AcademicField label="Component pass %"><input type="number" min="0" max="100" step="0.01" className={academicInput} value={component.pass_percent ?? ""} onChange={e => changeSubject(subject.id, { components: rule.components.map((r, j) => j === i ? { ...r, pass_percent: e.target.value === "" ? null : Number(e.target.value) } : r) })} /></AcademicField>
                <Button variant="outline" onClick={() => changeSubject(subject.id, { components: rule.components.filter((_, j) => j !== i) })}>Remove</Button>
              </div>)}
              <Button variant="outline" size="sm" onClick={() => changeSubject(subject.id, { components: [...rule.components, { key: `component_${rule.components.length + 1}`, label: "", max: 0, pass_percent: null }] })}>Add component</Button>
            </>}
          </div>;
        })}</div>
        {!courseSubjects.length && <p className="text-sm text-muted-foreground">This class has no configured subjects. Add its subjects in academic administration first.</p>}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3"><h3 className="text-sm font-semibold">Grade bands</h3>{bands.map((band, i) => <div key={i} className="flex gap-2 items-end"><AcademicField label="Minimum %"><input className={academicInput} type="number" min="0" max="100" value={band.min} onChange={e => setBands(rows => rows.map((r, j) => j === i ? { ...r, min: Number(e.target.value) } : r))} /></AcademicField><AcademicField label="Grade"><input className={academicInput} value={band.grade} onChange={e => setBands(rows => rows.map((r, j) => j === i ? { ...r, grade: e.target.value } : r))} /></AcademicField><Button variant="outline" onClick={() => setBands(rows => rows.filter((_, j) => j !== i))}>Remove</Button></div>)}<Button variant="outline" size="sm" onClick={() => setBands(rows => [...rows, { min: 0, grade: "" }])}>Add grade band</Button></div>
          <div className="space-y-3"><h3 className="text-sm font-semibold">Annual assessment weights</h3>{weights.map((weight, i) => <div key={i} className="grid grid-cols-4 gap-2 items-end"><AcademicField label="Assessment"><select className={academicInput} value={weight.category} onChange={e => setWeights(rows => rows.map((r, j) => j === i ? { ...r, category: e.target.value as typeof weight.category } : r))}>{["unit_test", "half_yearly", "final", "pre_board"].map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></AcademicField><AcademicField label="Number"><input type="number" min="1" className={academicInput} value={weight.sequence} onChange={e => setWeights(rows => rows.map((r, j) => j === i ? { ...r, sequence: Number(e.target.value) } : r))} /></AcademicField><AcademicField label="Weight %"><input type="number" min="0.01" max="100" step="0.01" className={academicInput} value={weight.weight || ""} onChange={e => setWeights(rows => rows.map((r, j) => j === i ? { ...r, weight: Number(e.target.value) } : r))} /></AcademicField><Button variant="outline" onClick={() => setWeights(rows => rows.filter((_, j) => j !== i))}>Remove</Button></div>)}<Button variant="outline" size="sm" onClick={() => setWeights(rows => [...rows, { category: "unit_test", sequence: 1, weight: 0 }])}>Add assessment weight</Button></div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <AcademicField label="Decimal places"><select className={academicInput} value={rounding} onChange={e => setRounding(Number(e.target.value) as 0 | 1 | 2)}>{[0, 1, 2].map(n => <option key={n} value={n}>{n}</option>)}</select></AcademicField>
          <AcademicField label="Absent assessments"><select className={academicInput} value={absence} onChange={e => setAbsence(e.target.value as "zero" | "exclude")}><option value="zero">Count as zero</option><option value="exclude">Exclude from aggregate</option></select></AcademicField>
          <p className="text-xs text-muted-foreground self-center">Exempt assessments are excluded. All applicable subjects are evaluated; the aggregate toggle controls contribution to totals.</p>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I have specified component maxima, thresholds, grading, annual weights, rounding, absence/exemption and additional-subject treatment for Principal review. These are school assessment rules, not Board eligibility or official Board grades.</span></label>
        <Button disabled={!confirmed || !name.trim() || !course || !session || !subjects.length || !bands.length} onClick={create}>Save draft policy</Button>
      </fieldset>
    </AcademicPanel>
  </div>;
}

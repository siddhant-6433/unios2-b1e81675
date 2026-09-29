import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CBSE_CATEGORY_LABELS, examTypeAllowedForGrade, type CbseCategory, type CbseConfiguration } from "@/lib/cbseExams";
import { AcademicField, AcademicPanel, academicInput } from "./AcademicFields";
import type { AcademicAction } from "./PolicyEditor";

export function ExamEditor({ configuration, disabled, onAction }: { configuration: CbseConfiguration; disabled: boolean; onAction: AcademicAction }) {
  const [courseId, setCourseId] = useState(configuration.courses[0]?.id || "");
  const [sessionId, setSessionId] = useState(configuration.sessions[0]?.id || "");
  const [policyId, setPolicyId] = useState("");
  const [category, setCategory] = useState<CbseCategory>("unit_test");
  const [sequence, setSequence] = useState(1);
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [cutoff, setCutoff] = useState("");
  const [classTeacher, setClassTeacher] = useState("");
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const selectedCourse = configuration.courses.find(c => c.id === courseId);
  const policies = configuration.policies.filter(p => p.course_id === courseId && p.session_id === sessionId && p.status === "approved");
  const policy = policies.find(p => p.id === policyId);
  const subjects = configuration.subjects.filter(s => policy?.rules.subjects.some(p => p.subject_id === s.id));
  const sourceExams = configuration.exams.filter(e => e.course_id === courseId && e.session_id === sessionId && e.section === (section.trim() || null) && e.category !== "annual" && ["approved", "released"].includes(e.status));
  const selectPolicy = (id: string) => {
    setPolicyId(id);
    setSelectedSubjects(configuration.policies.find(p => p.id === id)?.rules.subjects.map(s => s.subject_id) || []);
    setTeachers({});
  };
  return <AcademicPanel title="Create an exam or annual report" description="One class and section per exam. Set the reporting dates and fee cutoff, then review the roster before opening entry.">
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-70">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AcademicField label="Campus and class" hint="The Beacon class and campus this assessment is for. One class per exam."><select className={academicInput} value={courseId} onChange={e => { setCourseId(e.target.value); selectPolicy(""); setCategory("unit_test"); setSourceIds([]); }}><option value="">Choose class</option>{configuration.courses.map(c => <option key={c.id} value={c.id}>{c.institution_name} · {c.name}</option>)}</select></AcademicField>
        <AcademicField label="Session" hint="Academic session the results belong to (e.g. 2026-27)."><select className={academicInput} value={sessionId} onChange={e => { setSessionId(e.target.value); selectPolicy(""); setSourceIds([]); }}><option value="">Choose session</option>{configuration.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></AcademicField>
        <AcademicField label="Section" hint="Leave blank for an unsectioned class"><input className={academicInput} value={section} onChange={e => { setSection(e.target.value); setSourceIds([]); }} placeholder="A" /></AcademicField>
        <AcademicField label="Assessment" hint="Type of assessment. Pre-Boards apply to Classes X and XII only; Annual Report aggregates approved source exams and takes no direct marks."><select className={academicInput} value={category} onChange={e => setCategory(e.target.value as CbseCategory)}>{(Object.keys(CBSE_CATEGORY_LABELS) as CbseCategory[]).filter(c => examTypeAllowedForGrade(c, selectedCourse?.grade ?? null)).map(c => <option value={c} key={c}>{CBSE_CATEGORY_LABELS[c]}</option>)}</select></AcademicField>
        <AcademicField label="Sitting number" hint="For example Unit Test 3"><input type="number" min="1" step="1" className={academicInput} value={sequence} onChange={e => setSequence(Number(e.target.value))} /></AcademicField>
        <AcademicField label="Report title" hint="Printed on the report and shown to staff and families."><input className={academicInput} value={name} onChange={e => setName(e.target.value)} placeholder={`${CBSE_CATEGORY_LABELS[category]} · ${selectedCourse?.name || ""}`} /></AcademicField>
        <AcademicField label="Reporting period starts" hint="First day the assessment covers."><input type="date" className={academicInput} value={startsOn} onChange={e => setStartsOn(e.target.value)} /></AcademicField>
        <AcademicField label="Reporting period ends" hint="Last day the assessment covers; cannot be before the start."><input type="date" min={startsOn} className={academicInput} value={endsOn} onChange={e => setEndsOn(e.target.value)} /></AcademicField>
        <AcademicField label="Fee cutoff date" hint="Includes outstanding charges due on or before this date"><input type="date" className={academicInput} value={cutoff} onChange={e => setCutoff(e.target.value)} /></AcademicField>
        <AcademicField label="Approved assessment policy" hint="Fixes subject components, pass marks and grades. Only approved policies can be used — approve one under Assessment Policies."><select className={academicInput} value={policyId} onChange={e => selectPolicy(e.target.value)}><option value="">Choose approved policy</option>{policies.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</select></AcademicField>
        <AcademicField label="Class teacher" hint="Must have an active assignment to this class/section/session"><select className={academicInput} value={classTeacher} onChange={e => setClassTeacher(e.target.value)}><option value="">Choose class teacher</option>{configuration.staff.map(s => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}</select></AcademicField>
      </div>
      {!policies.length && <p className="text-sm text-muted-foreground">Approve a policy for this class and session in Assessment Policies first.</p>}
      {category !== "annual" && <div className="space-y-3"><h3 className="font-medium text-sm">Papers and assigned subject teachers</h3>{subjects.map(s => <div key={s.id} className="grid gap-3 sm:grid-cols-2 border rounded-lg p-3 items-center"><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={selectedSubjects.includes(s.id)} onChange={e => setSelectedSubjects(rows => e.target.checked ? [...rows, s.id] : rows.filter(id => id !== s.id))} />{s.name} · {s.code}{s.is_elective ? " (elective)" : ""}</label><select aria-label={`${s.name} teacher`} className={academicInput} disabled={!selectedSubjects.includes(s.id)} value={teachers[s.id] || ""} onChange={e => setTeachers(rows => ({ ...rows, [s.id]: e.target.value }))}><option value="">Choose assigned subject teacher</option>{configuration.staff.map(t => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}</select></div>)}<p className="text-xs text-muted-foreground">Only teachers with an active subject/class allocation can be assigned. Student elective choices are reviewed in the draft roster.</p></div>}
      {category === "annual" && <div className="space-y-3"><h3 className="text-sm font-medium">Approved source assessments</h3><p className="text-xs text-muted-foreground">The exact approved report revisions are recorded. Source corrections withdraw dependent annual reports. Required weights come from this policy.</p>{policy && <p className="text-sm">{policy.rules.annual_weights.map(w => `${CBSE_CATEGORY_LABELS[w.category]} ${w.sequence}: ${w.weight}%`).join(" · ") || "No annual weights configured in this policy."}</p>}{sourceExams.map(e => <label key={e.id} className="flex items-center gap-2 text-sm border rounded-lg p-3"><input type="checkbox" checked={sourceIds.includes(e.id)} onChange={event => setSourceIds(rows => event.target.checked ? [...rows, e.id] : rows.filter(id => id !== e.id))} />{e.name} · revision {e.revision} · {e.status}</label>)}{!sourceExams.length && <p className="text-sm text-muted-foreground">No approved source exams for this class, section and session.</p>}</div>}
      <p className="text-xs text-muted-foreground">Creating saves a <span className="font-medium">draft</span>. It is invisible to families until marks entry is opened, every paper is locked, the class-teacher review is submitted, and the Principal approves and releases it.</p>
      <Button disabled={!courseId || !sessionId || !policyId || !name.trim() || !startsOn || !endsOn || endsOn < startsOn || !cutoff || !classTeacher || sequence < 1 || (category !== "annual" && (!selectedSubjects.length || selectedSubjects.some(id => !teachers[id]))) || (category === "annual" && !sourceIds.length)} onClick={() => onAction("create_exam", { course_id: courseId, session_id: sessionId, section: section.trim() || null, name: name.trim(), academic_year: configuration.sessions.find(s => s.id === sessionId)?.name || "", category, sequence, starts_on: startsOn, ends_on: endsOn, fee_cutoff: cutoff, policy_id: policyId, class_teacher_user_id: classTeacher, papers: category === "annual" ? [] : selectedSubjects.map(id => ({ subject_id: id, teacher_user_id: teachers[id] })), source_exam_ids: category === "annual" ? sourceIds : [] })}>Create draft</Button>
    </fieldset>
  </AcademicPanel>;
}

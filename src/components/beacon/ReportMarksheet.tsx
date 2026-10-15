import beaconLogo from "@/assets/nimt-beacon-logo.png";
import { CBSE_CATEGORY_LABELS, type ReportSnapshot } from "@/lib/cbseExams";

const number = (value: number | null | undefined, suffix = "") => (value === null || value === undefined ? "—" : `${value}${suffix}`);

/**
 * Modern school assessment marksheet. Rendered on screen and in the browser's
 * print / Save-as-PDF output (see the print stylesheet below), so the staff
 * preview and the printed report match.
 */
/** Opens a clean, single-purpose print view so "Save as PDF" is named correctly and has no blank pages. */
export function printMarksheet(filename: string, landscape = false): void {
  const element = document.getElementById("beacon-marksheet");
  if (!element) return;
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => node.outerHTML).join("");
  const title = filename.replace(/\.pdf$/i, "").replace(/[<>&"]/g, "");
  const win = window.open("", "_blank", "width=980,height=1200");
  if (!win) return;
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}<style>@page{size:A4 ${landscape?"landscape":"portrait"};margin:8mm}html,body{margin:0;background:#fff}</style></head><body>${element.outerHTML}<script>addEventListener('load',function(){var el=document.getElementById('beacon-marksheet');if(el){el.style.zoom=Math.min(1,1040/Math.max(1,el.scrollHeight));}setTimeout(function(){focus();print();},250);});<\/script></body></html>`);
  win.document.close();
}

export function ReportMarksheet({ snapshot }: { snapshot: ReportSnapshot }) {
  const { school, student, subjects, summary, attendance, approval } = snapshot;
  const logo = school.logo_url || beaconLogo;
  const attendancePct = attendance.working_days > 0 ? Math.round((attendance.present / attendance.working_days) * 100) : null;
  const resultLabel = summary.result === "pass" ? "PASS" : summary.result === "fail" ? "FAIL" : summary.result === "absent" ? "ABSENT" : "INCOMPLETE";
  const resultTone = summary.result === "pass" ? "text-emerald-700" : summary.result === "fail" ? "text-rose-700" : "text-amber-700";
  return <div id="beacon-marksheet" className="beacon-marksheet mx-auto max-w-3xl bg-white text-[13px] leading-snug text-slate-800 print:max-w-none">
    <style>{`@media print{html,body{background:#fff;margin:0;padding:0}#beacon-marksheet{width:100%;max-width:none;padding:6mm 8mm}@page{size:A4 ${snapshot.category === "annual" ? "landscape" : "portrait"};margin:10mm}}`}</style>

    <header className="flex items-start gap-4 border-b-2 border-slate-800 pb-3">
      <img src={logo} alt={`${school.name} logo`} className="h-16 w-16 shrink-0 object-contain" />
      <div className="flex-1">
        <h1 className="text-lg font-bold uppercase tracking-wide">{school.name}</h1>
        {school.address && <p className="text-[11px] text-slate-500">{school.address}</p>}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">School Performance Report</p>
      </div>
      <div className="text-right text-[11px] text-slate-500"><p>Revision {snapshot.revision}</p></div>
    </header>

    <div className="mt-3 rounded-md bg-slate-800 px-3 py-2 text-center text-white">
      <p className="text-[15px] font-bold uppercase tracking-wide">{snapshot.title}</p>
      <p className="text-[11px] text-slate-200">{CBSE_CATEGORY_LABELS[snapshot.category]} · {snapshot.academic_year} · Revision {snapshot.revision}</p>
    </div>

    <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px]">
      <p><span className="text-slate-500">Student</span> <span className="font-semibold text-slate-900">{student.name}</span></p>
      <p><span className="text-slate-500">Class</span> <span className="font-medium">{student.course_name}{student.section ? ` · Section ${student.section}` : ""}</span></p>
      <p><span className="text-slate-500">Admission no.</span> <span className="font-medium">{student.admission_no ?? "—"}</span></p>
      <p><span className="text-slate-500">Roll no.</span> <span className="font-medium">{student.roll_no ?? "—"}</span></p>
      {student.father_name && <p><span className="text-slate-500">Father</span> {student.father_name}</p>}
      {student.mother_name && <p><span className="text-slate-500">Mother</span> {student.mother_name}</p>}
      {student.dob && <p><span className="text-slate-500">Date of birth</span> {student.dob}</p>}
      <p><span className="text-slate-500">Class teacher</span> <span className="font-medium">{snapshot.class_teacher?.name ?? "—"}</span></p>
    </section>

    {snapshot.category === "annual" && subjects.some(subject=>subject.term_breakdown) ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] border-collapse text-[10px]">
      <thead>
        <tr className="bg-slate-800 text-center text-white"><th rowSpan={2} className="px-2 py-2 text-left">Subject</th><th colSpan={4} className="border-l border-white/30 px-2 py-2">Term 1</th><th colSpan={4} className="border-l border-white/30 px-2 py-2">Term 2</th><th rowSpan={2} className="border-l border-white/30 bg-amber-500 px-2 py-2 text-right text-slate-950">Final Score</th></tr>
        <tr className="bg-slate-700 text-white"><th className="border-l border-white/20 px-2 py-1.5 text-right">UT-1</th><th className="px-2 py-1.5 text-right">UT-2</th><th className="px-2 py-1.5 text-right">Half Yearly</th><th className="px-2 py-1.5 text-right">Total / 100</th><th className="border-l border-white/20 px-2 py-1.5 text-right">UT-3</th><th className="px-2 py-1.5 text-right">UT-4</th><th className="px-2 py-1.5 text-right">Annual Exam</th><th className="px-2 py-1.5 text-right">Total / 100</th></tr>
      </thead><tbody>{subjects.map((subject,index)=>{const terms=subject.term_breakdown;const cell=(score:{score:number|null;max:number}|undefined)=>score?`${number(score.score)}/${number(score.max)}`:"—";return <tr key={subject.subject_id} className={index%2?"bg-slate-50":"bg-white"}><td className="border-b border-slate-200 px-2 py-2 font-medium text-slate-900">{subject.name}{subject.code?` (${subject.code})`:""}</td><td className="border-b border-l border-slate-200 px-2 py-2 text-right tabular-nums">{cell(terms?.term1.ut1)}</td><td className="border-b border-slate-200 px-2 py-2 text-right tabular-nums">{cell(terms?.term1.ut2)}</td><td className="border-b border-slate-200 px-2 py-2 text-right tabular-nums">{cell(terms?.term1.report)}</td><td className="border-b border-slate-200 px-2 py-2 text-right font-semibold tabular-nums">{cell(terms?.term1.total)}</td><td className="border-b border-l border-slate-200 px-2 py-2 text-right tabular-nums">{cell(terms?.term2.ut3)}</td><td className="border-b border-slate-200 px-2 py-2 text-right tabular-nums">{cell(terms?.term2.ut4)}</td><td className="border-b border-slate-200 px-2 py-2 text-right tabular-nums">{cell(terms?.term2.report)}</td><td className="border-b border-slate-200 px-2 py-2 text-right font-semibold tabular-nums">{cell(terms?.term2.total)}</td><td className="border-b border-amber-200 bg-amber-50 px-2 py-2 text-right font-bold tabular-nums text-amber-950">{cell(terms?.final_score)}</td></tr>})}</tbody>
    </table></div> : <table className="mt-4 w-full border-collapse text-[12px]">
      <thead>
        <tr className="bg-slate-800 text-left text-white">
          <th className="px-3 py-2 font-semibold">Subject</th>
          <th className="px-2 py-2 text-right font-semibold">Max</th>
          <th className="px-2 py-2 text-right font-semibold">Obtained</th>
          <th className="px-2 py-2 text-right font-semibold">%</th>
          <th className="px-2 py-2 text-center font-semibold">Grade</th>
          <th className="px-3 py-2 text-right font-semibold">Result</th>
        </tr>
      </thead>
      <tbody>
        {subjects.map((subject, index) => <tr key={subject.subject_id} className={index % 2 ? "bg-slate-50" : "bg-white"}>
          <td className="border-b border-slate-200 px-3 py-2 align-top">
            <span className="font-medium text-slate-900">{subject.name}</span>{subject.code ? <span className="text-slate-400"> ({subject.code})</span> : null}
            {subject.contributes_to_total === false && <span className="ml-1 text-[10px] uppercase text-slate-400">excluded</span>}
            <span className="mt-0.5 block text-[10.5px] text-slate-500">{subject.components.filter(c=>!c.source_only).map(c => `${c.label} ${number(c.score)}/${c.max}`).join(" · ")}</span>
          </td>
          <td className="border-b border-slate-200 px-2 py-2 text-right align-top tabular-nums">{number(subject.max)}</td>
          <td className="border-b border-slate-200 px-2 py-2 text-right align-top font-semibold tabular-nums">{number(subject.obtained)}</td>
          <td className="border-b border-slate-200 px-2 py-2 text-right align-top tabular-nums">{number(subject.percentage)}</td>
          <td className="border-b border-slate-200 px-2 py-2 text-center align-top font-semibold">{subject.grade ?? "—"}</td>
          <td className="border-b border-slate-200 px-3 py-2 text-right align-top">{subject.status !== "present" ? <span className="capitalize text-slate-500">{subject.status}</span> : subject.passed === false ? <span className="text-rose-600">Below pass</span> : <span className="text-emerald-700">Pass</span>}</td>
        </tr>)}
      </tbody>
    </table>}

    {snapshot.co_scholastic_grades&&<section className="mt-4 grid grid-cols-2 gap-4 text-[12px]"><div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">Art</p><p className="mt-0.5 font-semibold text-slate-900">{snapshot.co_scholastic_grades.art??"—"}</p></div><div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">Moral Values</p><p className="mt-0.5 font-semibold text-slate-900">{snapshot.co_scholastic_grades.moral_values??"—"}</p></div></section>}

    <section className="mt-4 grid grid-cols-4 divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 text-center">
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Aggregate</p><p className="text-base font-bold text-slate-900">{summary.obtained}/{summary.max}</p></div>
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Percentage</p><p className="text-base font-bold text-slate-900">{number(summary.percentage, "%")}</p></div>
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Grade</p><p className="text-base font-bold text-slate-900">{summary.grade ?? "—"}</p></div>
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Result</p><p className={`text-base font-bold ${resultTone}`}>{resultLabel}</p></div>
    </section>

    <section className="mt-4 grid grid-cols-2 gap-4 text-[12px]">
      <div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">Attendance</p><p className="mt-0.5 font-medium text-slate-900">{attendance.present} / {attendance.working_days} working days{attendancePct !== null ? ` (${attendancePct}%)` : ""}</p></div>
      <div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">Academic approval</p><p className="mt-0.5 font-medium text-slate-900">{approval.name}</p>{approval.designation && <p className="text-[11px] font-medium text-slate-600">{approval.designation}</p>}<p className="text-[11px] text-slate-500">{approval.approved_at.slice(0, 10)}{approval.remarks ? ` · ${approval.remarks}` : ""}</p></div>
    </section>

    {(snapshot.sources?.length ?? 0) > 0 && <section className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600"><span className="text-[10px] uppercase tracking-wide text-slate-500">Composed from</span> {snapshot.sources!.map(source => `${source.name} (${source.weight}%)`).join(" · ")}</section>}

    {snapshot.remarks && <section className="mt-3 rounded-lg border border-slate-200 p-3 text-[12px]"><p className="text-[10px] uppercase tracking-wide text-slate-500">Class teacher's remarks</p><p className="mt-0.5 text-slate-700">{snapshot.remarks}</p></section>}

    <footer className="mt-4 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
      <p>This report records school performance. It does not predict official Board grades or determine Board-examination eligibility. Assessment policy version {snapshot.policy.version}.</p>
      <p className="mt-1">Report {snapshot.report_id} · generated from the approved revision {snapshot.revision}.</p>
    </footer>
  </div>;
}

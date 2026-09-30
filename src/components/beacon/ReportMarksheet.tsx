import beaconLogo from "@/assets/nimt-beacon-logo.png";
import type { ReportSnapshot } from "@/lib/cbseExams";

const number = (value: number | null | undefined, suffix = "") => (value === null || value === undefined ? "—" : `${value}${suffix}`);

/**
 * Modern school assessment marksheet. Rendered on screen and in the browser's
 * print / Save-as-PDF output (see the print stylesheet below), so the staff
 * preview and the printed report match.
 */
/** Opens a clean, single-purpose print view so "Save as PDF" is named correctly and has no blank pages. */
export function printMarksheet(filename: string): void {
  const element = document.getElementById("beacon-marksheet");
  if (!element) return;
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => node.outerHTML).join("");
  const title = filename.replace(/\.pdf$/i, "").replace(/[<>&"]/g, "");
  const win = window.open("", "_blank", "width=980,height=1200");
  if (!win) return;
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}</head><body style="margin:0;background:#fff">${element.outerHTML}</body></html>`);
  win.document.close();
  const run = () => { win.focus(); win.print(); };
  if (win.document.readyState === "complete") window.setTimeout(run, 400);
  else win.addEventListener("load", () => window.setTimeout(run, 400));
}

export function ReportMarksheet({ snapshot }: { snapshot: ReportSnapshot }) {
  const { school, student, subjects, summary, attendance, approval } = snapshot;
  const logo = school.logo_url || beaconLogo;
  const attendancePct = attendance.working_days > 0 ? Math.round((attendance.present / attendance.working_days) * 100) : null;
  const resultLabel = summary.result === "pass" ? "PASS" : summary.result === "fail" ? "FAIL" : summary.result === "absent" ? "ABSENT" : "INCOMPLETE";
  const resultTone = summary.result === "pass" ? "text-emerald-700" : summary.result === "fail" ? "text-rose-700" : "text-amber-700";
  return <div id="beacon-marksheet" className="beacon-marksheet mx-auto max-w-3xl bg-white text-[13px] leading-snug text-slate-800 print:max-w-none">
    <style>{`@media print{html,body{background:#fff;margin:0;padding:0}#beacon-marksheet{width:100%;max-width:none;padding:6mm 8mm}@page{size:A4;margin:10mm}}`}</style>

    <header className="flex items-start gap-4 border-b-2 border-slate-800 pb-3">
      <img src={logo} alt={`${school.name} logo`} className="h-16 w-16 shrink-0 object-contain" />
      <div className="flex-1">
        <h1 className="text-lg font-bold uppercase tracking-wide">{school.name}</h1>
        {school.address && <p className="text-[11px] text-slate-500">{school.address}</p>}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600">School Performance Report · {snapshot.academic_year}</p>
      </div>
      <div className="text-right text-[11px] text-slate-500"><p>{snapshot.title}</p><p>Revision {snapshot.revision}</p></div>
    </header>

    <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px]">
      <p><span className="text-slate-500">Student</span> <span className="font-semibold text-slate-900">{student.name}</span></p>
      <p><span className="text-slate-500">Class</span> <span className="font-medium">{student.course_name}{student.section ? ` · Section ${student.section}` : ""}</span></p>
      <p><span className="text-slate-500">Admission no.</span> <span className="font-medium">{student.admission_no ?? "—"}</span></p>
      <p><span className="text-slate-500">Roll no.</span> <span className="font-medium">{student.roll_no ?? "—"}</span></p>
      {student.father_name && <p><span className="text-slate-500">Father</span> {student.father_name}</p>}
      {student.mother_name && <p><span className="text-slate-500">Mother</span> {student.mother_name}</p>}
      {student.dob && <p><span className="text-slate-500">Date of birth</span> {student.dob}</p>}
    </section>

    <table className="mt-4 w-full border-collapse text-[12px]">
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
            <span className="mt-0.5 block text-[10.5px] text-slate-500">{subject.components.map(c => `${c.label} ${number(c.score)}/${c.max}`).join(" · ")}</span>
          </td>
          <td className="border-b border-slate-200 px-2 py-2 text-right align-top tabular-nums">{number(subject.max)}</td>
          <td className="border-b border-slate-200 px-2 py-2 text-right align-top font-semibold tabular-nums">{number(subject.obtained)}</td>
          <td className="border-b border-slate-200 px-2 py-2 text-right align-top tabular-nums">{number(subject.percentage)}</td>
          <td className="border-b border-slate-200 px-2 py-2 text-center align-top font-semibold">{subject.grade ?? "—"}</td>
          <td className="border-b border-slate-200 px-3 py-2 text-right align-top">{subject.status !== "present" ? <span className="capitalize text-slate-500">{subject.status}</span> : subject.passed === false ? <span className="text-rose-600">Below pass</span> : <span className="text-emerald-700">Pass</span>}</td>
        </tr>)}
      </tbody>
    </table>

    <section className="mt-4 grid grid-cols-4 divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 text-center">
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Aggregate</p><p className="text-base font-bold text-slate-900">{summary.obtained}/{summary.max}</p></div>
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Percentage</p><p className="text-base font-bold text-slate-900">{number(summary.percentage, "%")}</p></div>
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Grade</p><p className="text-base font-bold text-slate-900">{summary.grade ?? "—"}</p></div>
      <div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-slate-500">Result</p><p className={`text-base font-bold ${resultTone}`}>{resultLabel}</p></div>
    </section>

    <section className="mt-4 grid grid-cols-2 gap-4 text-[12px]">
      <div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">Attendance</p><p className="mt-0.5 font-medium text-slate-900">{attendance.present} / {attendance.working_days} working days{attendancePct !== null ? ` (${attendancePct}%)` : ""}</p></div>
      <div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-500">Academic approval</p><p className="mt-0.5 font-medium text-slate-900">{approval.name}</p><p className="text-[11px] text-slate-500">{approval.approved_at.slice(0, 10)}{approval.remarks ? ` · ${approval.remarks}` : ""}</p></div>
    </section>

    {snapshot.remarks && <section className="mt-3 rounded-lg border border-slate-200 p-3 text-[12px]"><p className="text-[10px] uppercase tracking-wide text-slate-500">Class teacher's remarks</p><p className="mt-0.5 text-slate-700">{snapshot.remarks}</p></section>}

    <footer className="mt-4 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
      <p>This report records school performance. It does not predict official Board grades or determine Board-examination eligibility. Assessment policy version {snapshot.policy.version}.</p>
      <p className="mt-1">Report {snapshot.report_id} · generated from the approved revision {snapshot.revision}.</p>
    </footer>
  </div>;
}

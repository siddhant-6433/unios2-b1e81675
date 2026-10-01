import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { renderBeaconReport } from "./renderer.ts";
import type { ReportSnapshot } from "../../../src/lib/cbseExams.ts";
export function reportFixture(): ReportSnapshot {
  return {
    template_version:"beacon-v1", report_id:"11111111-1111-4111-8111-111111111111", exam_id:"exam", revision:2,
    title:"Half Yearly Examination", category:"half_yearly", academic_year:"2026-27",
    school:{name:"Beacon School - Avantika",code:"BSAV",address:"Avantika, Ghaziabad",logo_url:"https://never-fetch.example.invalid/logo.png",asset_version:"beacon-v1"},
    student:{id:"student",name:"आरव शर्मा / Aarav Sharma",admission_no:"BSAV-2026-1042",roll_no:"17",section:"A",father_name:"राजेश शर्मा",mother_name:"मीरा शर्मा",dob:"2012-05-20",course_name:"Class IX"},
    subjects:[{subject_id:"math",name:"Mathematics",code:"041",status:"present",components:[{key:"written",label:"Written examination",max:80,score:72},{key:"internal",label:"Internal assessment",max:20,score:18}],obtained:90,max:100,percentage:90,grade:"A",passed:true}],
    summary:{obtained:90,max:100,percentage:90,grade:"A",result:"pass"},attendance:{present:87,working_days:92},
    remarks:"Consistent progress in class. Continue practising extended answers and checking calculations.",
    approval:{name:"Principal",approved_at:"2026-09-17T10:00:00Z",remarks:"INTERNAL APPROVAL REMARKS MUST NOT PRINT"},
    policy:{id:"policy",version:1,source_url:"https://cbseacademic.nic.in/curriculum_2027.html"},source_report_ids:[],fee_cutoff:"2026-09-17",
  };
}
Deno.test("renders a genuine A4 PDF with bundled Unicode fonts", async () => {
  const bytes = await renderBeaconReport(reportFixture());
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() < 1 || pdf.getPage(0).getWidth() !== 595.28) throw new Error("Invalid A4 report");
  if (pdf.getTitle() !== "Half Yearly Examination - आरव शर्मा / Aarav Sharma") throw new Error("Lost Unicode identity");
});
Deno.test("wraps long identifiers, Hindi remarks and paginates many subjects", async () => {
  const fixture = reportFixture();
  fixture.student.name = "अभिनव शर्मा ".repeat(12);
  fixture.subjects = Array.from({length:24}, (_, index) => ({...fixture.subjects[0],subject_id:String(index),name:`Subject ${index + 1} / हिंदी`}));
  fixture.remarks = "The student participates thoughtfully and completes all assigned work. ".repeat(50);
  const bytes = await renderBeaconReport(fixture);
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() < 4) throw new Error("Expected multiple pages");
});
Deno.test("rejects unsupported templates and glyphs without silently corrupting names", async () => {
  const fixture = reportFixture();
  fixture.school.asset_version = "unknown";
  let rejected = false;
  try { await renderBeaconReport(fixture); } catch { rejected = true; }
  if (!rejected) throw new Error("Unknown asset accepted");
  fixture.school.asset_version = "beacon-v1";
  fixture.student.name = "Name 🦄";
  rejected = false;
  try { await renderBeaconReport(fixture); } catch { rejected = true; }
  if (!rejected) throw new Error("Unsupported glyph silently lost");
});
if (import.meta.main) {
  const directory = Deno.args[0];
  if (!directory) throw new Error("Provide output directory");
  await Deno.mkdir(directory, {recursive:true});
  await Deno.writeFile(`${directory}/beacon-report.pdf`, await renderBeaconReport(reportFixture()));
  const long = reportFixture();
  long.subjects = Array.from({length:24}, (_,i) => ({...long.subjects[0],subject_id:String(i),name:`Subject ${i+1} / हिंदी`}));
  long.remarks = "Thoughtful participation and steady improvement. ".repeat(40);
  await Deno.writeFile(`${directory}/beacon-report-long.pdf`, await renderBeaconReport(long));
}

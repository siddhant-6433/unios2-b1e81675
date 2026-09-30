import { PDFDocument, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import type { ReportSnapshot } from "../../../src/lib/cbseExams.ts";
import { wrapReportText } from "./layout.ts";
import { decodeBase64, NOTO_SANS_TTF_B64, NOTO_DEVANAGARI_TTF_B64, BEACON_LOGO_PNG_B64 } from "./assets_embedded.ts";

const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 32, INNER = WIDTH - MARGIN * 2;
const ink = rgb(0.12, 0.17, 0.21), muted = rgb(0.36, 0.4, 0.44), navy = rgb(0.08, 0.22, 0.31);
/** Only immutable bundled assets are used; snapshot URLs are deliberately never fetched. */
export async function renderBeaconReport(snapshot: ReportSnapshot): Promise<Uint8Array> {
  if (snapshot.template_version !== "beacon-v1" || (snapshot.school.asset_version && snapshot.school.asset_version !== "beacon-v1")) throw new Error("Unsupported report template");
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [latinBytes, devanagariBytes, logoBytes] = [decodeBase64(NOTO_SANS_TTF_B64), decodeBase64(NOTO_DEVANAGARI_TTF_B64), decodeBase64(BEACON_LOGO_PNG_B64)];
  const latin = await document.embedFont(latinBytes, { subset: true });
  const devanagari = await document.embedFont(devanagariBytes, { subset: true });
  const logo = await document.embedPng(logoBytes);
  // Keep Indic shaping runs intact. Unknown glyphs fail closed instead of producing blank names.
  const runs = (text: string): { text: string; font: PDFFont }[] => {
    const result: { text: string; font: PDFFont }[] = [];
    for (const segment of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) {
      const font = /[\u0900-\u097f]/.test(segment.segment) ? devanagari : latin;
      for (const character of segment.segment) {
        if (!/[\u200c\u200d]/.test(character) && !font.getCharacterSet().includes(character.codePointAt(0)!)) throw new Error("Unsupported report character");
      }
      const last = result[result.length - 1];
      if (last?.font === font) last.text += segment.segment;
      else result.push({ text: segment.segment, font });
    }
    return result;
  };
  const measure = (text: string, size: number) => runs(text).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
  let page!: PDFPage;
  let y = 0;
  const draw = (text: string, x: number, atY: number, size = 10, color = ink) => {
    for (const run of runs(text)) {
      page.drawText(run.text, { x, y: atY, font: run.font, size, color });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  const newPage = () => {
    page = document.addPage([WIDTH, HEIGHT]);
    page.drawRectangle({ x: 0, y: HEIGHT - 12, width: WIDTH, height: 12, color: navy });
    page.drawImage(logo, { x: MARGIN, y: HEIGHT - 75, width: 47, height: 47 * logo.height / logo.width });
    const names = wrapReportText(snapshot.school.name, INNER - 65, text => measure(text, 13));
    let headerY = HEIGHT - 44;
    for (const name of names) { draw(name, MARGIN + 63, headerY, 13, navy); headerY -= 18; }
    draw("SCHOOL PERFORMANCE REPORT", MARGIN + 63, headerY, 8, muted);
    y = Math.min(HEIGHT - 106, headerY - 30);
  };
  const ensure = (height: number) => { if (y - height < 62) newPage(); };
  const paragraph = (text: string, size = 10, color = ink, indent = 0) => {
    const lines = wrapReportText(text || "-", INNER - indent, value => measure(value, size));
    for (const line of lines) { ensure(size + 6); draw(line, MARGIN + indent, y, size, color); y -= size + 6; }
  };
  const label = (text: string) => { ensure(40); y -= 10; paragraph(text.toUpperCase(), 9, navy); y -= 3; };
  const number = (value: number | null) => value === null ? "-" : String(value);
  newPage();
  paragraph(snapshot.title, 18, navy);
  paragraph(`${snapshot.academic_year} | Revision ${snapshot.revision}`, 9, muted);
  if (snapshot.school.address) paragraph(snapshot.school.address, 9, muted);
  y -= 8;
  paragraph(snapshot.student.name, 14);
  paragraph(`${snapshot.student.course_name}${snapshot.student.section ? ` | Section ${snapshot.student.section}` : ""}`);
  paragraph(`Admission no: ${snapshot.student.admission_no ?? "-"} | Roll no: ${snapshot.student.roll_no ?? "-"}`, 9, muted);
  if (snapshot.student.dob) paragraph(`Date of birth: ${snapshot.student.dob}`, 9, muted);
  if (snapshot.student.father_name) paragraph(`Father: ${snapshot.student.father_name}`, 9, muted);
  if (snapshot.student.mother_name) paragraph(`Mother: ${snapshot.student.mother_name}`, 9, muted);
  if (snapshot.class_teacher?.name) paragraph(`Class teacher: ${snapshot.class_teacher.name}${snapshot.class_teacher.designation ? ` (${snapshot.class_teacher.designation})` : ""}`, 9, muted);
  label("Assessment");
  const columns = [150, 172, 70, 45, INNER - 437];
  const tableHeader = () => {
    ensure(36);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: INNER, height: 25, color: rgb(0.91, 0.94, 0.96) });
    let x = MARGIN + 7;
    for (const [index, title] of ["Subject", "Component marks", "Total", "Grade", "Status"].entries()) {
      draw(title, x, y - 10, 8, navy); x += columns[index];
    }
    y -= 31;
  };
  tableHeader();
  for (const subject of snapshot.subjects) {
    const cells = [
      `${subject.name}${subject.code ? ` (${subject.code})` : ""}${subject.contributes_to_total === false ? "\nExcluded from aggregate" : ""}`,
      subject.components.map(component => `${component.label}: ${number(component.score)} / ${number(component.max)}`).join("\n"),
      `${number(subject.obtained)} / ${number(subject.max)}\n${number(subject.percentage)}%`,
      subject.grade ?? "-",
      subject.status === "absent" ? "Absent" : subject.status === "exempt" ? "Exempt" : subject.passed === false ? "Below pass criteria" : "Assessed",
    ].map((text, index) => wrapReportText(text, columns[index] - 14, value => measure(value, 8)));
    const lines = Math.max(...cells.map(cell => cell.length));
    if (y - (lines * 13 + 16) < 62) { newPage(); tableHeader(); }
    // Extremely long subject/component labels continue on another page with column headings.
    for (let line = 0; line < lines; line++) {
      if (y - 20 < 62) { newPage(); tableHeader(); }
      let x = MARGIN + 7;
      cells.forEach((cell, index) => { if (cell[line]) draw(cell[line], x, y, 8, index === 0 ? navy : ink); x += columns[index]; });
      y -= 13;
    }
    y -= 5;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.83, 0.87, 0.89) });
    y -= 11;
  }
  label("Overall performance");
  paragraph(`${snapshot.summary.obtained} / ${snapshot.summary.max} | ${number(snapshot.summary.percentage)}% | Grade: ${snapshot.summary.grade ?? "-"}`);
  paragraph(`School result: ${snapshot.summary.result.toUpperCase()}`, 10, navy);
  paragraph(`Attendance: ${snapshot.attendance.present} / ${snapshot.attendance.working_days} working days`, 10);
  label("Class teacher's remarks");
  paragraph(snapshot.remarks);
  label("Academic approval");
  paragraph(`Approved by ${snapshot.approval.name}`, 10);
  if (snapshot.approval.designation) paragraph(snapshot.approval.designation, 9, muted);
  paragraph(`Approved on ${snapshot.approval.approved_at.slice(0, 10)} | Assessment policy version ${snapshot.policy.version}`, 9, muted);
  if (snapshot.sources && snapshot.sources.length > 0) { label("Composed from"); paragraph(snapshot.sources.map((source) => `${source.name} (${source.weight}%)`).join(" · "), 9, muted); }
  paragraph("This report records school performance. It does not predict official Board grades or determine Board-examination eligibility.", 8, muted);
  // Approval/reopening/fee exception remarks are staff-only and are never printed.
  for (const [index, item] of document.getPages().entries()) {
    page = item;
    draw(`Report ${snapshot.report_id} | Revision ${snapshot.revision}`, MARGIN, 34, 7, muted);
    draw(`${index + 1} / ${document.getPageCount()}`, WIDTH - MARGIN - 28, 34, 8, muted);
  }
  document.setTitle(`${snapshot.title} - ${snapshot.student.name}`);
  document.setAuthor(snapshot.school.name);
  document.setSubject("School academic performance report");
  return document.save();
}

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import type { ReportSnapshot } from "../../../src/lib/cbseExams.ts";
import { wrapReportText } from "./layout.ts";
import { decodeBase64, NOTO_SANS_TTF_B64, NOTO_DEVANAGARI_TTF_B64, BEACON_LOGO_PNG_B64 } from "./assets_embedded.ts";

const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 32, INNER = WIDTH - MARGIN * 2;
const ink = rgb(0.12, 0.17, 0.21), muted = rgb(0.36, 0.4, 0.44), navy = rgb(0.08, 0.22, 0.31);
/** Only immutable bundled assets are used; snapshot URLs are deliberately never fetched. */
/** Renders the report to one A4 page, scaling down uniformly only when it would otherwise overflow. */
export async function renderBeaconReport(snapshot: ReportSnapshot): Promise<Uint8Array> {
  const count = snapshot.subjects.length;
  const base = count <= 7 ? 1 : count <= 9 ? 0.9 : count <= 11 ? 0.82 : 0.76;
  for (const factor of [1, 0.9, 0.8]) {
    const scale = Math.max(0.6, base * factor);
    const bytes = await renderOnce(snapshot, scale);
    if ((await PDFDocument.load(bytes)).getPageCount() === 1) return bytes;
  }
  return renderOnce(snapshot, 0.6);
}

async function renderOnce(snapshot: ReportSnapshot, scale: number): Promise<Uint8Array> {
  const pageH = HEIGHT / scale;
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
    page = document.addPage([WIDTH, pageH]);
    page.drawRectangle({ x: 0, y: pageH - 10, width: WIDTH, height: 10, color: navy });
    page.drawImage(logo, { x: MARGIN, y: pageH - 70, width: 44, height: 44 * logo.height / logo.width });
    const names = wrapReportText(snapshot.school.name, INNER - 62, text => measure(text, 13));
    let headerY = pageH - 40;
    for (const name of names) { draw(name, MARGIN + 54, headerY, 13, navy); headerY -= 17; }
    draw("SCHOOL PERFORMANCE REPORT", MARGIN + 54, headerY, 8, muted);
    y = Math.min(pageH - 98, headerY - 26);
    const banner = 30;
    page.drawRectangle({ x: MARGIN, y: y - banner, width: INNER, height: banner, color: navy });
    draw(snapshot.title, MARGIN + (INNER - measure(snapshot.title, 12)) / 2, y - 19, 12, rgb(1, 1, 1));
    y -= banner + 10;
  };
  const ensure = (height: number) => { if (y - height < 58) newPage(); };
  const paragraph = (text: string, size = 10, color = ink, indent = 0) => {
    const lines = wrapReportText(text || "-", INNER - indent, value => measure(value, size));
    for (const line of lines) { ensure(size + 6); draw(line, MARGIN + indent, y, size, color); y -= size + 6; }
  };
  const label = (text: string) => { ensure(40); y -= 10; paragraph(text.toUpperCase(), 9, navy); y -= 3; };
  const number = (value: number | null) => value === null ? "-" : String(value);
  newPage();
  paragraph(`${snapshot.academic_year} | Revision ${snapshot.revision}`, 9, muted);
  if (snapshot.school.address) paragraph(snapshot.school.address, 9, muted);
  y -= 8;
  { const rows: [string, string][] = [
      ["Student", snapshot.student.name],
      ["Class", `${snapshot.student.course_name}${snapshot.student.section ? ` · Section ${snapshot.student.section}` : ""}`],
      ["Admission no.", snapshot.student.admission_no ?? "—"],
      ["Roll no.", snapshot.student.roll_no ?? "—"],
      ["Father", snapshot.student.father_name ?? "—"],
      ["Mother", snapshot.student.mother_name ?? "—"],
      ["Date of birth", snapshot.student.dob ?? "—"],
      ["Class teacher", snapshot.class_teacher?.name ?? "—"],
    ];
    const rowH = 15, panelH = Math.ceil(rows.length / 2) * rowH + 10;
    ensure(panelH + 8);
    page.drawRectangle({ x: MARGIN, y: y - panelH, width: INNER, height: panelH, color: rgb(0.96, 0.97, 0.98) });
    rows.forEach(([key, value], index) => { const column = index % 2, row = Math.floor(index / 2); const x = MARGIN + 8 + column * (INNER / 2); const atY = y - 16 - row * rowH; draw(key, x, atY, 8, muted); draw(value, x + 62, atY, 9, ink); });
    y -= panelH + 12; }
  label("Assessment");
  const columns = [INNER - 260, 44, 58, 44, 44, 70];
  const rowLine = 12, rowFont = 8;
  const tableHeader = () => {
    ensure(36);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: INNER, height: 25, color: navy });
    let x = MARGIN + 7;
    for (const [index, title] of ["Subject", "Max", "Obtained", "%", "Grade", "Result"].entries()) {
      draw(title, x, y - 10, 8, rgb(1, 1, 1)); x += columns[index];
    }
    y -= 31;
  };
  tableHeader();
  for (const subject of snapshot.subjects) {
    const cells = [
      `${subject.name}${subject.code ? ` (${subject.code})` : ""}${subject.contributes_to_total === false ? "\nExcluded from aggregate" : ""}\n${subject.components.map(component => `${component.label} ${number(component.score)}/${number(component.max)}`).join(" · ")}`,
      number(subject.max),
      number(subject.obtained),
      number(subject.percentage),
      subject.grade ?? "-",
      subject.status === "absent" ? "Absent" : subject.status === "exempt" ? "Exempt" : subject.passed === false ? "Below pass" : "Pass",
    ].map((text, index) => wrapReportText(text, columns[index] - 14, value => measure(value, 8)));
    const lines = Math.max(...cells.map(cell => cell.length));
    if (y - (lines * rowLine + 8) < 42) { newPage(); tableHeader(); }
    // Extremely long subject/component labels continue on another page with column headings.
    for (let line = 0; line < lines; line++) {
      if (y - (rowLine + 5) < 42) { newPage(); tableHeader(); }
      let x = MARGIN + 7;
      cells.forEach((cell, index) => { if (cell[line]) draw(cell[line], x, y, rowFont, index === 0 ? navy : ink); x += columns[index]; });
      y -= rowLine;
    }
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.83, 0.87, 0.89) });
    y -= 13;
  }
  label("Overall performance");
  { const bw = INNER / 4, bh = 34;
    ensure(bh + 8);
    const stats: [string, string][] = [["Aggregate", `${number(snapshot.summary.obtained)} / ${number(snapshot.summary.max)}`], ["Percentage", `${number(snapshot.summary.percentage)}%`], ["Grade", snapshot.summary.grade ?? "—"], ["Result", snapshot.summary.result.toUpperCase()]];
    for (const [index, [key, value]] of stats.entries()) { const x = MARGIN + index * bw; page.drawRectangle({ x, y: y - bh, width: bw, height: bh, borderColor: rgb(0.86, 0.89, 0.91), borderWidth: 0.7, color: rgb(1, 1, 1) }); draw(key.toUpperCase(), x + 8, y - 13, 7, muted); draw(value, x + 8, y - 26, 12, navy); }
    y -= bh + 12; }
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
  if (scale < 1) { for (const item of document.getPages()) { item.scaleContent(scale, scale); item.translateContent((WIDTH - WIDTH * scale) / 2, 0); item.setSize(WIDTH, HEIGHT); } }
  return document.save();
}

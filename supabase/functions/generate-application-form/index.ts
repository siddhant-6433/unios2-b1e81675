import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument, PDFImage, PDFName, PDFArray, PDFString, rgb, StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ───────────────────────── helpers ─────────────────────────
async function fetchImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error("[application-form] image fetch failed:", url, r.status);
      return null;
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    const looksPng = ct.includes("png") || url.toLowerCase().endsWith(".png");
    // Try the expected format first; fall back to the other on failure.
    // Processed PNGs sometimes have alpha / indexed-colour quirks that pdf-lib's
    // embedPng rejects, in which case the bytes might still load as JPEG.
    try {
      return looksPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch (e1) {
      console.warn("[application-form] embed primary failed, trying alt:", url, (e1 as Error).message);
      try {
        return looksPng ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      } catch (e2) {
        console.error("[application-form] embed alt also failed:", url, (e2 as Error).message);
        return null;
      }
    }
  } catch (e) {
    console.error("[application-form] image fetch threw:", url, (e as Error).message);
    return null;
  }
}

const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
};

// Friendly labels for document upload keys. Mirrors getRequiredDocs() in
// src/components/apply/DocumentUpload.tsx.
const DOC_KEY_LABELS: Record<string, string> = {
  birth_certificate:      "Birth Certificate",
  report_card:            "Previous Class Report Card",
  student_photo:          "Student Photograph",
  transfer_certificate:   "Transfer Certificate",
  aadhaar:                "Aadhaar Card",
  medical_record:         "Medical Record",
  class_10_marksheet:     "Class 10 Marksheet",
  class_10_certificate:   "Class 10 Pass Certificate",
  class_12_marksheet:     "Class 12 Marksheet",
  class_12_certificate:   "Class 12 Pass Certificate",
  graduation_marksheet:   "Graduation Marksheet",
  graduation_certificate: "Graduation Degree Certificate",
};

function docLabel(docKey: string): string {
  if (DOC_KEY_LABELS[docKey]) return DOC_KEY_LABELS[docKey];
  // additional_qual_<N>_marksheet
  const addl = docKey.match(/^additional_qual_(\d+)_marksheet$/);
  if (addl) return `Additional Qualification ${parseInt(addl[1]) + 1} Marksheet`;
  // entrance_<exam>_scorecard
  const exam = docKey.match(/^entrance_(.+)_scorecard$/);
  if (exam) {
    const examName = exam[1].replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return `${examName} Scorecard`;
  }
  // Fallback: title-case the key.
  return docKey.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Eligibility mismatch detection ────────────────────────────────────────
// Each mismatch is keyed by the section it should highlight in the PDF.
type MismatchSection =
  | "personal"        // age / DOB
  | "class_10_board"  // custom board flag affects class 10
  | "class_12"        // marks
  | "class_12_board"  // custom board flag affects class 12
  | "graduation"      // marks / required-but-missing
  | "graduation_uni"  // custom university
  | "entrance";       // entrance exam missing
interface Mismatch { section: MismatchSection; message: string }

function ageInYears(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return years;
}

function parseMarks(v: any): number | null {
  if (v == null || v === "") return null;
  // accept "85", "85%", "8.5 CGPA"
  const s = String(v).replace(/[^0-9.]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  // Heuristic: CGPA values usually <= 10, percentages > 10.
  return n <= 10 ? n * 9.5 : n; // rough CGPA -> percent conversion
}

function computeMismatches(app: any, rules: any[]): Mismatch[] {
  const out: Mismatch[] = [];
  const flags = new Set<string>(Array.isArray(app.flags) ? app.flags : []);
  if (flags.has("custom_board")) {
    out.push({
      section: "class_12_board",
      message: "Board for Class 10 / 12 not in our predefined list - admissions team to verify validity.",
    });
  }
  if (flags.has("custom_university")) {
    out.push({
      section: "graduation_uni",
      message: "University for Graduation / additional qualification not in our predefined list - admissions team to verify validity.",
    });
  }

  if (rules.length === 0) return out;

  const ad = app.academic_details || {};
  const c12Marks = parseMarks(ad.class_12?.marks);
  const gradMarks = parseMarks(ad.graduation?.marks ?? ad.graduation?.cgpa_till_sem);
  const candidateAge = ageInYears(app.dob);
  const exams: any[] = Array.isArray(ad.entrance_exams) ? ad.entrance_exams : [];

  // Aggregate per-course findings; surface the strictest one for each section.
  const ageWarnings: string[] = [];
  const c12Warnings: string[] = [];
  const gradWarnings: string[] = [];
  const entranceWarnings: string[] = [];

  rules.forEach(r => {
    if (candidateAge != null) {
      if (r.min_age != null && candidateAge < r.min_age) {
        ageWarnings.push(`Below minimum age (${candidateAge} < ${r.min_age}).`);
      }
      if (r.max_age != null && candidateAge > r.max_age) {
        ageWarnings.push(`Above maximum age (${candidateAge} > ${r.max_age}).`);
      }
    }
    if (r.class_12_min_marks != null && c12Marks != null && c12Marks < Number(r.class_12_min_marks)) {
      c12Warnings.push(`Class 12 marks below minimum (${c12Marks.toFixed(1)}% < ${r.class_12_min_marks}%).`);
    }
    if (r.requires_graduation && !ad.graduation?.degree && !ad.graduation?.university) {
      gradWarnings.push(`Graduation required but not provided.`);
    }
    if (r.graduation_min_marks != null && gradMarks != null && gradMarks < Number(r.graduation_min_marks)) {
      gradWarnings.push(`Graduation marks below minimum (${gradMarks.toFixed(1)}% < ${r.graduation_min_marks}%).`);
    }
    if (r.entrance_exam_required) {
      const examName = (r.entrance_exam_name || "").trim().toLowerCase();
      const declared = exams.some((e: any) =>
        (e.exam_name || "").toLowerCase().includes(examName) && e.status === "declared"
      );
      if (!declared && examName) {
        entranceWarnings.push(`Entrance exam required: ${r.entrance_exam_name} (status not declared).`);
      } else if (!declared && !examName) {
        entranceWarnings.push("Entrance exam required (no scorecard declared yet).");
      }
    }
  });

  if (ageWarnings.length)      out.push({ section: "personal",     message: Array.from(new Set(ageWarnings)).join(" ") });
  if (c12Warnings.length)      out.push({ section: "class_12",     message: Array.from(new Set(c12Warnings)).join(" ") });
  if (gradWarnings.length)     out.push({ section: "graduation",   message: Array.from(new Set(gradWarnings)).join(" ") });
  if (entranceWarnings.length) out.push({ section: "entrance",     message: Array.from(new Set(entranceWarnings)).join(" ") });

  return out;
}

const upper = (s?: string | null) => (s ?? "").toString().toUpperCase().trim() || "-";
// Display all data in CAPS - keeps the doc visually consistent and matches the
// historical NIMT-UG application format.
const norm  = (s?: string | null) => (s ?? "").toString().toUpperCase().trim() || "-";
const yesNo = (b?: any) => b ? "YES" : "NO";

interface Ctx {
  pdf: PDFDocument;
  page: any;
  font: any;
  bold: any;
  width: number;
  height: number;
  margin: number;
  y: number;       // current top cursor (we draw downward)
  contentStart: number; // y where body starts (changes per page after letterhead)
  contentEnd: number;   // y where body must stop
  branding: any;
  hasLetterhead: boolean;
  flags: Set<string>;
  // Repeating-header info: painted on every page above the body.
  appId?: string;
  sessionName?: string | null;
}

const COLORS = {
  border:    rgb(0.55, 0.55, 0.6),
  light:     rgb(0.85, 0.85, 0.88),
  labelBg:   rgb(0.93, 0.93, 0.96),
  sectionBg: rgb(0.10, 0.13, 0.24),
  sectionFg: rgb(1, 1, 1),
  text:      rgb(0.10, 0.10, 0.15),
  muted:     rgb(0.45, 0.45, 0.5),
  redFill:   rgb(1, 0.94, 0.94),
  redBorder: rgb(0.85, 0.16, 0.16),
  link:      rgb(0.10, 0.30, 0.85),
};

async function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage([595, 842]);
  let topReserve = 90;
  let bottomReserve = 50;

  if (ctx.hasLetterhead && ctx.branding?._lh) {
    const lh = ctx.branding._lh;
    const aspectHW = lh.height / lh.width;

    if (aspectHW >= 1.2) {
      // Tall image - likely full-page A4 background. Stretch to fit.
      ctx.page.drawImage(lh, { x: 0, y: 0, width: ctx.width, height: ctx.height });
      // Reserve generous top + bottom for header/footer bands inside the
      // letterhead artwork itself.
      topReserve    = 150;
      bottomReserve = 150;
    } else {
      // Banner / header-only - render at top, scaled to width at native aspect.
      const lhHeight = ctx.width * aspectHW;
      ctx.page.drawImage(lh, { x: 0, y: ctx.height - lhHeight, width: ctx.width, height: lhHeight });
      topReserve = lhHeight + 16;

      // Optional footer band at bottom.
      if (ctx.branding._footer) {
        const f = ctx.branding._footer;
        const fAspect = f.height / f.width;
        const fH = Math.min(ctx.width * fAspect, 120);
        ctx.page.drawImage(f, { x: 0, y: 0, width: ctx.width, height: fH });
        bottomReserve = fH + 12;
      } else {
        bottomReserve = 50;
      }
    }
  } else {
    // Default branded header band.
    ctx.page.drawRectangle({ x: 0, y: ctx.height - 70, width: ctx.width, height: 70, color: COLORS.sectionBg });
    ctx.page.drawText(ctx.branding?.name || "NIMT Educational Institutions", {
      x: ctx.margin, y: ctx.height - 36, size: 14, font: ctx.bold, color: COLORS.sectionFg,
    });
    ctx.page.drawText(ctx.branding?.address || "", {
      x: ctx.margin, y: ctx.height - 54, size: 8, font: ctx.font, color: rgb(0.85,0.88,0.95),
    });
    topReserve    = 90;
    bottomReserve = 50;
  }

  ctx.contentStart = ctx.height - topReserve;
  ctx.contentEnd   = bottomReserve;
  ctx.y = ctx.contentStart;

  // Per-page repeating header: a single green pill in the top-right corner
  // OVER the letterhead band, carrying three lines stacked:
  //   Line 1: "Admission Application"          (bold, regular size)
  //   Line 2: <session name in caps>            (bold, regular size)
  //   Line 3: <Application No>                  (bold, large size)
  if (ctx.appId) {
    const line1 = "Admission Application";
    const line2 = (ctx.sessionName || "").toUpperCase();
    const line3 = ctx.appId;
    const sizeSm = 10;
    const sizeLg = 16;
    const padX = 18;
    const padY = 10;
    const lineGap = 4;

    const w1 = ctx.bold.widthOfTextAtSize(line1, sizeSm);
    const w2 = line2 ? ctx.bold.widthOfTextAtSize(line2, sizeSm) : 0;
    const w3 = ctx.bold.widthOfTextAtSize(line3, sizeLg);
    const innerW = Math.max(w1, w2, w3);
    const badgeW = innerW + padX * 2;

    // Total height: padY + line1 + gap + line2 + gap + line3 + padY
    const linesH =
      sizeSm + (line2 ? lineGap + sizeSm : 0) + lineGap + sizeLg;
    const badgeH = padY * 2 + linesH;

    const badgeX = ctx.width - ctx.margin - badgeW;
    const badgeY = ctx.height - 18; // top edge of pill, 18pt down from page edge
    const badgeColor = rgb(0.20, 0.69, 0.39);
    const radius = Math.min(18, badgeH / 2);

    // Pill: a rectangle plus two end-circles.
    ctx.page.drawRectangle({
      x: badgeX + radius, y: badgeY - badgeH,
      width: badgeW - radius * 2, height: badgeH,
      color: badgeColor,
    });
    ctx.page.drawCircle({ x: badgeX + radius,           y: badgeY - badgeH / 2, size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + badgeW - radius,  y: badgeY - badgeH / 2, size: radius, color: badgeColor });

    // Centre each line horizontally inside the pill.
    let textY = badgeY - padY - sizeSm + 2;
    ctx.page.drawText(line1, {
      x: badgeX + (badgeW - w1) / 2, y: textY,
      size: sizeSm, font: ctx.bold, color: rgb(1, 1, 1),
    });
    if (line2) {
      textY -= lineGap + sizeSm;
      ctx.page.drawText(line2, {
        x: badgeX + (badgeW - w2) / 2, y: textY,
        size: sizeSm, font: ctx.bold, color: rgb(1, 1, 1),
      });
    }
    textY -= lineGap + sizeLg;
    ctx.page.drawText(line3, {
      x: badgeX + (badgeW - w3) / 2, y: textY,
      size: sizeLg, font: ctx.bold, color: rgb(1, 1, 1),
    });
  }
}

function ensureSpace(ctx: Ctx, need: number) {
  if (ctx.y - need < ctx.contentEnd) newPage(ctx);
}

function addLinkAnnotation(ctx: Ctx, x: number, y: number, w: number, h: number, url: string) {
  const ann = ctx.pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  let annots = ctx.page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) {
    annots = ctx.pdf.context.obj([]);
    ctx.page.node.set(PDFName.of("Annots"), annots);
  }
  annots.push(ann);
}

// Section title bar (dark, full-width, white text).
function drawSection(ctx: Ctx, title: string, height = 18) {
  ensureSpace(ctx, height + 4);
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - height, width: ctx.width - ctx.margin*2, height,
    color: COLORS.sectionBg,
  });
  ctx.page.drawText(title, {
    x: ctx.margin + 8, y: ctx.y - height + 5, size: 9, font: ctx.bold, color: COLORS.sectionFg,
  });
  ctx.y -= height + 2;
}

// Word-wrap a string into N lines that fit a given pixel width at a given font/size.
// When a single word is wider than the cell (e.g. a long email like
// ABHIJEETKUMAR153020@GMAIL.COM), it's split across multiple lines at
// character boundaries instead of getting truncated with an ellipsis.
function wrapText(text: string, font: any, size: number, maxWidth: number, maxLines = 2): string[] {
  if (!text) return [""];

  const charWrap = (word: string): string[] => {
    const out: string[] = [];
    let buf = "";
    for (const ch of word) {
      const trial = buf + ch;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        buf = trial;
      } else {
        if (buf) out.push(buf);
        buf = ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  };

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  outer: for (const word of words) {
    const trial = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = "";
      if (lines.length >= maxLines) break;
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        // Break the over-long word at character boundaries.
        const chunks = charWrap(word);
        for (let j = 0; j < chunks.length; j++) {
          if (j === chunks.length - 1) {
            line = chunks[j];
          } else {
            lines.push(chunks[j]);
            if (lines.length >= maxLines) { line = ""; break outer; }
          }
        }
      } else {
        line = word;
      }
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(last + "...", size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "...";
  }
  return lines.length ? lines : [""];
}

// One label/value cell. Label small grey top-left; value bold beneath, wrapped to fit.
function drawCell(
  ctx: Ctx, x: number, y: number, w: number, h: number,
  label: string, value: string, opts: { red?: boolean; valueSize?: number; maxLines?: number } = {},
) {
  const fillColor = opts.red ? COLORS.redFill : rgb(1, 1, 1);
  const border    = opts.red ? COLORS.redBorder : COLORS.border;
  const bw        = opts.red ? 1.2 : 0.5;
  ctx.page.drawRectangle({ x, y: y - h, width: w, height: h, color: fillColor, borderColor: border, borderWidth: bw });
  if (label) {
    ctx.page.drawText(label, { x: x + 4, y: y - 11, size: 6.5, font: ctx.font, color: COLORS.muted });
  }
  const valueSize = opts.valueSize ?? 8.5;
  const maxLines  = opts.maxLines  ?? (label ? 2 : 1);
  const innerW    = w - 8;
  // Reserve label height at top if label is present.
  const valueTop  = label ? y - 22 : y - 14;
  const lineH     = valueSize + 2;
  const lines = wrapText(value || "", ctx.bold, valueSize, innerW, maxLines);
  lines.forEach((ln, i) => {
    ctx.page.drawText(ln, {
      x: x + 4,
      y: valueTop - i * lineH,
      size: valueSize, font: ctx.bold, color: COLORS.text,
    });
  });
}

function drawHeaderRow(ctx: Ctx, cols: { label: string; w: number }[], rowH = 16) {
  ensureSpace(ctx, rowH);
  let xCur = ctx.margin;
  for (const c of cols) {
    ctx.page.drawRectangle({ x: xCur, y: ctx.y - rowH, width: c.w, height: rowH, color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5 });
    ctx.page.drawText(c.label, { x: xCur + 4, y: ctx.y - 11, size: 7.5, font: ctx.bold, color: COLORS.text });
    xCur += c.w;
  }
  ctx.y -= rowH;
}

// Auto-sizing row: heights expand to fit the longest wrapped value across cols.
function drawValueRow(ctx: Ctx, cols: { value: string; w: number; red?: boolean }[], minRowH = 22) {
  const valueSize = 8.5;
  const lineH = valueSize + 2;
  let maxLines = 1;
  for (const c of cols) {
    const lines = wrapText(c.value || "", ctx.bold, valueSize, c.w - 8, 5);
    if (lines.length > maxLines) maxLines = lines.length;
  }
  const computedH = Math.max(minRowH, 10 + maxLines * lineH);
  ensureSpace(ctx, computedH);
  let xCur = ctx.margin;
  for (const c of cols) {
    drawCell(ctx, xCur, ctx.y, c.w, computedH, "", c.value, { red: c.red, maxLines: 5 });
    xCur += c.w;
  }
  ctx.y -= computedH;
}

// 4-column key/value grid. Splits the row width into 4 cells of equal width.
// Auto-sizing 4-col grid: each row of 4 sizes to fit the longest wrapped value.
function drawKVGrid(ctx: Ctx, pairs: { label: string; value: string; red?: boolean }[], minCellH = 26) {
  if (pairs.length === 0) return;
  const totalW = ctx.width - ctx.margin*2;
  const cellW = totalW / 4;
  const valueSize = 8.5;
  const lineH = valueSize + 2;
  for (let i = 0; i < pairs.length; i += 4) {
    const slice = pairs.slice(i, i + 4);
    let maxLines = 1;
    for (const p of slice) {
      if (!p || !p.value || p.value === "-") continue;
      const lines = wrapText(p.value, ctx.bold, valueSize, cellW - 8, 5);
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const cellH = Math.max(minCellH, 16 + maxLines * lineH);
    ensureSpace(ctx, cellH);
    let xCur = ctx.margin;
    for (let j = 0; j < 4; j++) {
      const p = slice[j];
      if (p) {
        drawCell(ctx, xCur, ctx.y, cellW, cellH, p.label, p.value, { red: p.red, maxLines: 5 });
      } else {
        ctx.page.drawRectangle({ x: xCur, y: ctx.y - cellH, width: cellW, height: cellH, color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5 });
      }
      xCur += cellW;
    }
    ctx.y -= cellH;
  }
}

// 2-col layout for long values like address
function drawWide(ctx: Ctx, label: string, value: string, h = 24, red = false) {
  ensureSpace(ctx, h);
  drawCell(ctx, ctx.margin, ctx.y, ctx.width - ctx.margin*2, h, label, value, { red });
  ctx.y -= h;
}

function fmtAddress(addr: any): string {
  if (!addr || typeof addr !== "object") return "-";
  return [addr.line1, addr.line2, addr.city, addr.district, addr.state, addr.pincode, addr.country]
    .filter(Boolean).join(", ") || "-";
}

function fmtPersonName(p: any): string {
  if (!p || typeof p !== "object") return "-";
  return [p.title, p.first_name, p.middle_name, p.last_name, p.name].filter(Boolean).join(" ") || (p.name || "-");
}

// ───────────────────────── builder ─────────────────────────

// ───────────────────────── handler ─────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { application_id } = await req.json();
    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: app, error: appErr } = await admin
      .from("applications").select("*").eq("application_id", application_id).maybeSingle();
    if (appErr || !app) {
      return new Response(JSON.stringify({ error: appErr?.message || "Application not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: app.lead_id, _doc_type: "application_form",
    });

    // Resolve session name for the header.
    let sessionName: string | null = null;
    if (app.session_id) {
      const { data: sess } = await admin.from("admission_sessions").select("name").eq("id", app.session_id).maybeSingle();
      sessionName = sess?.name || null;
    }

    // Eligibility rules for every selected course (for mismatch flags).
    const courseIds = (app.course_selections || []).map((c: any) => c.course_id).filter(Boolean);
    let eligibilityRules: any[] = [];
    if (courseIds.length > 0) {
      const { data: rules } = await admin.from("eligibility_rules")
        .select("course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, notes")
        .in("course_id", courseIds);
      eligibilityRules = rules || [];
    }
    const mismatches = computeMismatches(app, eligibilityRules);

    // List uploaded files for this application from storage.
    const documents: { name: string; url: string }[] = [];
    let photoUrl: string | null = null;
    try {
      const { data: files } = await admin.storage.from("application-documents").list(app.application_id, {
        limit: 200, sortBy: { column: "name", order: "asc" },
      });
      // Photo conventions vary - PhotoUpload uses passport_photo.png; school
      // form uses student_photo-*.png; admins might upload applicant_photo*.
      // Pick the first file matching any of these patterns.
      const photoPattern = /^(passport_photo|student_photo|applicant_photo)/i;
      for (const f of (files ?? [])) {
        if (!f.name) continue;
        const path = `${app.application_id}/${f.name}`;
        const { data: pub } = admin.storage.from("application-documents").getPublicUrl(path);
        const url = pub?.publicUrl || path;
        if (!photoUrl && photoPattern.test(f.name)) {
          photoUrl = url;
        } else if (photoPattern.test(f.name)) {
          // Already picked a photo - skip duplicates.
        } else {
          // File names are uploaded as `${docKey}-${original_filename}`. Pull
          // the docKey out of the prefix and resolve to the friendly label.
          const dashIdx = f.name.indexOf("-");
          const docKey = dashIdx > 0 ? f.name.substring(0, dashIdx) : f.name.replace(/\.[^.]+$/, "");
          documents.push({ name: docLabel(docKey), url });
        }
      }
    } catch (e) {
      console.error("[application-form] storage list failed:", (e as Error).message);
    }

    // Look up the application-fee payment for this lead so we can render
    // the receipt details (ref, amount, paid-on timestamp) on the form.
    let appFeePayment: any = null;
    if (app.lead_id) {
      const { data: lp } = await admin
        .from("lead_payments")
        .select("amount, payment_mode, gateway, transaction_ref, receipt_no, payment_date, created_at, status")
        .eq("lead_id", app.lead_id)
        .eq("type", "application_fee")
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      appFeePayment = lp || null;
    }
    // Fall back to applications.payment_ref if no lead_payments row exists yet
    // (older flow stored the gateway ref directly on applications).
    if (!appFeePayment && app.payment_status === "paid") {
      appFeePayment = {
        amount: app.fee_amount,
        payment_mode: "gateway",
        gateway: "easebuzz", // pre-ICICI applications were all routed through Easebuzz
        transaction_ref: app.payment_ref,
        receipt_no: null,
        payment_date: app.submitted_at || app.updated_at,
        status: "confirmed",
      };
    }

    // Build PDF (embeds letterhead/footer/photo/signature in the same doc).
    const p = await PDFDocument.create();
    const f = await p.embedFont(StandardFonts.Helvetica);
    const b = await p.embedFont(StandardFonts.HelveticaBold);
    const lh    = await fetchImage(p, branding?.letterhead_url ?? null);
    const ftr   = await fetchImage(p, branding?.footer_url ?? null);
    const photo = await fetchImage(p, photoUrl);
    const sig   = await fetchImage(p, branding?.signature_url ?? null);
    const out = await buildApplicationPdfInline(p, f, b, app, branding, lh, ftr, photo, sig, documents, appFeePayment, sessionName, mismatches);

    const path = `applications/${app.application_id}.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, out, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pub } = admin.storage.from("application-documents").getPublicUrl(path);
    const formUrl = pub?.publicUrl || path;
    await admin.from("applications").update({ form_pdf_url: formUrl }).eq("id", app.id);

    return new Response(JSON.stringify({ ok: true, form_pdf_url: formUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[application-form] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Same logic as buildApplicationPdf but uses the caller-provided pdf/font/images
// instead of creating fresh ones. Avoids double-embedding work.
async function buildApplicationPdfInline(
  pdf: PDFDocument, font: any, bold: any,
  app: any, branding: any,
  lhImg: PDFImage | null, footerImg: PDFImage | null,
  photoImg: PDFImage | null, sigImg: PDFImage | null,
  documents: { name: string; url: string }[],
  appFeePayment: any = null,
  sessionName: string | null = null,
  mismatches: Mismatch[] = [],
): Promise<Uint8Array> {
  // Helper to render an inline red callout strip. Used right after each
  // section that has a mismatch flagged for it.
  const renderMismatch = (ctx: Ctx, sec: MismatchSection) => {
    const m = mismatches.find(x => x.section === sec);
    if (!m) return;
    const lines = wrapText(m.message, font, 8, ctx.width - ctx.margin*2 - 16, 4);
    const h = 6 + lines.length * 11 + 8;
    ensureSpace(ctx, h + 4);
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - h, width: ctx.width - ctx.margin*2, height: h,
      color: COLORS.redFill, borderColor: COLORS.redBorder, borderWidth: 0.8,
    });
    ctx.page.drawText("Eligibility Mismatch:", {
      x: ctx.margin + 8, y: ctx.y - 11, size: 8, font: bold, color: COLORS.redBorder,
    });
    lines.forEach((line, i) => {
      ctx.page.drawText(line, {
        x: ctx.margin + 8 + (i === 0 ? 84 : 0),
        y: ctx.y - 11 - i * 11,
        size: 8, font, color: COLORS.text,
      });
    });
    ctx.y -= h + 4;
  };
  const flags = new Set<string>(Array.isArray(app.flags) ? app.flags : []);
  const ctx: Ctx = {
    pdf, page: null, font, bold,
    width: 595, height: 842, margin: 36, y: 0,
    contentStart: 0, contentEnd: 0,
    branding: { ...(branding || {}), _lh: lhImg, _footer: footerImg },
    hasLetterhead: !!lhImg,
    flags,
    appId: app.application_id,
    sessionName,
  };
  await newPage(ctx);

  // ── COURSE PREFERENCES + PHOTO (split layout) ──
  const courses: any[] = Array.isArray(app.course_selections) ? app.course_selections : [];
  drawSection(ctx, "Course Preferences");

  // Photo takes its natural width, anchored to the right margin. Prefs fill
  // the rest of the row - no fixed-percentage column means no awkward gap.
  const photoW = 110;
  const photoH = Math.round(photoW * 1.3);
  const gutter = 12;
  const leftW  = ctx.width - ctx.margin*2 - photoW - gutter;

  const blockTop = ctx.y;
  const photoX = ctx.width - ctx.margin - photoW;
  const photoY = blockTop - 4;
  ctx.page.drawRectangle({
    x: photoX, y: photoY - photoH, width: photoW, height: photoH,
    color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  if (photoImg) {
    ctx.page.drawImage(photoImg, { x: photoX + 1, y: photoY - photoH + 1, width: photoW - 2, height: photoH - 2 });
  } else {
    ctx.page.drawText("Paste Your Recent", { x: photoX + 6, y: photoY - 26, size: 7, font, color: COLORS.muted });
    ctx.page.drawText("Passport Size",     { x: photoX + 6, y: photoY - 38, size: 7, font, color: COLORS.muted });
    ctx.page.drawText("Photograph Here",   { x: photoX + 6, y: photoY - 50, size: 7, font, color: COLORS.muted });
  }

  // Render preferences confined to the left column.
  const drawPrefHeader = (label: string) => {
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - 14, width: leftW, height: 14,
      color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5,
    });
    ctx.page.drawText(label, { x: ctx.margin + 4, y: ctx.y - 11, size: 7.5, font: bold, color: COLORS.text });
    ctx.y -= 14;
  };
  const drawPrefRow = (cols: { label: string; value: string; w: number }[]) => {
    let xCur = ctx.margin;
    for (const c of cols) {
      ctx.page.drawRectangle({ x: xCur, y: ctx.y - 14, width: c.w, height: 14, color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5 });
      ctx.page.drawText(c.label, { x: xCur + 4, y: ctx.y - 11, size: 7.5, font: bold, color: COLORS.text });
      xCur += c.w;
    }
    ctx.y -= 14;
    let maxLines = 1;
    for (const c of cols) {
      const lines = wrapText(c.value || "", ctx.bold, 8.5, c.w - 8, 5);
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const rowH = Math.max(22, 10 + maxLines * 10.5);
    xCur = ctx.margin;
    for (const c of cols) {
      drawCell(ctx, xCur, ctx.y, c.w, rowH, "", c.value, { maxLines: 5 });
      xCur += c.w;
    }
    ctx.y -= rowH;
  };

  // Render every selected preference (count is variable - user might pick 1
  // or 5). After the last one, append a single muted closer indicating
  // there are no further preferences. If none are selected at all, show a
  // single line saying so.
  const validCourses = courses.filter(c => c && (c.course_name || c.campus_name || c.program_category));
  if (validCourses.length === 0) {
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - 18, width: leftW, height: 18,
      color: rgb(0.97, 0.97, 0.99), borderColor: COLORS.border, borderWidth: 0.5,
    });
    ctx.page.drawText("No Course Preferences Selected", {
      x: ctx.margin + 8, y: ctx.y - 12, size: 9, font: bold, color: COLORS.muted,
    });
    ctx.y -= 18;
  } else {
    validCourses.forEach((c, i) => {
      drawPrefHeader(`Preference ${i + 1}`);
      drawPrefRow([
        { label: "Course Category", value: norm(c.program_category), w: leftW * 0.22 },
        { label: "Course Name",     value: norm(c.course_name),      w: leftW * 0.52 },
        { label: "Campus",          value: norm(c.campus_name),      w: leftW * 0.26 },
      ]);
    });
    // Closer row.
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - 18, width: leftW, height: 18,
      color: rgb(0.97, 0.97, 0.99), borderColor: COLORS.border, borderWidth: 0.5,
    });
    ctx.page.drawText("Additional Course Preferences: Not Selected", {
      x: ctx.margin + 8, y: ctx.y - 12, size: 9, font: bold, color: COLORS.muted,
    });
    ctx.y -= 18;
  }

  // Sync ctx.y to whichever column ended lower.
  const photoBottom = photoY - photoH - 8;
  if (photoBottom < ctx.y) ctx.y = photoBottom;

  // ── PERSONAL DETAILS ───────────────────────────────────────────────
  drawSection(ctx, "Personal Details");
  drawKVGrid(ctx, [
    { label: "Full Name",       value: norm(app.full_name) },
    { label: "Gender",          value: norm(app.gender) },
    { label: "Date of Birth",   value: fmtDate(app.dob) },
    { label: "Category",        value: norm(app.category) },
    { label: "Nationality",     value: norm(app.nationality) },
    { label: "Aadhaar Number",  value: norm(app.aadhaar) },
    { label: "Passport Number", value: norm(app.passport_number) },
    { label: "APAAR ID",        value: norm(app.apaar_id) },
    { label: "PEN Number",      value: norm(app.pen_number) },
    { label: "Mobile (WhatsApp)", value: norm(app.phone) + (app.whatsapp_verified ? "  (Verified)" : "") },
    { label: "Email",           value: norm(app.email) },
    { label: "",                value: "" },
  ]);
  renderMismatch(ctx, "personal");

  // ── ADDRESS ────────────────────────────────────────────────────────
  drawSection(ctx, "Address");
  const a = app.address || {};
  // PIN Code before Country; Country only when set.
  const addrPairs = [
    { label: "Address Line 1", value: norm(a.line1) },
    { label: "City",           value: norm(a.city) },
    { label: "State",          value: norm(a.state) },
    { label: "PIN Code",       value: norm(a.pin_code) },
  ];
  if (norm(a.country) !== "-") {
    addrPairs.push({ label: "Country", value: norm(a.country) });
  }
  drawKVGrid(ctx, addrPairs);

  // ── PARENTS / GUARDIAN ─────────────────────────────────────────────
  const parentName = (p: any) => {
    if (!p || typeof p !== "object") return "-";
    const composed = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return norm(composed || p.name);
  };

  // Drop pairs whose value is "-" so empty fields don't render.
  const nonEmpty = (pairs: { label: string; value: string }[]) => pairs.filter(p => p.value && p.value !== "-");

  const f = app.father || {};
  const fatherPairs = nonEmpty([
    { label: "Name",            value: parentName(f) },
    { label: "Date of Birth",   value: fmtDate(f.dob) },
    { label: "Nationality",     value: norm(f.nationality) },
    { label: "Marital Status",  value: norm(f.marital_status) },
    { label: "ID Type",         value: norm(f.id_type) },
    { label: "ID Number",       value: norm(f.id_number) },
    { label: "Education",       value: norm(f.education) },
    { label: "Annual Income",   value: norm(f.annual_income) },
    { label: "Employer",        value: norm(f.employer_name) },
    { label: "Position",        value: norm(f.current_position) },
    { label: "Occupation",      value: norm(f.occupation) },
    { label: "Mobile",          value: norm(f.phone_mobile || f.phone) },
    { label: "Home Phone",      value: norm(f.phone_home) },
    { label: "Email",           value: norm(f.email) },
  ]);
  if (fatherPairs.length > 0) {
    drawSection(ctx, "Father's Details");
    drawKVGrid(ctx, fatherPairs);
  }

  const m = app.mother || {};
  const motherPairs = nonEmpty([
    { label: "Name",            value: parentName(m) },
    { label: "Date of Birth",   value: fmtDate(m.dob) },
    { label: "Nationality",     value: norm(m.nationality) },
    { label: "Marital Status",  value: norm(m.marital_status) },
    { label: "ID Type",         value: norm(m.id_type) },
    { label: "ID Number",       value: norm(m.id_number) },
    { label: "Education",       value: norm(m.education) },
    { label: "Annual Income",   value: norm(m.annual_income) },
    { label: "Employer",        value: norm(m.employer_name) },
    { label: "Position",        value: norm(m.current_position) },
    { label: "Occupation",      value: norm(m.occupation) },
    { label: "Mobile",          value: norm(m.phone_mobile || m.phone) },
    { label: "Home Phone",      value: norm(m.phone_home) },
    { label: "Email",           value: norm(m.email) },
  ]);
  if (motherPairs.length > 0) {
    drawSection(ctx, "Mother's Details");
    drawKVGrid(ctx, motherPairs);
  }

  const g = app.guardian || {};
  if (g.name || g.phone || g.email) {
    drawSection(ctx, "Local Guardian");
    drawKVGrid(ctx, [
      { label: "Name",         value: norm(g.name) },
      { label: "Relationship", value: norm(g.relationship) },
      { label: "Mobile",       value: norm(g.phone) },
      { label: "Email",        value: norm(g.email) },
    ]);
  }

  // ── ACADEMIC DETAILS ───────────────────────────────────────────────
  const ad = app.academic_details || {};
  const customBoardFlag      = flags.has("custom_board");
  const customUniversityFlag = flags.has("custom_university");

  drawSection(ctx, "Academic Details");

  // Helper to render a board name with the "Other → board_other" fallback.
  const boardOf = (q: any) => {
    if (!q) return "-";
    if (q.board === "Other" || q.board === "Other (not in list)") return norm(q.board_other) + " (custom)";
    return norm(q.board);
  };
  const universityOf = (q: any) => {
    if (!q) return "-";
    if (q.university === "Other" || q.university === "Other (not in list)") return norm(q.university_other) + " (custom)";
    return norm(q.university);
  };

  // Class 10
  if (ad.class_10) {
    drawHeaderRow(ctx, [{ label: "Class 10 / SSC", w: ctx.width - ctx.margin*2 }], 14);
    const c10 = ad.class_10;
    const cols10 = [
      { label: "School",        w: (ctx.width - ctx.margin*2) * 0.32 },
      { label: "Board",         w: (ctx.width - ctx.margin*2) * 0.34 },
      { label: "Year",          w: (ctx.width - ctx.margin*2) * 0.10 },
      { label: "Result Status", w: (ctx.width - ctx.margin*2) * 0.14 },
      { label: "Marks",         w: (ctx.width - ctx.margin*2) * 0.10 },
    ];
    drawHeaderRow(ctx, cols10, 14);
    drawValueRow(ctx, [
      { value: norm(c10.school),        w: cols10[0].w },
      { value: boardOf(c10),            w: cols10[1].w, red: customBoardFlag && (c10.board === "Other" || c10.board === "Other (not in list)") },
      { value: norm(c10.year),          w: cols10[2].w },
      { value: norm(c10.result_status), w: cols10[3].w },
      { value: norm(c10.marks),         w: cols10[4].w },
    ], 28);
  }

  // Class 12
  if (ad.class_12) {
    drawHeaderRow(ctx, [{ label: "Class 12 / HSC", w: ctx.width - ctx.margin*2 }], 14);
    const c12 = ad.class_12;
    const cols12 = [
      { label: "School",          w: (ctx.width - ctx.margin*2) * 0.22 },
      { label: "Board",           w: (ctx.width - ctx.margin*2) * 0.22 },
      { label: "Subjects/Stream", w: (ctx.width - ctx.margin*2) * 0.30 },
      { label: "Year",            w: (ctx.width - ctx.margin*2) * 0.08 },
      { label: "Result",          w: (ctx.width - ctx.margin*2) * 0.10 },
      { label: "Marks",           w: (ctx.width - ctx.margin*2) * 0.08 },
    ];
    drawHeaderRow(ctx, cols12, 14);
    drawValueRow(ctx, [
      { value: norm(c12.school),        w: cols12[0].w },
      { value: boardOf(c12),            w: cols12[1].w, red: customBoardFlag && (c12.board === "Other" || c12.board === "Other (not in list)") },
      { value: norm(c12.subjects),      w: cols12[2].w },
      { value: norm(c12.year),          w: cols12[3].w },
      { value: norm(c12.result_status) + (c12.expected_month ? " (" + c12.expected_month + ")" : ""), w: cols12[4].w },
      { value: norm(c12.marks),         w: cols12[5].w },
    ], 28);
    renderMismatch(ctx, "class_12");
    renderMismatch(ctx, "class_12_board");
  }

  // Graduation
  if (ad.graduation && (ad.graduation.degree || ad.graduation.university || ad.graduation.college)) {
    drawHeaderRow(ctx, [{ label: "Graduation", w: ctx.width - ctx.margin*2 }], 14);
    drawKVGrid(ctx, [
      { label: "Degree",      value: norm(ad.graduation.degree) },
      { label: "University",  value: universityOf(ad.graduation), red: customUniversityFlag && (ad.graduation.university === "Other" || ad.graduation.university === "Other (not in list)") },
      { label: "College",     value: norm(ad.graduation.college) },
      { label: "Year",        value: norm(ad.graduation.year) },
      { label: "Result",      value: norm(ad.graduation.result_status) },
      { label: "Marks",       value: norm(ad.graduation.marks) },
      { label: "Sem Done",    value: norm(ad.graduation.semesters_completed) },
      { label: "CGPA till sem", value: norm(ad.graduation.cgpa_till_sem) },
    ]);
    renderMismatch(ctx, "graduation");
    renderMismatch(ctx, "graduation_uni");
  }

  // Additional qualifications
  const addl: any[] = Array.isArray(ad.additional_qualifications) ? ad.additional_qualifications : [];
  addl.forEach((q, i) => {
    if (!q || (!q.degree && !q.university && !q.college)) return;
    drawHeaderRow(ctx, [{ label: `Additional Qualification ${i + 1}`, w: ctx.width - ctx.margin*2 }], 14);
    drawKVGrid(ctx, [
      { label: "Degree",      value: norm(q.degree) },
      { label: "University",  value: universityOf(q), red: customUniversityFlag && (q.university === "Other" || q.university === "Other (not in list)") },
      { label: "College",     value: norm(q.college) },
      { label: "Year",        value: norm(q.year) },
      { label: "Result",      value: norm(q.result_status) },
      { label: "Marks",       value: norm(q.marks) },
      { label: "Sem Done",    value: norm(q.semesters_completed) },
      { label: "CGPA till sem", value: norm(q.cgpa_till_sem) },
    ]);
  });

  // Entrance exams
  const exams: any[] = Array.isArray(ad.entrance_exams) ? ad.entrance_exams : [];
  if (exams.length > 0) {
    drawHeaderRow(ctx, [{ label: "Entrance Exams", w: ctx.width - ctx.margin*2 }], 14);
    const cols = [
      { label: "Exam",          w: (ctx.width - ctx.margin*2) * 0.40 },
      { label: "Status",        w: (ctx.width - ctx.margin*2) * 0.20 },
      { label: "Score",         w: (ctx.width - ctx.margin*2) * 0.20 },
      { label: "Expected Date", w: (ctx.width - ctx.margin*2) * 0.20 },
    ];
    drawHeaderRow(ctx, cols, 14);
    exams.forEach(e => {
      drawValueRow(ctx, [
        { value: norm(e.exam_name), w: cols[0].w },
        { value: norm(e.status),    w: cols[1].w },
        { value: norm(e.score),     w: cols[2].w },
        { value: fmtDate(e.expected_date), w: cols[3].w },
      ], 22);
    });
    renderMismatch(ctx, "entrance");
  } else {
    // No exams declared at all - still surface the requirement if any course needs one.
    renderMismatch(ctx, "entrance");
  }

  // Previous school (school program)
  if (ad.previous_school && (ad.previous_school.prev_school_name || ad.previous_school.board)) {
    drawHeaderRow(ctx, [{ label: "Previous School", w: ctx.width - ctx.margin*2 }], 14);
    drawKVGrid(ctx, [
      { label: "School Name",   value: norm(ad.previous_school.prev_school_name) },
      { label: "Board",         value: norm(ad.previous_school.board) },
      { label: "Last Class",    value: norm(ad.previous_school.last_class) },
      { label: "Academic Year", value: norm(ad.previous_school.academic_year) },
      { label: "Percentage",    value: norm(ad.previous_school.percentage) },
      { label: "TC Available",  value: norm(ad.previous_school.tc_available) },
    ]);
  }

  // ── EXTRACURRICULAR ────────────────────────────────────────────────
  const ec = app.extracurricular || {};
  const ecPairs = [
    { label: "Achievements",  value: norm(ec.achievements) },
    { label: "Competitions",  value: norm(ec.competitions) },
    { label: "Leadership",    value: norm(ec.leadership) },
    { label: "Sports",        value: norm(ec.sports) },
    { label: "Volunteer",     value: norm(ec.volunteer) },
    { label: "Portfolio URL", value: norm(ec.portfolio) },
    { label: "LinkedIn",      value: norm(ec.linkedin) },
  ].filter(p => p.value !== "-");
  if (ecPairs.length > 0) {
    drawSection(ctx, "Extracurricular");
    ecPairs.forEach(p => drawWide(ctx, p.label, p.value));
  }

  // ── APPLICATION FEE PAYMENT ────────────────────────────────────────
  drawSection(ctx, "Application Fee Payment");
  if (appFeePayment) {
    const gatewayLabel: Record<string, string> = {
      easebuzz: "Easebuzz Gateway",
      icici:    "ICICI Gateway",
      cashfree: "Cashfree Gateway",
    };
    const modeLabel: Record<string, string> = {
      cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer / NEFT",
      cheque: "Cheque / DD", online: "Online",
    };
    let modeText: string;
    if (appFeePayment.payment_mode === "gateway" || appFeePayment.payment_mode === "online") {
      const gw = appFeePayment.gateway ? gatewayLabel[appFeePayment.gateway] || appFeePayment.gateway : null;
      modeText = gw ? `Online (${gw})` : "Online (Gateway)";
    } else {
      modeText = modeLabel[appFeePayment.payment_mode] || appFeePayment.payment_mode || "-";
    }
    const paidAt = appFeePayment.payment_date || appFeePayment.created_at;
    const paidAtStr = paidAt ? new Date(paidAt).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }) + " IST" : "-";
    drawKVGrid(ctx, [
      { label: "Status",          value: "PAID" },
      { label: "Amount",          value: appFeePayment.amount != null ? `Rs. ${Number(appFeePayment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-" },
      { label: "Payment Mode",    value: norm(modeText) },
      { label: "Receipt No",      value: norm(appFeePayment.receipt_no) },
      { label: "Transaction Ref", value: norm(appFeePayment.transaction_ref) },
      { label: "Paid On",         value: paidAtStr.toUpperCase() },
      { label: "",                value: "" },
      { label: "",                value: "" },
    ]);
  } else {
    drawKVGrid(ctx, [
      { label: "Status",         value: norm(app.payment_status || "PENDING") },
      { label: "Amount",         value: app.fee_amount != null ? `Rs. ${Number(app.fee_amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-" },
      { label: "Transaction Ref", value: norm(app.payment_ref) },
      { label: "",               value: "" },
    ]);
  }

  // ── DOCUMENTS UPLOADED (with clickable links) ──────────────────────
  drawSection(ctx, "Documents Uploaded");
  if (documents.length === 0) {
    drawWide(ctx, "Status", "No documents uploaded yet.");
  } else {
    const colsD = [
      { label: "#",             w: 24 },
      { label: "Document Name", w: (ctx.width - ctx.margin*2 - 24) * 0.65 },
      { label: "File",          w: (ctx.width - ctx.margin*2 - 24) * 0.35 },
    ];
    drawHeaderRow(ctx, colsD, 14);
    documents.forEach((d, i) => {
      ensureSpace(ctx, 18);
      drawCell(ctx, ctx.margin, ctx.y, colsD[0].w, 18, "", String(i + 1));
      drawCell(ctx, ctx.margin + colsD[0].w, ctx.y, colsD[1].w, 18, "", d.name);
      const fileX = ctx.margin + colsD[0].w + colsD[1].w;
      ctx.page.drawRectangle({ x: fileX, y: ctx.y - 18, width: colsD[2].w, height: 18, color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5 });
      // Render "View Document" as a hyperlink — underlined blue text. The
      // PDF Link annotation makes the cell area clickable in any reader.
      const linkText = "View Document";
      const linkSize = 9;
      const linkX = fileX + 6;
      const linkY = ctx.y - 12;
      ctx.page.drawText(linkText, { x: linkX, y: linkY, size: linkSize, font: ctx.bold, color: COLORS.link });
      // Underline.
      const linkW = ctx.bold.widthOfTextAtSize(linkText, linkSize);
      ctx.page.drawLine({
        start: { x: linkX, y: linkY - 1.5 },
        end:   { x: linkX + linkW, y: linkY - 1.5 },
        thickness: 0.5, color: COLORS.link,
      });
      addLinkAnnotation(ctx, fileX, ctx.y - 18, colsD[2].w, 18, d.url);
      ctx.y -= 18;
    });
  }

  // ── DECLARATION AND UNDERTAKING ────────────────────────────────────
  drawSection(ctx, "Declaration and Undertaking");
  const declParas: { text: string; emphasis?: boolean }[] = [
    {
      text:
        "I declare that all information and documents submitted by me are genuine, complete, and accurate. " +
        "I understand that if any document or information is found to be fake, forged, incorrect, or modified at any stage, " +
        "my admission shall be cancelled immediately and no fee shall be refunded by NIMT Educational Institutions. " +
        "I undertake to produce all original documents for verification upon request and to promptly inform the Institution " +
        "of any subsequent changes to my submitted information.",
    },
    {
      text:
        "I agree to abide by all rules, regulations, and the code of conduct of NIMT Educational Institutions, as well as " +
        "those of the affiliating university and applicable statutory/regulatory approval bodies, as amended from time to time, " +
        "including requirements relating to attendance and discipline. I shall neither engage in nor tolerate ragging in any form " +
        "and accept that the Institution may take disciplinary action for any violation. I further declare that I am not suffering " +
        "from any serious, contagious, or psychiatric/psychological condition.",
    },
    {
      text:
        "ALL FEES ARE STRICTLY NON-REFUNDABLE. I unconditionally accept that all fees paid to NIMT Educational Institutions - " +
        "including application, registration, tuition, hostel, examination, and any other charges - are non-refundable under any " +
        "circumstances, whether due to voluntary withdrawal, cancellation by the Institution, disciplinary action, or any other reason. " +
        "I shall have no claim to any refund at any stage.",
      emphasis: true,
    },
  ];
  const declSize = 8;
  const declLineH = 11;
  const declWidth = ctx.width - ctx.margin*2;
  const padTop = 6;     // space above first line
  const padBottom = 8;  // space below last line's descender
  const sidePad = 8;    // horizontal padding inside the emphasis box
  declParas.forEach(para => {
    // Wrap inside the available text width — narrower for emphasis paragraphs
    // so the text never touches the red border.
    const innerWidth = para.emphasis ? declWidth - sidePad*2 : declWidth;
    const lines = wrapText(para.text, para.emphasis ? bold : font, declSize, innerWidth, 30);
    const paraH = padTop + lines.length * declLineH + padBottom;
    ensureSpace(ctx, paraH);
    if (para.emphasis) {
      ctx.page.drawRectangle({
        x: ctx.margin, y: ctx.y - paraH, width: declWidth, height: paraH,
        color: COLORS.redFill, borderColor: COLORS.redBorder, borderWidth: 0.6,
      });
    }
    lines.forEach((line, i) => {
      ctx.page.drawText(line, {
        x: ctx.margin + (para.emphasis ? sidePad : 0),
        y: ctx.y - padTop - declSize - i * declLineH,
        size: declSize,
        font: para.emphasis ? bold : font,
        color: COLORS.text,
      });
    });
    ctx.y -= paraH + 4;
  });

  // ── APPLICANT META (name / parent / submission date / place) ──────
  ensureSpace(ctx, 36);
  ctx.y -= 6;
  const sigCols = [
    { label: "Applicant Name", value: norm(app.full_name) },
    { label: "Parent Name",    value: parentName(f) === "-" ? parentName(m) : parentName(f) },
    { label: "Submission Date", value: fmtDate(app.submitted_at || app.updated_at) },
    { label: "Place",          value: norm(a.city) },
  ];
  const totalW = ctx.width - ctx.margin*2;
  let xCur = ctx.margin;
  for (const c of sigCols) {
    drawCell(ctx, xCur, ctx.y, totalW / 4, 30, c.label, c.value);
    xCur += totalW / 4;
  }
  ctx.y -= 32;

  // ── STUDENT SIGNATURE ─────────────────────────────────────────────
  drawSection(ctx, "Student Signature");
  ensureSpace(ctx, 70);
  // Two boxes: signature space (left, larger) and date (right, smaller).
  const sigBoxW = totalW * 0.65;
  const sigDateW = totalW * 0.35;
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - 60, width: sigBoxW, height: 60,
    color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("Signature of Applicant", {
    x: ctx.margin + 6, y: ctx.y - 11, size: 7, font, color: COLORS.muted,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin + 12,         y: ctx.y - 50 },
    end:   { x: ctx.margin + sigBoxW - 12, y: ctx.y - 50 },
    thickness: 0.4, color: COLORS.muted,
  });

  ctx.page.drawRectangle({
    x: ctx.margin + sigBoxW, y: ctx.y - 60, width: sigDateW, height: 60,
    color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("Date", {
    x: ctx.margin + sigBoxW + 6, y: ctx.y - 11, size: 7, font, color: COLORS.muted,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin + sigBoxW + 12,         y: ctx.y - 50 },
    end:   { x: ctx.margin + sigBoxW + sigDateW - 12, y: ctx.y - 50 },
    thickness: 0.4, color: COLORS.muted,
  });
  ctx.y -= 64;

  // ── PRINCIPAL / DIRECTOR VERIFICATION ─────────────────────────────
  drawSection(ctx, "Principal / Director Verification (For Office Use Only)");
  ensureSpace(ctx, 110);

  // Two-row layout:
  //   Row 1: Verified (checkbox space) | Name / Designation | Date
  //   Row 2: Remarks (full width)
  //   Row 3: Signature (with signatory image if available, or empty space)

  const verifyRowH = 32;
  const colA = totalW * 0.30;
  const colB = totalW * 0.40;
  const colC = totalW * 0.30;

  drawCell(ctx, ctx.margin,                  ctx.y, colA, verifyRowH, "Verified By (Name)", " ", { });
  drawCell(ctx, ctx.margin + colA,           ctx.y, colB, verifyRowH, "Designation", " ", { });
  drawCell(ctx, ctx.margin + colA + colB,    ctx.y, colC, verifyRowH, "Date", " ", { });
  ctx.y -= verifyRowH;

  // Remarks — full width, taller for handwritten note.
  drawCell(ctx, ctx.margin, ctx.y, totalW, 36, "Remarks", " ", { });
  ctx.y -= 36;

  // Signature row — institute signature image on the right if present;
  // signature line for principal/director on the left.
  const signRowH = 50;
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - signRowH, width: totalW * 0.55, height: signRowH,
    color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("Principal / Director Signature & Seal", {
    x: ctx.margin + 6, y: ctx.y - 11, size: 7, font, color: COLORS.muted,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin + 12,                      y: ctx.y - 38 },
    end:   { x: ctx.margin + totalW * 0.55 - 12,       y: ctx.y - 38 },
    thickness: 0.4, color: COLORS.muted,
  });

  // Right-side authority signature block (uses branding signature image).
  ctx.page.drawRectangle({
    x: ctx.margin + totalW * 0.55, y: ctx.y - signRowH, width: totalW * 0.45, height: signRowH,
    color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("For the Institution", {
    x: ctx.margin + totalW * 0.55 + 6, y: ctx.y - 11, size: 7, font, color: COLORS.muted,
  });
  if (sigImg) {
    const sigW = 80, sigH = 28;
    ctx.page.drawImage(sigImg, {
      x: ctx.margin + totalW * 0.55 + 8,
      y: ctx.y - signRowH + 12,
      width: sigW, height: sigH,
    });
  } else {
    ctx.page.drawLine({
      start: { x: ctx.margin + totalW * 0.55 + 12, y: ctx.y - 38 },
      end:   { x: ctx.margin + totalW - 12,         y: ctx.y - 38 },
      thickness: 0.4, color: COLORS.muted,
    });
  }
  ctx.page.drawText(norm(branding?.signatory_name) === "-" ? "AUTHORISED SIGNATORY" : norm(branding?.signatory_name), {
    x: ctx.margin + totalW * 0.55 + 6, y: ctx.y - signRowH + 4, size: 7, font: bold, color: COLORS.text,
  });
  ctx.y -= signRowH + 4;

  // Two-pass page numbering: stamp "Page X of Y" centered near the bottom
  // of every page (just inside the footer reserve). Done after all content
  // is laid out so the total count is final.
  const pages = pdf.getPages();
  const total = pages.length;
  pages.forEach((page, idx) => {
    const text = `Page ${idx + 1} of ${total}`;
    const w = font.widthOfTextAtSize(text, 8);
    page.drawText(text, {
      x: (page.getSize().width - w) / 2,
      y: 24, // sits above the bottom margin
      size: 8, font, color: COLORS.muted,
    });
  });

  return await pdf.save();
}

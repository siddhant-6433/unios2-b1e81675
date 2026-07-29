/**
 * Offer letter PDF generator.
 *
 * Visual style mirrors `generate-application-form` so both PDFs feel like one
 * document family — same letterhead handling, same dark-navy section bars,
 * same green pill badge top-right with the application id, same Helvetica/Bold
 * pair, same fee-table layout. The helpers below are intentionally near-copies
 * of the application-form ones (margins, colours, badge geometry) to keep the
 * two PDFs visually consistent.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, PDFFont, PDFPage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { uploadToR2 } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ───────────────────────── helpers ─────────────────────────

async function fetchImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    const looksPng = ct.includes("png") || url.toLowerCase().endsWith(".png");
    try {
      return looksPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      try { return looksPng ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes); }
      catch { return null; }
    }
  } catch (e) {
    console.error("[offer-letter] image fetch failed:", url, (e as Error).message);
    return null;
  }
}

const fmtINR = (n: number) =>
  "Rs. " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value: string | null | undefined): boolean {
  return UUID_RE.test(String(value || "").trim());
}

const SCHOOL_OFFER_TERM_ORDER = ["admission", "q1", "q2", "q3", "q4"];

function isOfferProgrammeFeeTerm(term: string | null | undefined): boolean {
  const normalized = String(term || "").trim().toLowerCase();
  return /^year_\d+$/.test(normalized) || SCHOOL_OFFER_TERM_ORDER.includes(normalized);
}

// School fee structures list every boarding tier, every transport tier and a
// boarder-only security deposit as separate line items on the same term. Which
// ones belong in the programme fee depends on the chosen mode (persisted on the
// offer). No selection / day scholar without transport = base fee. Keep in sync
// with src/lib/offerFeeTerms.ts and provision-student-fees.
type SchoolStudentType = "day_scholar" | "day_boarder" | "boarder";
type SchoolHostelType = "non_ac" | "ac_central" | "ac_individual";
type SchoolTransportZone = "zone_1" | "zone_2" | "zone_3";
interface SchoolFeeSelection {
  studentType?: SchoolStudentType | null;
  hostelType?: SchoolHostelType | null;
  transportZone?: SchoolTransportZone | null;
}

const HOSTEL_CODE_SUFFIXES: Record<SchoolHostelType, string[]> = {
  non_ac: ["NAC", "B5"],
  ac_central: ["CBA", "B7"],
  ac_individual: ["IBA"],
};
const TRANSPORT_CODE_SUFFIX: Record<SchoolTransportZone, string> = {
  zone_1: "TR1",
  zone_2: "TR2",
  zone_3: "TR3",
};
const DAY_BOARDING_CODE_SUFFIX = "DBA";
const SECURITY_DEPOSIT_CODE_SUFFIX = "SEC";

function includeOfferFeeItem(
  item: { fee_codes?: { code?: string | null; category?: string | null } | null },
  selection?: SchoolFeeSelection | null,
): boolean {
  const category = String(item?.fee_codes?.category ?? "").trim().toLowerCase();
  const code = String(item?.fee_codes?.code ?? "").trim().toUpperCase();
  const studentType: SchoolStudentType = selection?.studentType || "day_scholar";

  if (category === "transport") {
    const zone = selection?.transportZone;
    return !!zone && code.endsWith(TRANSPORT_CODE_SUFFIX[zone]);
  }
  if (category === "hostel") {
    if (studentType === "day_scholar") return false;
    if (studentType === "day_boarder") return code.endsWith(DAY_BOARDING_CODE_SUFFIX);
    if (code.endsWith(DAY_BOARDING_CODE_SUFFIX)) return false;
    const hostelType = selection?.hostelType;
    return !!hostelType && HOSTEL_CODE_SUFFIXES[hostelType].some((s) => code.endsWith(s));
  }
  if (category === "enrollment" && code.endsWith(SECURITY_DEPOSIT_CODE_SUFFIX)) {
    return studentType === "boarder";
  }
  return true;
}

type OfferFeeStructureRow = {
  id: string;
  version?: string | null;
  created_at?: string | null;
  policy?: FeeStructurePolicy | null;
  fee_structure_items?: {
    term: string;
    amount: number;
    fee_codes?: { code?: string | null; name?: string | null; category?: string | null } | null;
  }[] | null;
};

function offerFeeStructureVersionRank(version: string | null | undefined): number {
  const normalized = String(version || "").trim().toLowerCase();
  if (normalized === "new_admission") return 0;
  if (normalized === "standard") return 1;
  if (normalized.includes("existing_parent")) return 3;
  return 2;
}

function feeStructureHasOfferItems(structure: OfferFeeStructureRow): boolean {
  return (structure.fee_structure_items || []).some((item) =>
    isOfferProgrammeFeeTerm(item.term) && Number(item.amount || 0) > 0
  );
}

function pickOfferFeeStructure(structures: OfferFeeStructureRow[] | null | undefined): OfferFeeStructureRow | null {
  const usable = (structures || []).filter(feeStructureHasOfferItems);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    const versionRank = offerFeeStructureVersionRank(a.version) - offerFeeStructureVersionRank(b.version);
    if (versionRank !== 0) return versionRank;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  })[0];
}

function offerFeeTermRank(term: string): number {
  const normalized = String(term || "").trim().toLowerCase();
  const yearMatch = normalized.match(/^year_(\d+)$/);
  if (yearMatch) return Number(yearMatch[1]);
  if (normalized === "security_deposit") return 100.5; // right after admission
  const schoolIndex = SCHOOL_OFFER_TERM_ORDER.indexOf(normalized);
  if (schoolIndex >= 0) return 100 + schoolIndex;
  return 1_000;
}

function firstOfferFeeTerm(items: { term: string; total: number }[]): string {
  return items.find(it => it.term === "year_1")?.term
    || items.find(it => it.term !== "security_deposit")?.term
    || items[0]?.term || "year_1";
}

const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const fmtDeadline = (d?: string | null) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  const weekday = dt.toLocaleDateString("en-IN", { weekday: "long" });
  const month   = dt.toLocaleDateString("en-IN", { month: "long" });
  return `${weekday}, ${ordinal(dt.getDate())} ${month}`;
};

const DEFAULT_INSTITUTION_NAME = "NIMT Educational Institutions";

function sentenceCaseName(value?: string | null): string {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "Applicant";
  return cleaned
    .toLocaleLowerCase("en-IN")
    .replace(/(^|[\s.'-])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("en-IN")}`);
}

function publicApplicationRef(value?: string | null): string | null {
  const cleaned = String(value || "").trim();
  if (!cleaned || isUuidLike(cleaned)) return null;
  return cleaned;
}

function institutionNameForOffer(brandingName?: string | null, campusName?: string | null): string {
  const raw = String(brandingName || DEFAULT_INSTITUTION_NAME).trim() || DEFAULT_INSTITUTION_NAME;
  const base = raw
    .replace(/\s+-\s+Application Form$/i, "")
    .replace(/\s+-\s+.*Campus.*$/i, "")
    .trim() || DEFAULT_INSTITUTION_NAME;
  const campus = String(campusName || "").trim();
  return campus ? `${base} - ${campus}` : base;
}

function isBptOrBmritCourseName(courseName: string | null | undefined): boolean {
  if (!courseName) return false;
  const c = courseName.toLowerCase();
  return (
    c.includes("bpt") ||
    c.includes("physiotherapy") ||
    c.includes("bmrit") ||
    (c.includes("radiology") && c.includes("b.sc")) ||
    (c.includes("radiology") && c.includes("imaging"))
  );
}

function isDeledCourseName(courseName: string | null | undefined): boolean {
  if (!courseName) return false;
  const c = courseName.toLowerCase();
  return (
    c.includes("d.el.ed") ||
    c.includes("d el ed") ||
    c.includes("deled") ||
    (c.includes("diploma") && c.includes("elementary") && c.includes("education")) ||
    c.includes("btc")
  );
}

function isUpdeledExamName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /up\s*d\.?\s*el\.?\s*ed|updeled|d\.?\s*el\.?\s*ed counselling|elementary education counselling/i.test(name);
}

interface ApplicationEntranceExam {
  exam_name?: string | null;
  registration_no?: string | null;
  registered_name?: string | null;
}

interface ApplicationCahetSource {
  application_id?: string | null;
  full_name?: string | null;
  academic_details?: {
    entrance_exams?: ApplicationEntranceExam[] | null;
  } | null;
}

function cahetRegistrationFromApplication(app: ApplicationCahetSource | null): { registration_no: string; document_url: string | null; notes: string | null; registered_at: string | null } | null {
  const exams = app?.academic_details?.entrance_exams;
  if (!Array.isArray(exams)) return null;
  const exam = exams.find((entry) => /cahet/i.test(String(entry?.exam_name || "")));
  const registrationNo = String(exam?.registration_no || "").trim();
  if (!registrationNo) return null;
  const registeredName = String(exam?.registered_name || "").trim();
  return {
    registration_no: registrationNo,
    document_url: null,
    notes: registeredName ? `Name on CAHET form: ${registeredName}` : "Entered in application form",
    registered_at: null,
  };
}

function updeledRegistrationFromApplication(app: ApplicationCahetSource | null): { registration_no: string; document_url: string | null; notes: string | null; registered_at: string | null } | null {
  const exams = app?.academic_details?.entrance_exams;
  if (!Array.isArray(exams)) return null;
  const exam = exams.find((entry) => isUpdeledExamName(String(entry?.exam_name || "")));
  const registrationNo = String(exam?.registration_no || "").trim();
  if (!registrationNo) return null;
  const registeredName = String(exam?.registered_name || "").trim();
  return {
    registration_no: registrationNo,
    document_url: null,
    notes: registeredName ? `Name on UPDELED form: ${registeredName}` : "Entered in application form",
    registered_at: null,
  };
}

const COLORS = {
  border:    rgb(0.55, 0.55, 0.6),
  light:     rgb(0.85, 0.85, 0.88),
  labelBg:   rgb(0.93, 0.93, 0.96),
  sectionBg: rgb(0.10, 0.13, 0.24),
  sectionFg: rgb(1, 1, 1),
  text:      rgb(0.10, 0.10, 0.15),
  muted:     rgb(0.45, 0.45, 0.5),
  accent:    rgb(0.10, 0.30, 0.85),
  hilite:    rgb(0.94, 0.97, 0.94),    // pale green strip behind the headline net-fee
};

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  width: number;
  height: number;
  margin: number;
  y: number;
  contentStart: number;
  contentEnd: number;
  branding: any;
  hasLetterhead: boolean;
  // Top-right pill on every page.
  appId?: string | null;
  sessionName?: string | null;
}

async function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage([595, 842]);
  let topReserve = 90;
  let bottomReserve = 50;

  if (ctx.hasLetterhead && ctx.branding?._lh) {
    const lh = ctx.branding._lh;
    const aspectHW = lh.height / lh.width;

    if (aspectHW >= 1.2) {
      // Tall image — full A4 background. Letterhead artwork already carries its
      // own header + footer, reserve generous padding so we don't overlap.
      ctx.page.drawImage(lh, { x: 0, y: 0, width: ctx.width, height: ctx.height });
      topReserve    = 150;
      bottomReserve = 150;
    } else {
      // Banner / header-only — render at top, native aspect, full-width.
      const lhHeight = ctx.width * aspectHW;
      ctx.page.drawImage(lh, { x: 0, y: ctx.height - lhHeight, width: ctx.width, height: lhHeight });
      topReserve = lhHeight + 16;

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
    // Default branded header band when no letterhead is supplied.
    ctx.page.drawRectangle({ x: 0, y: ctx.height - 70, width: ctx.width, height: 70, color: COLORS.sectionBg });
    ctx.page.drawText(ctx.branding?.name || "NIMT Educational Institutions", {
      x: ctx.margin, y: ctx.height - 36, size: 14, font: ctx.bold, color: COLORS.sectionFg,
    });
    ctx.page.drawText(ctx.branding?.address || "", {
      x: ctx.margin, y: ctx.height - 54, size: 8, font: ctx.font, color: rgb(0.85, 0.88, 0.95),
    });
    topReserve    = 90;
    bottomReserve = 50;
  }

  ctx.contentStart = ctx.height - topReserve;
  ctx.contentEnd   = bottomReserve;
  ctx.y = ctx.contentStart;

  // Top-right green pill: "Offer of Admission" / session / application id.
  if (ctx.appId) {
    const line1 = "Offer of Admission";
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

    const linesH = sizeSm + (line2 ? lineGap + sizeSm : 0) + lineGap + sizeLg;
    const badgeH = padY * 2 + linesH;

    const badgeX = ctx.width - ctx.margin - badgeW;
    const badgeY = ctx.height - 18;
    const badgeColor = rgb(0.20, 0.69, 0.39);
    const radius = 10;

    ctx.page.drawRectangle({
      x: badgeX + radius, y: badgeY - badgeH,
      width: badgeW - radius * 2, height: badgeH, color: badgeColor,
    });
    ctx.page.drawRectangle({
      x: badgeX, y: badgeY - badgeH + radius,
      width: badgeW, height: badgeH - radius * 2, color: badgeColor,
    });
    ctx.page.drawCircle({ x: badgeX + radius,          y: badgeY - radius,           size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + badgeW - radius, y: badgeY - radius,           size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + radius,          y: badgeY - badgeH + radius,  size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + badgeW - radius, y: badgeY - badgeH + radius,  size: radius, color: badgeColor });

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

// Section title bar — full-width dark navy band with white bold title.
function drawSection(ctx: Ctx, title: string, height = 18) {
  ensureSpace(ctx, height + 4);
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - height, width: ctx.width - ctx.margin * 2, height,
    color: COLORS.sectionBg,
  });
  ctx.page.drawText(title, {
    x: ctx.margin + 8, y: ctx.y - height + 5, size: 9, font: ctx.bold, color: COLORS.sectionFg,
  });
  ctx.y -= height + 2;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 6): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [""];
}

function drawCell(
  ctx: Ctx, x: number, y: number, w: number, h: number,
  label: string, value: string, opts: { valueSize?: number; maxLines?: number } = {},
) {
  ctx.page.drawRectangle({ x, y: y - h, width: w, height: h, color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5 });
  if (label) {
    ctx.page.drawText(label, { x: x + 4, y: y - 11, size: 6.5, font: ctx.font, color: COLORS.muted });
  }
  const valueSize = opts.valueSize ?? 9;
  const maxLines  = opts.maxLines  ?? (label ? 2 : 1);
  const innerW    = w - 8;
  const valueTop  = label ? y - 22 : y - 14;
  const lineH     = valueSize + 2;
  const lines = wrapText(value || "-", ctx.bold, valueSize, innerW, maxLines);
  lines.forEach((ln, i) => {
    ctx.page.drawText(ln, {
      x: x + 4, y: valueTop - i * lineH,
      size: valueSize, font: ctx.bold, color: COLORS.text,
    });
  });
}

// 4-column key/value grid sized to fit the longest wrapped value per row.
function drawKVGrid(ctx: Ctx, pairs: { label: string; value: string }[], minCellH = 26, cols = 4) {
  if (pairs.length === 0) return;
  const totalW = ctx.width - ctx.margin * 2;
  const cellW = totalW / cols;
  const valueSize = 9;
  const lineH = valueSize + 2;
  for (let i = 0; i < pairs.length; i += cols) {
    const slice = pairs.slice(i, i + cols);
    let maxLines = 1;
    for (const p of slice) {
      const lines = wrapText(p.value || "-", ctx.bold, valueSize, cellW - 8, 5);
      if (lines.length > maxLines) maxLines = lines.length;
    }
    const cellH = Math.max(minCellH, 16 + maxLines * lineH);
    ensureSpace(ctx, cellH);
    let xCur = ctx.margin;
    for (let j = 0; j < cols; j++) {
      const p = slice[j];
      if (p) {
        drawCell(ctx, xCur, ctx.y, cellW, cellH, p.label, p.value, { maxLines: 5 });
      } else {
        ctx.page.drawRectangle({ x: xCur, y: ctx.y - cellH, width: cellW, height: cellH, color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5 });
      }
      xCur += cellW;
    }
    ctx.y -= cellH;
  }
}

// Wraps a paragraph at the body width and advances y. Used for the "Dear X"
// salutation, the offer body copy, and the closing terms.
function drawParagraph(ctx: Ctx, text: string, opts: { size?: number; bold?: boolean; color?: any; gapAfter?: number } = {}) {
  const size = opts.size ?? 10;
  const lineH = size + 4;
  const fnt = opts.bold ? ctx.bold : ctx.font;
  const color = opts.color || COLORS.text;
  const innerW = ctx.width - ctx.margin * 2;
  const lines = wrapText(text, fnt, size, innerW, 30);
  for (const ln of lines) {
    ensureSpace(ctx, lineH);
    ctx.page.drawText(ln, { x: ctx.margin, y: ctx.y - size, size, font: fnt, color });
    ctx.y -= lineH;
  }
  ctx.y -= opts.gapAfter ?? 0;
}

// Fee ledger table — Particulars / Amount / [Waiver/Adjustment] / Applicable Fee.
// The adjustment column is rendered only when at least one row carries a
// non-zero waiver/payment adjustment, so a clean offer still shows a tight
// 3-column grid instead of an empty middle column.
interface LedgerRow {
  label: string;
  amount: number;
  waiver: number;        // 0 means no waiver on this line
  applicable: number;
  bold?: boolean;
  highlight?: boolean;
}

interface FeeStructureItem {
  term: string;
  amount: number;
  fee_code_code?: string | null;
  fee_code_name?: string | null;
  fee_code_category?: string | null;
}

type FeeStructurePolicy = {
  token_required_amount?: number | string | null;
};

function drawFeeLedger(ctx: Ctx, rows: LedgerRow[]) {
  const hasWaiverCol = rows.some(r => r.waiver > 0);
  const totalW = ctx.width - ctx.margin * 2;
  // Column widths — keep Particulars wide enough for "Total Programme Fee".
  const labelW = hasWaiverCol ? totalW * 0.40 : totalW * 0.50;
  const numW   = (totalW - labelW) / (hasWaiverCol ? 3 : 2);
  const rowH   = 22;

  const colXs = hasWaiverCol
    ? [ctx.margin, ctx.margin + labelW, ctx.margin + labelW + numW, ctx.margin + labelW + numW * 2]
    : [ctx.margin, ctx.margin + labelW, ctx.margin + labelW + numW];
  const colWs = hasWaiverCol
    ? [labelW, numW, numW, numW]
    : [labelW, numW, numW];
  const headers = hasWaiverCol
    ? ["Particulars", "Amount", "Waiver/Adjustment", "Applicable Fee"]
    : ["Particulars", "Amount", "Applicable Fee"];

  const drawRowFrame = (fillColor: any) => {
    for (let i = 0; i < colXs.length; i++) {
      ctx.page.drawRectangle({
        x: colXs[i], y: ctx.y - rowH, width: colWs[i], height: rowH,
        color: fillColor, borderColor: COLORS.border, borderWidth: 0.5,
      });
    }
  };

  // Header row.
  ensureSpace(ctx, rowH);
  drawRowFrame(COLORS.labelBg);
  // Particulars left-aligned, numeric headers right-aligned.
  ctx.page.drawText(headers[0], {
    x: colXs[0] + 8, y: ctx.y - 14, size: 8, font: ctx.bold, color: COLORS.text,
  });
  for (let i = 1; i < headers.length; i++) {
    const w = ctx.bold.widthOfTextAtSize(headers[i], 8);
    ctx.page.drawText(headers[i], {
      x: colXs[i] + colWs[i] - w - 8, y: ctx.y - 14,
      size: 8, font: ctx.bold, color: COLORS.text,
    });
  }
  ctx.y -= rowH;

  for (const r of rows) {
    ensureSpace(ctx, rowH);
    const fillColor = r.highlight ? COLORS.hilite : rgb(1, 1, 1);
    const fnt = r.bold ? ctx.bold : ctx.font;
    drawRowFrame(fillColor);

    // Particulars (left).
    ctx.page.drawText(r.label, {
      x: colXs[0] + 8, y: ctx.y - 14, size: 9.5, font: fnt, color: COLORS.text,
    });

    // Numeric cells (right-aligned). Waiver shown as "- Rs. X" only if > 0.
    const numericTexts = hasWaiverCol
      ? [fmtINR(r.amount), r.waiver > 0 ? "- " + fmtINR(r.waiver) : "—", fmtINR(r.applicable)]
      : [fmtINR(r.amount), fmtINR(r.applicable)];

    for (let i = 0; i < numericTexts.length; i++) {
      const txt = numericTexts[i];
      const w = fnt.widthOfTextAtSize(txt, 9.5);
      ctx.page.drawText(txt, {
        x: colXs[i + 1] + colWs[i + 1] - w - 8,
        y: ctx.y - 14, size: 9.5, font: fnt, color: COLORS.text,
      });
    }
    ctx.y -= rowH;
  }
}

// ───────────────────────── builder ─────────────────────────

interface BuildOpts {
  offer: { net_fee: number; total_fee: number; scholarship_amount: number | null; acceptance_deadline: string | null; created_at: string; admission_mode?: string | null; entrance_exam_name?: string | null };
  lead: { name: string; phone: string | null; email: string | null; application_id: string | null; pre_admission_no: string | null };
  course: { name: string; code?: string | null; duration_years?: number | null } | null;
  campus: { name: string; address?: string | null } | null;
  yearItems: { term: string; total: number }[];
  feeItems: FeeStructureItem[];
  branding: any;
  totalCourseFee: number;
  tokenAmount: number;
  tokenAlreadyPaid?: number;
  applicationFeePaid: number;
  sessionName: string | null;
  // Resolved separately from applications table — leads.application_id is
  // often null for leads created via the SQL/test path.
  applicationId: string | null;
  // Approved year-wise waivers attached to this offer. Rendered as
  // deduction rows in the fee table; the displayed Net Offer Fee is
  // recomputed to subtract these from the post-scholarship total.
  waivers: { term: string; amount: number }[];
  cahetRegistration?: { registration_no: string; document_url: string | null; notes: string | null; registered_at: string | null } | null;
  updeledRegistration?: { registration_no: string; document_url: string | null; notes: string | null; registered_at: string | null } | null;
}

function isDaottCourse(course: BuildOpts["course"]) {
  const code = String(course?.code || "").toUpperCase();
  const name = String(course?.name || "").toLowerCase();
  return code.includes("DAOTT") || code.includes("DOTT") || /ana?esthesia.*operation theatre/.test(name);
}

function isBptOrBmritCourse(course: BuildOpts["course"]) {
  const code = String(course?.code || "").toLowerCase();
  const name = String(course?.name || "").toLowerCase();
  return code.includes("bpt") ||
    name.includes("bpt") ||
    name.includes("physiotherapy") ||
    code.includes("bmrit") ||
    name.includes("bmrit") ||
    (name.includes("radiology") && name.includes("imaging")) ||
    (name.includes("radiology") && name.includes("b.sc"));
}

function labelForOfferTerm(term: string, isDaott: boolean) {
  if (term === "security_deposit") return "Security Deposit (Refundable)";
  return isDaott
    ? term.replace(/^year_(\d+)$/, "Sem $1")
    : term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function daottFeeHeadLabel(item: FeeStructureItem) {
  const code = String(item.fee_code_code || "").toUpperCase();
  const name = String(item.fee_code_name || "").toLowerCase();
  if (code === "DAOTT-SEAT" || name.includes("seat block")) return "Seat Block";
  if (code === "DAOTT-TUITION" || name.includes("tuition")) return "Tuition";
  if (code === "DAOTT-ADMIN-TECH" || name.includes("admin")) return "Admin/Tech";
  if (code === "DAOTT-EXAM" || name.includes("exam")) return "Examination";
  return String(item.fee_code_name || "Fee").replace(/^DAOTT\s+/i, "").replace(/\s+Fee$/i, "");
}

function daottFeeItemRank(item: FeeStructureItem) {
  const code = String(item.fee_code_code || "").toUpperCase();
  if (code === "DAOTT-SEAT") return 0;
  if (code === "DAOTT-TUITION") return 1;
  if (code === "DAOTT-ADMIN-TECH") return 2;
  if (code === "DAOTT-EXAM") return 3;
  return 9;
}

function isDaottSeatBlockItem(item: FeeStructureItem) {
  const code = String(item.fee_code_code || "").toUpperCase();
  const name = String(item.fee_code_name || "").toLowerCase();
  return code === "DAOTT-SEAT" || name.includes("seat block");
}

async function buildOfferPdf(opts: BuildOpts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const lh    = await fetchImage(pdf, opts.branding?.letterhead_url ?? null);
  const ftr   = await fetchImage(pdf, opts.branding?.footer_url ?? null);
  const sig   = await fetchImage(pdf, opts.branding?.signature_url ?? null);

  const ctx: Ctx = {
    pdf, page: undefined as any, font, bold,
    width: 595, height: 842, margin: 36,
    y: 0, contentStart: 0, contentEnd: 0,
    branding: { ...(opts.branding || {}), _lh: lh, _footer: ftr },
    hasLetterhead: !!lh,
    appId: opts.applicationId || publicApplicationRef(opts.lead.application_id) || opts.lead.pre_admission_no,
    sessionName: opts.sessionName,
  };

  await newPage(ctx);
  const isDaott = isDaottCourse(opts.course);
  const isCahetRoute = String(opts.offer.entrance_exam_name || "").toLowerCase().includes("cahet");
  const isUpdeledRoute = isUpdeledExamName(opts.offer.entrance_exam_name);
  const applicantName = sentenceCaseName(opts.lead.name);
  const institutionName = institutionNameForOffer(opts.branding?.name, opts.campus?.name);

  // ── Date + greeting (compact — single line each) ────────────────────────
  ctx.page.drawText(`Date: ${fmtDate(opts.offer.created_at)}`, {
    x: ctx.margin, y: ctx.y - 9, size: 9, font: ctx.font, color: COLORS.muted,
  });
  ctx.y -= 18;

  ctx.page.drawText(`Dear ${applicantName},`, {
    x: ctx.margin, y: ctx.y - 11, size: 11, font: ctx.bold, color: COLORS.text,
  });
  ctx.y -= 22;

  // One-paragraph congratulations — short enough to never spill.
  drawParagraph(ctx,
    "Congratulations! On behalf of " + institutionName +
    ", we are pleased to offer you provisional admission to the programme detailed below. " +
    "Pay the token fee before the acceptance deadline to confirm your seat.",
    { size: 9.5, gapAfter: 8 });

  // ── Programme details ───────────────────────────────────────────────────
  drawSection(ctx, "PROGRAMME DETAILS");
  drawKVGrid(ctx, [
    { label: "Programme",         value: opts.course?.name || "-" },
    { label: "Duration",          value: isDaott ? "2.5 years (5 semesters)" : opts.course?.duration_years ? `${opts.course.duration_years} year${opts.course.duration_years > 1 ? "s" : ""}` : "-" },
    { label: "Campus",            value: opts.campus?.name || "-" },
    { label: "Academic Session",  value: opts.sessionName || "-" },
    { label: "Applicant Name",    value: applicantName },
    { label: "Phone",             value: opts.lead.phone || "-" },
    { label: "Email",             value: opts.lead.email || "-" },
    { label: "Application ID",    value: opts.applicationId || publicApplicationRef(opts.lead.application_id) || opts.lead.pre_admission_no || "-" },
  ]);

  if (opts.campus?.address) {
    ensureSpace(ctx, 28);
    const w = ctx.width - ctx.margin * 2;
    drawCell(ctx, ctx.margin, ctx.y, w, 28, "Campus Address", opts.campus.address, { maxLines: 2 });
    ctx.y -= 28;
  }

  if (opts.cahetRegistration && (isBptOrBmritCourse(opts.course) || isCahetRoute)) {
    ctx.y -= 4;
    drawKVGrid(ctx, [
      { label: "CAHET Status", value: "Registered" },
      { label: "CAHET Registration No.", value: opts.cahetRegistration.registration_no || "-" },
      { label: "Registered On", value: fmtDate(opts.cahetRegistration.registered_at) },
      { label: "Proof", value: opts.cahetRegistration.document_url ? "Uploaded" : "Not attached" },
    ]);
    if (opts.cahetRegistration.notes) {
      drawKVGrid(ctx, [{ label: "CAHET Notes", value: opts.cahetRegistration.notes }], 26, 1);
    }
  }

  if (opts.updeledRegistration && (isDeledCourseName(opts.course?.name) || isUpdeledRoute)) {
    ctx.y -= 4;
    drawKVGrid(ctx, [
      { label: "UPDELED Status", value: "Registered" },
      { label: "UPDELED Registration No.", value: opts.updeledRegistration.registration_no || "-" },
      { label: "Registered On", value: fmtDate(opts.updeledRegistration.registered_at) },
      { label: "Proof", value: opts.updeledRegistration.document_url ? "Uploaded" : "Not attached" },
    ]);
    if (opts.updeledRegistration.notes) {
      drawKVGrid(ctx, [{ label: "UPDELED Notes", value: opts.updeledRegistration.notes }], 26, 1);
    }
  }

  ctx.y -= 6;

  // ── Fee structure ──────────────────────────────────────────────────────
  drawSection(ctx, "FEE STRUCTURE");

  // Build ledger rows. Legacy `scholarship_amount` is attributed to Year 1
  // (that's also how the token-fee math handles it upstream); newer discounts
  // live in `offer_waivers`. DAOTT offers are rendered from fee-head rows so
  // the seat-block line remains visible instead of being hidden inside Sem 1.
  const scholarship = Number(opts.offer.scholarship_amount || 0);
  const ledgerRows: LedgerRow[] = [];

  let totalAmount = 0;
  let totalWaiver = 0;
  let totalApplicable = 0;

  if (isDaott && opts.feeItems.length > 0) {
    const sortedFeeItems = [...opts.feeItems]
      .filter((it) => isOfferProgrammeFeeTerm(it.term))
      .sort((a, b) => offerFeeTermRank(a.term) - offerFeeTermRank(b.term) || daottFeeItemRank(a) - daottFeeItemRank(b));

    const termAdjustmentRemaining = new Map<string, number>();
    for (const it of sortedFeeItems) {
      if (!termAdjustmentRemaining.has(it.term)) {
        const waiverForTerm = opts.waivers
          .filter(w => w.term === it.term)
          .reduce((s, w) => s + Number(w.amount || 0), 0);
        termAdjustmentRemaining.set(it.term, waiverForTerm + (it.term === "year_1" ? scholarship : 0));
      }
    }

    const termHasNonSeatItem = new Map<string, boolean>();
    for (const it of sortedFeeItems) {
      if (!isDaottSeatBlockItem(it)) termHasNonSeatItem.set(it.term, true);
    }

    let applicationCreditRemaining = Math.max(0, Number(opts.applicationFeePaid || 0));

    for (const it of sortedFeeItems) {
      const amount = Number(it.amount || 0);
      const isSeatBlock = isDaottSeatBlockItem(it);
      const applicationAdjustment = isSeatBlock
        ? Math.min(applicationCreditRemaining, amount)
        : 0;
      applicationCreditRemaining -= applicationAdjustment;

      const termAdjustment = termAdjustmentRemaining.get(it.term) || 0;
      const shouldApplyTermAdjustment = !isSeatBlock || !termHasNonSeatItem.get(it.term);
      const waiverAdjustment = shouldApplyTermAdjustment
        ? Math.min(termAdjustment, Math.max(0, amount - applicationAdjustment))
        : 0;
      termAdjustmentRemaining.set(it.term, termAdjustment - waiverAdjustment);

      const lineAdjustment = applicationAdjustment + waiverAdjustment;
      const applicable = Math.max(0, amount - lineAdjustment);

      ledgerRows.push({
        label: `${labelForOfferTerm(it.term, true)} - ${daottFeeHeadLabel(it)}`,
        amount,
        waiver: lineAdjustment,
        applicable,
      });

      totalAmount += amount;
      totalWaiver += lineAdjustment;
      totalApplicable += applicable;
    }
  } else {
    for (const it of opts.yearItems) {
      const yearLabel = labelForOfferTerm(it.term, isDaott);
      const waiverForYear = opts.waivers
        .filter(w => w.term === it.term)
        .reduce((s, w) => s + Number(w.amount || 0), 0);
      const scholarshipShare = it.term === "year_1" ? scholarship : 0;
      const lineWaiver = waiverForYear + scholarshipShare;
      const applicable = Math.max(0, Number(it.total) - lineWaiver);

      ledgerRows.push({
        label: yearLabel,
        amount: Number(it.total),
        waiver: lineWaiver,
        applicable,
      });

      totalAmount     += Number(it.total);
      totalWaiver     += lineWaiver;
      totalApplicable += applicable;
    }
  }

  if (opts.totalCourseFee > 0 || ledgerRows.length > 0) {
    ledgerRows.push({
      label: "Total Programme Fee",
      amount: totalAmount,
      waiver: totalWaiver,
      applicable: totalApplicable,
      bold: true,
      highlight: true,
    });
  }

  drawFeeLedger(ctx, ledgerRows);

  ctx.y -= 8;

  // ── Token + acceptance deadline ────────────────────────────────────────
  drawSection(ctx, "ADMISSION CONFIRMATION");
  const tokenPrePaid = Number(opts.tokenAlreadyPaid || 0);
  const netTokenPayable = Math.max(0, Number(opts.tokenAmount || 0) - tokenPrePaid);
  const confirmationRows = [
    { label: "Token Fee Payable", value: fmtINR(opts.tokenAmount || 0) },
    ...(tokenPrePaid > 0
      ? [
          { label: "Less: Token Fee Already Paid", value: "- " + fmtINR(tokenPrePaid) },
          { label: "Net Token Fee Due", value: fmtINR(netTokenPayable) },
        ]
      : []),
    { label: "Acceptance Deadline", value: fmtDeadline(opts.offer.acceptance_deadline) },
    { label: "Pay Online",          value: "uni.nimt.ac.in" },
    { label: "Reference No.",       value: opts.applicationId || publicApplicationRef(opts.lead.application_id) || opts.lead.pre_admission_no || "-" },
  ];
  drawKVGrid(ctx, confirmationRows);

  ctx.y -= 4;

  // ── Terms (compact, smaller font) ──────────────────────────────────────
  drawSection(ctx, "TERMS & NEXT STEPS");
  const firstFeePeriod = isDaott ? "Semester 1" : labelForOfferTerm(firstOfferFeeTerm(opts.yearItems), false);
  const terms = [
    "Provisional offer subject to verification of original documents at physical admission.",
    `Token fee is adjustable against the ${firstFeePeriod} programme fee and is non-refundable once paid.`,
    "Education loan support letter can be downloaded from the applicant portal after the token fee is paid.",
    `Remaining ${firstFeePeriod} fee is due as per the schedule communicated post token-fee confirmation.`,
    "The above fee does not include Uniform Fee, Examination Fee and other applicable fees levied by the University / Examination Body, if any.",
    "Offer lapses automatically if token fee is not received by the acceptance deadline.",
    "The institution may revoke this offer if any submitted information is found inaccurate.",
  ];
  const innerW = ctx.width - ctx.margin * 2;
  for (let i = 0; i < terms.length; i++) {
    const num = `${i + 1}.`;
    const numW = ctx.font.widthOfTextAtSize(num, 8.5);
    const lines = wrapText(terms[i], ctx.font, 8.5, innerW - numW - 6, 3);
    ensureSpace(ctx, lines.length * 12 + 2);
    ctx.page.drawText(num, { x: ctx.margin, y: ctx.y - 9, size: 8.5, font: ctx.font, color: COLORS.muted });
    for (const ln of lines) {
      ctx.page.drawText(ln, { x: ctx.margin + numW + 4, y: ctx.y - 9, size: 8.5, font: ctx.font, color: COLORS.text });
      ctx.y -= 12;
    }
    ctx.y -= 1;
  }

  ctx.y -= 14;

  // ── Signature row (mirrors application-form layout exactly) ─────────────
  const totalW = ctx.width - ctx.margin * 2;
  const signRowH = 50;
  ensureSpace(ctx, signRowH + 30);

  // Left box — institute seal placeholder.
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - signRowH, width: totalW * 0.55, height: signRowH,
    color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("Principal / Director Signature & Seal", {
    x: ctx.margin + 6, y: ctx.y - 11, size: 7, font: ctx.font, color: COLORS.muted,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin + 12,                      y: ctx.y - 38 },
    end:   { x: ctx.margin + totalW * 0.55 - 12,      y: ctx.y - 38 },
    thickness: 0.4, color: COLORS.muted,
  });

  // Right box — authorised signatory with branding signature image.
  ctx.page.drawRectangle({
    x: ctx.margin + totalW * 0.55, y: ctx.y - signRowH, width: totalW * 0.45, height: signRowH,
    color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("For the Institution", {
    x: ctx.margin + totalW * 0.55 + 6, y: ctx.y - 11, size: 7, font: ctx.font, color: COLORS.muted,
  });
  if (sig) {
    const sigW = 80, sigH = 28;
    ctx.page.drawImage(sig, {
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
  const signatoryName = opts.branding?.signatory_name || "AUTHORISED SIGNATORY";
  ctx.page.drawText(signatoryName, {
    x: ctx.margin + totalW * 0.55 + 6,
    y: ctx.y - signRowH + 4,
    size: 7, font: ctx.bold, color: COLORS.text,
  });
  ctx.y -= signRowH + 6;

  // System-generated footer (small, muted).
  ensureSpace(ctx, 14);
  const sysNote = "This is a system-generated offer letter. Validity expires on the acceptance deadline noted above.";
  ctx.page.drawText(sysNote, {
    x: ctx.margin, y: ctx.y - 7, size: 7, font: ctx.font, color: COLORS.muted,
  });
  ctx.y -= 14;

  // ── Page numbering ─────────────────────────────────────────────────────
  // Two-pass: stamp "Page X of Y" centered just inside the footer reserve
  // on every page so the count is final.
  const pages = pdf.getPages();
  const total = pages.length;
  pages.forEach((page, idx) => {
    const text = `Page ${idx + 1} of ${total}`;
    const w = ctx.font.widthOfTextAtSize(text, 8);
    page.drawText(text, {
      x: (page.getSize().width - w) / 2,
      y: 28,
      size: 8, font: ctx.font, color: COLORS.muted,
    });
  });

  return await pdf.save();
}

// ───────────────────────── handler ─────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { offer_letter_id, application_id } = await req.json();
    if (!offer_letter_id) {
      return new Response(JSON.stringify({ error: "offer_letter_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull offer + lead + course + campus.
    const { data: offer, error: oErr } = await admin
      .from("offer_letters")
      .select(`
        id, total_fee, scholarship_amount, net_fee, approval_status,
        source_fee_proposal_id, source_fee_proposal_child_key,
        token_fee_amount, acceptance_deadline, created_at, admission_mode, entrance_exam_name,
        student_type, hostel_type, transport_zone,
        lead_id, course_id, campus_id, session_id,
        leads:lead_id ( id, name, phone, email, application_id, pre_admission_no, token_amount ),
        courses:course_id ( name, code, duration_years ),
        campuses:campus_id ( name, address )
      `)
      .eq("id", offer_letter_id)
      .single();
    if (oErr || !offer) {
      return new Response(JSON.stringify({ error: oErr?.message || "Offer not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (offer.approval_status !== "approved") {
      return new Response(JSON.stringify({ error: "Offer is not approved yet" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lead: any = offer.leads;
    const course: any = offer.courses;
    const campus: any = offer.campuses;

    // Programme fee breakdown from fee_structure_items. Keep both the grouped
    // term totals for token math and detailed fee-code rows for DAOTT offer
    // PDFs, where the seat-block fee must be shown explicitly.
    const { data: feeStructures, error: feeStructureError } = await admin
      .from("fee_structures")
      .select("id, version, created_at, policy, fee_structure_items ( term, amount, fee_codes:fee_code_id ( code, name, category ) )")
      .eq("course_id", offer.course_id)
      .eq("session_id", offer.session_id)
      .eq("is_active", true);
    if (feeStructureError) throw feeStructureError;
    const yearRows = pickOfferFeeStructure((feeStructures || []) as OfferFeeStructureRow[]);

    const schoolSelection: SchoolFeeSelection = {
      studentType: (offer.student_type as SchoolStudentType | null) || null,
      hostelType: (offer.hostel_type as SchoolHostelType | null) || null,
      transportZone: (offer.transport_zone as SchoolTransportZone | null) || null,
    };

    const yearMap = new Map<string, number>();
    const feeItems: FeeStructureItem[] = [];
    for (const it of (yearRows?.fee_structure_items || []) as { term: string; amount: number; fee_codes?: { code?: string | null; name?: string | null; category?: string | null } | null }[]) {
      const term = String(it.term || "").trim().toLowerCase();
      if (!isOfferProgrammeFeeTerm(term)) continue;
      if (!includeOfferFeeItem(it, schoolSelection)) continue;
      // Break the refundable security deposit onto its own line (not the admission fee).
      const isDeposit = String(it.fee_codes?.code ?? "").trim().toUpperCase().endsWith(SECURITY_DEPOSIT_CODE_SUFFIX);
      const displayTerm = isDeposit ? "security_deposit" : term;
      yearMap.set(displayTerm, (yearMap.get(displayTerm) || 0) + Number(it.amount));
      feeItems.push({
        term,
        amount: Number(it.amount || 0),
        fee_code_code: it.fee_codes?.code || null,
        fee_code_name: it.fee_codes?.name || null,
        fee_code_category: it.fee_codes?.category || null,
      });
    }
    const yearItems = Array.from(yearMap.entries())
      .sort(([a], [b]) => offerFeeTermRank(a) - offerFeeTermRank(b) || a.localeCompare(b))
      .map(([term, total]) => ({ term, total }));
    const totalCourseFee = yearItems.reduce((s, y) => s + y.total, 0);

    const { data: applicationFeeRows } = await admin
      .from("lead_payments")
      .select("amount")
      .eq("lead_id", offer.lead_id)
      .eq("type", "application_fee")
      .eq("status", "confirmed");
    const applicationFeePaid = ((applicationFeeRows || []) as { amount: number | string | null }[])
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    // Sum of confirmed token payments (offer-driven token_fee + any
    // pre-application token collected before this offer existed). Shown on the
    // offer as "Less: token fee already paid" so a pre-paid candidate sees the
    // credit against their admission fee (owner requirement).
    const { data: tokenPaidRows } = await admin
      .from("lead_payments")
      .select("amount")
      .eq("lead_id", offer.lead_id)
      .in("type", ["token_fee", "pre_admission_token"])
      .eq("status", "confirmed");
    const tokenAlreadyPaid = ((tokenPaidRows || []) as { amount: number | string | null }[])
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    // Resolve session name for the top-right pill + programme details grid.
    let sessionName: string | null = null;
    if (offer.session_id) {
      const { data: sess } = await admin.from("admission_sessions").select("name").eq("id", offer.session_id).maybeSingle();
      sessionName = sess?.name || null;
    }

    // Resolve the display application ID directly from applications. Do not
    // display leads.application_id blindly: older sync paths can store the
    // internal applications.id UUID there, while PDFs must show APP-... IDs.
    const requestedApplicationValue = String(application_id || "").trim();
    const leadApplicationValue = String(lead?.application_id || "").trim();
    let applicationId: string | null = null;
    applicationId = publicApplicationRef(requestedApplicationValue) || publicApplicationRef(leadApplicationValue);
    let applicationRow: ApplicationCahetSource | null = null;
    if (applicationId) {
      const { data: appRow } = await admin
        .from("applications")
        .select("application_id, full_name, academic_details")
        .eq("application_id", applicationId)
        .maybeSingle();
      applicationRow = appRow || null;
    }
    if (!applicationRow && offer.lead_id) {
      const { data: appRow } = await admin
        .from("applications")
        .select("id, application_id, full_name, academic_details")
        .eq("lead_id", offer.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      applicationRow = appRow || null;
      applicationId = publicApplicationRef(appRow?.application_id) || applicationId;
    }
    if (!applicationRow && isUuidLike(leadApplicationValue)) {
      const { data: appRow } = await admin
        .from("applications")
        .select("id, application_id, full_name, academic_details")
        .eq("id", leadApplicationValue)
        .maybeSingle();
      applicationRow = appRow || null;
      applicationId = publicApplicationRef(appRow?.application_id) || applicationId;
    }
    if (!applicationRow && lead?.application_id && isUuidLike(lead.application_id)) {
      const { data: appRow } = await admin
        .from("applications")
        .select("application_id, full_name, academic_details")
        .eq("id", lead.application_id)
        .maybeSingle();
      applicationRow = appRow || null;
      applicationId = appRow?.application_id || null;
    }
    if (!applicationRow && lead?.application_id && !isUuidLike(lead.application_id)) {
      const { data: appRow } = await admin
        .from("applications")
        .select("application_id, full_name, academic_details")
        .eq("application_id", lead.application_id)
        .maybeSingle();
      applicationRow = appRow || null;
      applicationId = appRow?.application_id || lead.application_id || null;
    }
    const applicantName = String(applicationRow?.full_name || "").trim() || lead?.name || "Applicant";
    const pdfLead = { ...lead, name: applicantName };

    // Branding (doc-type-aware: prefers a template tagged 'offer_letter',
    // then 'all', then default).
    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: offer.lead_id, _doc_type: "offer_letter",
    });

    // Approved year-wise waivers attached to this offer. Sorted by term
    // so Year 1 renders before Year 2 in the fee table.
    const { data: waiverRows } = await admin
      .from("offer_waivers")
      .select("term, amount, source_type, metadata")
      .eq("offer_letter_id", offer_letter_id)
      .eq("status", "approved")
      .order("term", { ascending: true });
    const waivers = (waiverRows || []).map((w: any) => ({
      term: String(w.term || ""),
      amount: Number(w.amount || 0),
    }));

    const { data: cahetRegistrationRow } = await admin
      .from("cahet_registrations")
      .select("registration_no, document_url, notes, registered_at")
      .eq("lead_id", offer.lead_id)
      .maybeSingle();
    const { data: cahetExamRow } = !cahetRegistrationRow
      ? await admin
          .from("exam_registrations")
          .select("registration_no, document_url, notes, registered_at")
          .eq("lead_id", offer.lead_id)
          .eq("exam_code", "cahet")
          .maybeSingle()
      : { data: null };
    const cahetRegistration = cahetRegistrationRow || (cahetExamRow?.registration_no ? cahetExamRow : null) || cahetRegistrationFromApplication(applicationRow);
    if (isBptOrBmritCourseName(course?.name) && !cahetRegistration) {
      return new Response(JSON.stringify({
        error: "CAHET registration details are required before issuing an offer letter for BPT and BMRIT.",
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: updeledRegistrationRow } = await admin
      .from("updeled_registrations")
      .select("registration_no, document_url, notes, registered_at")
      .eq("lead_id", offer.lead_id)
      .maybeSingle();
    const { data: updeledExamRow } = !updeledRegistrationRow
      ? await admin
          .from("exam_registrations")
          .select("registration_no, document_url, notes, registered_at")
          .eq("lead_id", offer.lead_id)
          .eq("exam_code", "updeled")
          .maybeSingle()
      : { data: null };
    const updeledRegistration = updeledRegistrationRow || (updeledExamRow?.registration_no ? updeledExamRow : null) || updeledRegistrationFromApplication(applicationRow);
    if (isDeledCourseName(course?.name) && !updeledRegistration) {
      return new Response(JSON.stringify({
        error: "UPDELED registration details are required before issuing an offer letter for D.El.Ed.",
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Token fee on the PDF: this is the amount the candidate must pay before
    // downloading the education-loan support letter — i.e. 25% of the
    // post-scholarship + post-waiver Year-1 fee, floored at the
    // course-specific seat-block amount.
    //
    //   1. If the offer carries an explicit token_fee_amount (set when the
    //      counsellor used the new offer-letter form), use that verbatim.
    //   2. Otherwise compute the 25% default from yearItems + scholarship +
    //      approved Year-1 waivers, so legacy offers that pre-date the
    //      token-fee engine still render the right number.
    //   3. As a final fallback (no fee structure at all), fall back to the
    //      legacy leads.token_amount.
    let tokenAmount = Number((offer as any)?.token_fee_amount ?? 0);
    if (!tokenAmount || tokenAmount <= 0) {
      const firstTerm = firstOfferFeeTerm(yearItems);
      const firstTermTotal = yearItems.find(it => it.term === firstTerm)?.total ?? 0;
      const scholarship = Number(offer.scholarship_amount || 0);
      const y1Waivers = waivers
        .filter(w => w.term === firstTerm)
        .reduce((s, w) => s + Number(w.amount || 0), 0);
      const postY1 = Math.max(0, firstTermTotal - scholarship - y1Waivers);
      const policy = (yearRows as { policy?: FeeStructurePolicy | null } | null)?.policy;
      const policyTokenAmount = Number(policy?.token_required_amount || 0);
      const tokenFloor = policyTokenAmount || 5000;
      tokenAmount = policyTokenAmount > 0
        ? policyTokenAmount
        : postY1 > 0
        ? Math.max(Math.round(postY1 * 0.25), tokenFloor)
        : Number(lead?.token_amount || 0);
    }

    const pdfBytes = await buildOfferPdf({
      offer,
      lead: pdfLead,
      course,
      campus,
      yearItems,
      feeItems,
      branding,
      totalCourseFee,
      tokenAmount,
      tokenAlreadyPaid,
      applicationFeePaid,
      sessionName,
      applicationId,
      waivers,
      cahetRegistration: cahetRegistration || null,
      updeledRegistration: updeledRegistration || null,
    });

    const path = `offer-letters/${offer.lead_id}/${offer.id}.pdf`;
    const uploaded = await uploadToR2({ key: path, body: pdfBytes, contentType: "application/pdf" });
    const letterUrl = uploaded.url;

    await admin.from("offer_letters").update({ letter_url: letterUrl }).eq("id", offer.id);

    return new Response(JSON.stringify({ ok: true, letter_url: letterUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[offer-letter] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

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

// Two-column fee table: term label on left, amount right-aligned. Shaded
// header row (label bg) for readability.
function drawFeeTable(
  ctx: Ctx, rows: { label: string; amount: string; bold?: boolean; highlight?: boolean }[],
) {
  const totalW = ctx.width - ctx.margin * 2;
  const labelW = totalW * 0.62;
  const amtW   = totalW - labelW;
  const rowH = 22;

  // Header
  ensureSpace(ctx, rowH);
  ctx.page.drawRectangle({ x: ctx.margin,        y: ctx.y - rowH, width: labelW, height: rowH, color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5 });
  ctx.page.drawRectangle({ x: ctx.margin + labelW, y: ctx.y - rowH, width: amtW,   height: rowH, color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5 });
  ctx.page.drawText("Particulars", { x: ctx.margin + 8, y: ctx.y - 14, size: 8, font: ctx.bold, color: COLORS.text });
  const ahdr = "Amount";
  const ahdrW = ctx.bold.widthOfTextAtSize(ahdr, 8);
  ctx.page.drawText(ahdr, { x: ctx.margin + labelW + amtW - ahdrW - 8, y: ctx.y - 14, size: 8, font: ctx.bold, color: COLORS.text });
  ctx.y -= rowH;

  for (const r of rows) {
    ensureSpace(ctx, rowH);
    const fillColor = r.highlight ? COLORS.hilite : rgb(1, 1, 1);
    const fnt = r.bold ? ctx.bold : ctx.font;

    ctx.page.drawRectangle({ x: ctx.margin,            y: ctx.y - rowH, width: labelW, height: rowH, color: fillColor, borderColor: COLORS.border, borderWidth: 0.5 });
    ctx.page.drawRectangle({ x: ctx.margin + labelW,   y: ctx.y - rowH, width: amtW,   height: rowH, color: fillColor, borderColor: COLORS.border, borderWidth: 0.5 });
    ctx.page.drawText(r.label, { x: ctx.margin + 8, y: ctx.y - 14, size: 9.5, font: fnt, color: COLORS.text });
    const amtTxt = r.amount;
    const amtTxtW = fnt.widthOfTextAtSize(amtTxt, 9.5);
    ctx.page.drawText(amtTxt, {
      x: ctx.margin + labelW + amtW - amtTxtW - 8,
      y: ctx.y - 14, size: 9.5, font: fnt, color: COLORS.text,
    });
    ctx.y -= rowH;
  }
}

// ───────────────────────── builder ─────────────────────────

interface BuildOpts {
  offer: { net_fee: number; total_fee: number; scholarship_amount: number | null; acceptance_deadline: string | null; created_at: string };
  lead: { name: string; phone: string | null; email: string | null; application_id: string | null; pre_admission_no: string | null };
  course: { name: string; duration_years?: number | null } | null;
  campus: { name: string; address?: string | null } | null;
  yearItems: { term: string; total: number }[];
  branding: any;
  totalCourseFee: number;
  tokenAmount: number;
  sessionName: string | null;
  // Resolved separately from applications table — leads.application_id is
  // often null for leads created via the SQL/test path.
  applicationId: string | null;
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
    appId: opts.applicationId || opts.lead.application_id,
    sessionName: opts.sessionName,
  };

  await newPage(ctx);

  // ── Date + greeting (compact — single line each) ────────────────────────
  ctx.page.drawText(`Date: ${fmtDate(opts.offer.created_at)}`, {
    x: ctx.margin, y: ctx.y - 9, size: 9, font: ctx.font, color: COLORS.muted,
  });
  ctx.y -= 18;

  ctx.page.drawText(`Dear ${opts.lead.name || "Applicant"},`, {
    x: ctx.margin, y: ctx.y - 11, size: 11, font: ctx.bold, color: COLORS.text,
  });
  ctx.y -= 22;

  // One-paragraph congratulations — short enough to never spill.
  drawParagraph(ctx,
    "Congratulations! On behalf of " + (opts.branding?.name || "NIMT Educational Institutions") +
    ", we are pleased to offer you provisional admission to the programme detailed below. " +
    "Pay the token fee before the acceptance deadline to confirm your seat.",
    { size: 9.5, gapAfter: 8 });

  // ── Programme details ───────────────────────────────────────────────────
  drawSection(ctx, "PROGRAMME DETAILS");
  drawKVGrid(ctx, [
    { label: "Programme",         value: opts.course?.name || "-" },
    { label: "Duration",          value: opts.course?.duration_years ? `${opts.course.duration_years} year${opts.course.duration_years > 1 ? "s" : ""}` : "-" },
    { label: "Campus",            value: opts.campus?.name || "-" },
    { label: "Academic Session",  value: opts.sessionName || "-" },
    { label: "Applicant Name",    value: opts.lead.name || "-" },
    { label: "Phone",             value: opts.lead.phone || "-" },
    { label: "Email",             value: opts.lead.email || "-" },
    { label: "Application ID",    value: opts.applicationId || opts.lead.application_id || "-" },
  ]);

  if (opts.campus?.address) {
    ensureSpace(ctx, 28);
    const w = ctx.width - ctx.margin * 2;
    drawCell(ctx, ctx.margin, ctx.y, w, 28, "Campus Address", opts.campus.address, { maxLines: 2 });
    ctx.y -= 28;
  }

  ctx.y -= 6;

  // ── Fee structure ──────────────────────────────────────────────────────
  drawSection(ctx, "FEE STRUCTURE");

  const feeRows: { label: string; amount: string; bold?: boolean; highlight?: boolean }[] = [];
  for (const it of opts.yearItems) {
    feeRows.push({
      label: it.term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      amount: fmtINR(it.total),
    });
  }
  if (opts.totalCourseFee > 0) {
    feeRows.push({ label: "Total Programme Fee", amount: fmtINR(opts.totalCourseFee), bold: true });
  }
  if ((opts.offer.scholarship_amount || 0) > 0) {
    feeRows.push({ label: "Scholarship Awarded", amount: "- " + fmtINR(opts.offer.scholarship_amount || 0) });
    // offer.net_fee is the amount the institution has offered to charge for
    // this offer (typically first-year less scholarship). Labelled as "Net
    // Offer Fee" rather than "Net Programme Fee" since it doesn't always
    // equal the programme total minus scholarship.
    feeRows.push({ label: "Net Offer Fee", amount: fmtINR(opts.offer.net_fee), bold: true, highlight: true });
  }
  drawFeeTable(ctx, feeRows);

  ctx.y -= 8;

  // ── Token + acceptance deadline ────────────────────────────────────────
  drawSection(ctx, "ADMISSION CONFIRMATION");
  drawKVGrid(ctx, [
    { label: "Token Fee Payable",   value: fmtINR(opts.tokenAmount || 0) },
    { label: "Acceptance Deadline", value: fmtDate(opts.offer.acceptance_deadline) },
    { label: "Pay Online",          value: "uni.nimt.ac.in" },
    { label: "Reference No.",       value: opts.applicationId || opts.lead.application_id || "-" },
  ]);

  ctx.y -= 4;

  // ── Terms (compact, smaller font) ──────────────────────────────────────
  drawSection(ctx, "TERMS & NEXT STEPS");
  const terms = [
    "Provisional offer subject to verification of original documents at physical admission.",
    "Token fee is adjustable against the first-year programme fee and is non-refundable once paid.",
    "Remaining first-year fee is due as per the schedule communicated post token-fee confirmation.",
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

    const { offer_letter_id } = await req.json();
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
        acceptance_deadline, created_at, lead_id, course_id, campus_id, session_id,
        leads:lead_id ( id, name, phone, email, application_id, pre_admission_no, token_amount ),
        courses:course_id ( name, duration_years ),
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

    // Per-year fee breakdown from fee_structure_items.
    const { data: yearRows } = await admin
      .from("fee_structures")
      .select("id, fee_structure_items ( term, amount )")
      .eq("course_id", offer.course_id)
      .eq("session_id", offer.session_id)
      .eq("is_active", true)
      .single();

    const yearMap = new Map<string, number>();
    for (const it of ((yearRows as any)?.fee_structure_items || []) as { term: string; amount: number }[]) {
      if (!it.term?.startsWith("year_")) continue;
      yearMap.set(it.term, (yearMap.get(it.term) || 0) + Number(it.amount));
    }
    const yearItems = Array.from(yearMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([term, total]) => ({ term, total }));
    const totalCourseFee = yearItems.reduce((s, y) => s + y.total, 0);

    // Resolve session name for the top-right pill + programme details grid.
    let sessionName: string | null = null;
    if (offer.session_id) {
      const { data: sess } = await admin.from("admission_sessions").select("name").eq("id", offer.session_id).maybeSingle();
      sessionName = sess?.name || null;
    }

    // Resolve application_id directly from applications. leads.application_id
    // is sometimes null (test data, manual SQL inserts, race conditions on
    // the trigger that mirrors it). Pull the latest application linked to
    // this lead — that's the authoritative source for the top-right badge.
    let applicationId: string | null = lead?.application_id || null;
    if (!applicationId && offer.lead_id) {
      const { data: appRow } = await admin
        .from("applications")
        .select("application_id")
        .eq("lead_id", offer.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      applicationId = appRow?.application_id || null;
    }

    // Branding (doc-type-aware: prefers a template tagged 'offer_letter',
    // then 'all', then default).
    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: offer.lead_id, _doc_type: "offer_letter",
    });

    const pdfBytes = await buildOfferPdf({
      offer,
      lead,
      course,
      campus,
      yearItems,
      branding,
      totalCourseFee,
      tokenAmount: Number(lead?.token_amount || 0),
      sessionName,
      applicationId,
    });

    const path = `offer-letters/${offer.lead_id}/${offer.id}.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true, cacheControl: "no-cache, max-age=0" });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pub } = admin.storage.from("application-documents").getPublicUrl(path);
    const letterUrl = pub?.publicUrl || path;

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

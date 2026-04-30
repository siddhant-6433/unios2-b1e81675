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
// Drops trailing words to fit `maxLines`; appends "..." if truncated.
function wrapText(text: string, font: any, size: number, maxWidth: number, maxLines = 2): string[] {
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
      // word itself too long - hard-break.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        // Cut word at safe length.
        let cut = word;
        while (cut.length > 1 && font.widthOfTextAtSize(cut + "...", size) > maxWidth) cut = cut.slice(0, -1);
        lines.push(cut + "...");
        line = "";
      } else {
        line = word;
      }
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length > maxLines) {
    const overflow = lines.slice(maxLines).join(" ");
    lines.length = maxLines;
    if (overflow) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && font.widthOfTextAtSize(last + "...", size) > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "...";
    }
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

function drawValueRow(ctx: Ctx, cols: { value: string; w: number; red?: boolean }[], rowH = 26) {
  ensureSpace(ctx, rowH);
  let xCur = ctx.margin;
  for (const c of cols) {
    drawCell(ctx, xCur, ctx.y, c.w, rowH, "", c.value, { red: c.red, maxLines: 2 });
    xCur += c.w;
  }
  ctx.y -= rowH;
}

// 4-column key/value grid. Splits the row width into 4 cells of equal width.
function drawKVGrid(ctx: Ctx, pairs: { label: string; value: string; red?: boolean }[], cellH = 30) {
  if (pairs.length === 0) return;
  const totalW = ctx.width - ctx.margin*2;
  for (let i = 0; i < pairs.length; i += 4) {
    ensureSpace(ctx, cellH);
    const slice = pairs.slice(i, i + 4);
    const cellW = totalW / 4;
    let xCur = ctx.margin;
    for (let j = 0; j < 4; j++) {
      const p = slice[j];
      if (p) {
        drawCell(ctx, xCur, ctx.y, cellW, cellH, p.label, p.value, { red: p.red, maxLines: 2 });
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
          const stripped = f.name.replace(/^[a-z0-9_]+-/i, "");
          documents.push({ name: stripped || f.name, url });
        }
      }
    } catch (e) {
      console.error("[application-form] storage list failed:", (e as Error).message);
    }

    // Build PDF (embeds letterhead/photo/signature in the same doc).
    const p = await PDFDocument.create();
    const f = await p.embedFont(StandardFonts.Helvetica);
    const b = await p.embedFont(StandardFonts.HelveticaBold);
    const lh    = await fetchImage(p, branding?.letterhead_url ?? null);
    const photo = await fetchImage(p, photoUrl);
    const sig   = await fetchImage(p, branding?.signature_url ?? null);
    const out = await buildApplicationPdfInline(p, f, b, app, branding, lh, photo, sig, documents);

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
  lhImg: PDFImage | null, photoImg: PDFImage | null, sigImg: PDFImage | null,
  documents: { name: string; url: string }[],
): Promise<Uint8Array> {
  const flags = new Set<string>(Array.isArray(app.flags) ? app.flags : []);
  const ctx: Ctx = {
    pdf, page: null, font, bold,
    width: 595, height: 842, margin: 36, y: 0,
    contentStart: 0, contentEnd: 0,
    branding: { ...(branding || {}), _lh: lhImg },
    hasLetterhead: !!lhImg,
    flags,
  };
  await newPage(ctx);

  // ── HEADER: photo top-right, title + app no centered to the left ──
  const photoW = 86, photoH = 110;
  const photoX = ctx.width - ctx.margin - photoW;
  const photoY = ctx.contentStart - 4;
  ctx.page.drawRectangle({ x: photoX, y: photoY - photoH, width: photoW, height: photoH, color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5 });
  if (photoImg) {
    ctx.page.drawImage(photoImg, { x: photoX + 1, y: photoY - photoH + 1, width: photoW - 2, height: photoH - 2 });
  } else {
    ctx.page.drawText("Paste Your Recent", { x: photoX + 6, y: photoY - 26, size: 7, font, color: COLORS.muted });
    ctx.page.drawText("Passport Size",     { x: photoX + 6, y: photoY - 38, size: 7, font, color: COLORS.muted });
    ctx.page.drawText("Photograph Here",   { x: photoX + 6, y: photoY - 50, size: 7, font, color: COLORS.muted });
  }

  const titleArea = photoX - ctx.margin - 12;
  const titleText = "ADMISSION APPLICATION FORM";
  const titleW = bold.widthOfTextAtSize(titleText, 14);
  const titleX = ctx.margin + Math.max(0, (titleArea - titleW) / 2);
  ctx.page.drawText(titleText, { x: titleX, y: ctx.y - 36, size: 14, font: bold, color: COLORS.text });
  const idText = `Application No: ${app.application_id}`;
  const idW = bold.widthOfTextAtSize(idText, 11);
  const idX = ctx.margin + Math.max(0, (titleArea - idW) / 2);
  ctx.page.drawText(idText, { x: idX, y: ctx.y - 56, size: 11, font: bold, color: COLORS.text });

  ctx.y = Math.min(ctx.y - 70, photoY - photoH - 8);

  // ── COURSE PREFERENCES ─────────────────────────────────────────────
  const courses: any[] = Array.isArray(app.course_selections) ? app.course_selections : [];
  drawSection(ctx, "Course Preferences");
  const prefHdr = [
    { label: "Course Category", w: (ctx.width - ctx.margin*2) * 0.20 },
    { label: "Course Name",     w: (ctx.width - ctx.margin*2) * 0.50 },
    { label: "Campus",          w: (ctx.width - ctx.margin*2) * 0.30 },
  ];
  for (let i = 0; i < 3; i++) {
    const c = courses[i] || {};
    drawHeaderRow(ctx, [{ label: `Preference ${i + 1}`, w: ctx.width - ctx.margin*2 }], 14);
    drawHeaderRow(ctx, prefHdr, 14);
    drawValueRow(ctx, [
      { value: norm(c.program_category), w: prefHdr[0].w },
      { value: norm(c.course_name),      w: prefHdr[1].w },
      { value: norm(c.campus_name),      w: prefHdr[2].w },
    ], 26);
  }

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

  // ── ADDRESS ────────────────────────────────────────────────────────
  drawSection(ctx, "Address");
  const a = app.address || {};
  drawKVGrid(ctx, [
    { label: "Address Line 1", value: norm(a.line1) },
    { label: "City",           value: norm(a.city) },
    { label: "State",          value: norm(a.state) },
    { label: "Country",        value: norm(a.country) },
    { label: "PIN Code",       value: norm(a.pin_code) },
    { label: "",               value: "" },
    { label: "",               value: "" },
    { label: "",               value: "" },
  ]);

  // ── PARENTS / GUARDIAN ─────────────────────────────────────────────
  const parentName = (p: any) => {
    if (!p || typeof p !== "object") return "-";
    const composed = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return norm(composed || p.name);
  };

  drawSection(ctx, "Father's Details");
  const f = app.father || {};
  drawKVGrid(ctx, [
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
    { label: "",                value: "" },
    { label: "Mobile",          value: norm(f.phone_mobile || f.phone) },
    { label: "Home Phone",      value: norm(f.phone_home) },
    { label: "Email",           value: norm(f.email) },
    { label: "",                value: "" },
  ]);

  drawSection(ctx, "Mother's Details");
  const m = app.mother || {};
  drawKVGrid(ctx, [
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
    { label: "",                value: "" },
    { label: "Mobile",          value: norm(m.phone_mobile || m.phone) },
    { label: "Home Phone",      value: norm(m.phone_home) },
    { label: "Email",           value: norm(m.email) },
    { label: "",                value: "" },
  ]);

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
      { label: "School",        w: (ctx.width - ctx.margin*2) * 0.30 },
      { label: "Board",         w: (ctx.width - ctx.margin*2) * 0.30 },
      { label: "Subjects/Stream", w: (ctx.width - ctx.margin*2) * 0.16 },
      { label: "Year",          w: (ctx.width - ctx.margin*2) * 0.08 },
      { label: "Result",        w: (ctx.width - ctx.margin*2) * 0.10 },
      { label: "Marks",         w: (ctx.width - ctx.margin*2) * 0.06 },
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

  // Manual-verification callout
  if (customBoardFlag || customUniversityFlag) {
    ensureSpace(ctx, 30);
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - 26, width: ctx.width - ctx.margin*2, height: 26,
      color: COLORS.redFill, borderColor: COLORS.redBorder, borderWidth: 1,
    });
    ctx.page.drawText("Note for Admissions Team - Manual Verification Required", {
      x: ctx.margin + 8, y: ctx.y - 12, size: 9, font: bold, color: COLORS.redBorder,
    });
    ctx.page.drawText("Candidate selected a board/university not in our predefined list. Verify validity before issuing an offer.", {
      x: ctx.margin + 8, y: ctx.y - 22, size: 7.5, font, color: COLORS.text,
    });
    ctx.y -= 32;
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

  // ── DOCUMENTS UPLOADED (with clickable links) ──────────────────────
  drawSection(ctx, "Documents Uploaded");
  if (documents.length === 0) {
    drawWide(ctx, "Status", "No documents uploaded yet.");
  } else {
    const colsD = [
      { label: "#",             w: 24 },
      { label: "Document Name", w: (ctx.width - ctx.margin*2 - 24) * 0.4 },
      { label: "File",          w: (ctx.width - ctx.margin*2 - 24) * 0.6 },
    ];
    drawHeaderRow(ctx, colsD, 14);
    documents.forEach((d, i) => {
      ensureSpace(ctx, 16);
      drawCell(ctx, ctx.margin, ctx.y, colsD[0].w, 16, "", String(i + 1));
      drawCell(ctx, ctx.margin + colsD[0].w, ctx.y, colsD[1].w, 16, "", d.name);
      const fileX = ctx.margin + colsD[0].w + colsD[1].w;
      ctx.page.drawRectangle({ x: fileX, y: ctx.y - 16, width: colsD[2].w, height: 16, color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5 });
      const linkText = d.url.length > 70 ? d.url.slice(0, 70) + "..." : d.url;
      ctx.page.drawText(linkText, { x: fileX + 4, y: ctx.y - 11, size: 7.5, font, color: COLORS.link });
      addLinkAnnotation(ctx, fileX, ctx.y - 16, colsD[2].w, 16, d.url);
      ctx.y -= 16;
    });
  }

  // ── DECLARATION ────────────────────────────────────────────────────
  drawSection(ctx, "Declaration");
  const declarations = [
    "I HEREBY DECLARE THAT, the details given by me in the application form are complete and true to the best of my knowledge and based on records.",
    "I HEREBY UNDERTAKE TO PRESENT THE ORIGINAL DOCUMENTS immediately upon demand by the concerned authorities of the institution.",
    "I HEREBY PROMISE TO ABIDE BY THE ADMISSIBLE RULES AND REGULATIONS, concerning discipline, attendance, etc. of the institution, as in force from time to time and any subsequent changes/modifications/amendments made thereto. I acknowledge that the institution has the authority for taking punitive actions against me for violation and/or non-compliance of the same.",
    "I UNDERSTAND THAT, 75% attendance in classes is compulsory and I commit myself to adhere to the same. I also understand that, in case my attendance falls short for any reason, the competent authority of the institute may take such punitive actions against me, as may be deemed fit and proper.",
    "I HEREBY DECLARE THAT, I will neither join in any coercive agitation/strike for the purpose of forcing the authorities of the institution to solve any problem, nor will I participate in activity which has a tendency to disturb the peace and tranquility of life of the institution campus and/or its hostel premises.",
    "I HEREBY DECLARE THAT, I will not indulge in, nor tolerate ragging, in any form, even in words or intentions, and I accept to give an undertaking in the prescribed format for the same. I shall be solely responsible for my involvement in any kind of undesirable/disciplinary activities outside the campus, and shall be liable for punishment as per university.",
    "I ALSO DECLARE THAT, I am not suffering from any serious/contagious ailment and/or any psychiatric/psychological disorder.",
    "I FURTHER DECLARE THAT, my admission may be cancelled, at any stage, if I am found ineligible and/or the information provided by me are found to be incorrect.",
    "I HEREBY UNDERTAKE TO INFORM THE INSTITUTION about any changes in information submitted by me, in the application form and any other documents, including change in addresses and contact number, from time to time.",
    "I HEREBY DECLARE THAT, in case I cancel my admission during anytime of course, I will follow all the rules and regulations of the university.",
  ];
  declarations.forEach((d, i) => {
    const text = `${i + 1}. ${d}`;
    const lines = text.match(/.{1,115}(\s|$)/g) || [text];
    lines.forEach(line => {
      ensureSpace(ctx, 10);
      ctx.page.drawText(line.trim(), { x: ctx.margin, y: ctx.y - 7, size: 7.5, font, color: COLORS.text });
      ctx.y -= 9;
    });
    ctx.y -= 2;
  });

  // ── SIGNATURE ──────────────────────────────────────────────────────
  ensureSpace(ctx, 36);
  ctx.y -= 6;
  const sigCols = [
    { label: "Applicant Name", value: norm(app.full_name) },
    { label: "Parent Name",    value: parentName(f) === "-" ? parentName(m) : parentName(f) },
    { label: "Date",           value: fmtDate(app.submitted_at || app.updated_at) },
    { label: "Place",          value: norm(a.city) },
  ];
  const totalW = ctx.width - ctx.margin*2;
  let xCur = ctx.margin;
  for (const c of sigCols) {
    drawCell(ctx, xCur, ctx.y, totalW / 4, 30, c.label, c.value);
    xCur += totalW / 4;
  }
  ctx.y -= 32;

  if (sigImg && ctx.y - 50 > ctx.contentEnd) {
    const sigW = 80, sigH = 32;
    ctx.page.drawImage(sigImg, { x: ctx.width - ctx.margin - sigW, y: ctx.y - sigH, width: sigW, height: sigH });
    ctx.page.drawLine({
      start: { x: ctx.width - ctx.margin - 130, y: ctx.y - sigH - 4 },
      end:   { x: ctx.width - ctx.margin,        y: ctx.y - sigH - 4 },
      thickness: 0.5, color: COLORS.muted,
    });
    ctx.page.drawText(branding?.signatory_name || "Authorised Signatory", {
      x: ctx.width - ctx.margin - 130, y: ctx.y - sigH - 16, size: 8, font: bold, color: COLORS.text,
    });
    ctx.page.drawText(branding?.signatory_designation || "for the Institution", {
      x: ctx.width - ctx.margin - 130, y: ctx.y - sigH - 26, size: 7, font, color: COLORS.muted,
    });
  }

  return await pdf.save();
}

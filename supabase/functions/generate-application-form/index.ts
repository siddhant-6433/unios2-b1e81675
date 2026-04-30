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
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("png") || url.toLowerCase().endsWith(".png")) return await pdf.embedPng(bytes);
    return await pdf.embedJpg(bytes);
  } catch { return null; }
}

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const upper = (s?: string | null) => (s ?? "").toString().toUpperCase().trim() || "—";
// Display all data in CAPS — keeps the doc visually consistent and matches the
// historical NIMT-UG application format.
const norm  = (s?: string | null) => (s ?? "").toString().toUpperCase().trim() || "—";
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
      // Tall image — likely full-page A4 background. Stretch to fit.
      ctx.page.drawImage(lh, { x: 0, y: 0, width: ctx.width, height: ctx.height });
      // Reserve generous top + bottom for header/footer bands inside the
      // letterhead artwork itself.
      topReserve    = 150;
      bottomReserve = 150;
    } else {
      // Banner / header-only — render at top, scaled to width at native aspect.
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
// Drops trailing words to fit `maxLines`; appends "…" if truncated.
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
      // word itself too long — hard-break.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        // Cut word at safe length.
        let cut = word;
        while (cut.length > 1 && font.widthOfTextAtSize(cut + "…", size) > maxWidth) cut = cut.slice(0, -1);
        lines.push(cut + "…");
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
      while (last.length > 1 && font.widthOfTextAtSize(last + "…", size) > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "…";
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
  if (!addr || typeof addr !== "object") return "—";
  return [addr.line1, addr.line2, addr.city, addr.district, addr.state, addr.pincode, addr.country]
    .filter(Boolean).join(", ") || "—";
}

function fmtPersonName(p: any): string {
  if (!p || typeof p !== "object") return "—";
  return [p.title, p.first_name, p.middle_name, p.last_name, p.name].filter(Boolean).join(" ") || (p.name || "—");
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
      // Photo conventions vary — PhotoUpload uses passport_photo.png; school
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
          // Already picked a photo — skip duplicates.
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

  // --- HEADER (title + app id + photo) --------------------------------
  const courses: any[] = Array.isArray(app.course_selections) ? app.course_selections : [];
  const programLabel: Record<string, string> = {
    school: "Course for School",
    undergraduate: "Course After 12th",
    postgraduate: "Course After Graduation",
    mba_pgdm: "MBA / PGDM Program",
    professional: "Professional Course",
    bed: "B.Ed Program",
    deled: "D.El.Ed Program",
  };
  const titleText = (programLabel[app.program_category] || "Application Form").toUpperCase();

  // Photo box sits at the top-right; title + app no sit to its left,
  // centered within the remaining horizontal space. Drawn FIRST so the
  // white-filled photo box covers the letterhead artwork beneath cleanly.
  const photoW = 80, photoH = 100;
  const photoX = ctx.width - ctx.margin - photoW;
  const photoY = ctx.contentStart - 4;
  ctx.page.drawRectangle({ x: photoX, y: photoY - photoH, width: photoW, height: photoH, color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5 });
  if (photoImg) {
    ctx.page.drawImage(photoImg, { x: photoX + 1, y: photoY - photoH + 1, width: photoW - 2, height: photoH - 2 });
  } else {
    ctx.page.drawText("Paste Your Recent", { x: photoX + 6, y: photoY - 22, size: 7, font, color: COLORS.muted });
    ctx.page.drawText("Passport Size",     { x: photoX + 6, y: photoY - 32, size: 7, font, color: COLORS.muted });
    ctx.page.drawText("Photograph Here",   { x: photoX + 6, y: photoY - 42, size: 7, font, color: COLORS.muted });
  }

  // Title centered in the available width (left of photo box).
  const titleArea = photoX - ctx.margin - 10; // leave 10pt gutter
  const titleW = bold.widthOfTextAtSize(titleText, 14);
  const titleX = ctx.margin + Math.max(0, (titleArea - titleW) / 2);
  ctx.page.drawText(titleText, { x: titleX, y: ctx.y - 36, size: 14, font: bold, color: COLORS.text });
  const idText = `Application No: ${app.application_id}`;
  const idW = bold.widthOfTextAtSize(idText, 11);
  const idX = ctx.margin + Math.max(0, (titleArea - idW) / 2);
  ctx.page.drawText(idText, { x: idX, y: ctx.y - 56, size: 11, font: bold, color: COLORS.text });

  // Move cursor past the title block + photo box to wherever is lower.
  const titleBottom = ctx.y - 70;
  const photoBottom = photoY - photoH - 6;
  ctx.y = Math.min(titleBottom, photoBottom);

  // --- COURSE PREFERENCES ---------------------------------------------
  drawSection(ctx, "Course Preferences");
  const prefHeaderCols = [
    { label: "Course Category", w: (ctx.width - ctx.margin*2) * 0.18 },
    { label: "Department",      w: (ctx.width - ctx.margin*2) * 0.20 },
    { label: "Course Name",     w: (ctx.width - ctx.margin*2) * 0.42 },
    { label: "Campus",          w: (ctx.width - ctx.margin*2) * 0.20 },
  ];
  for (let i = 0; i < 3; i++) {
    const c = courses[i] || {};
    drawHeaderRow(ctx, [{ label: `Preference ${i + 1}`, w: ctx.width - ctx.margin*2 }], 14);
    drawHeaderRow(ctx, prefHeaderCols, 14);
    drawValueRow(ctx, [
      { value: norm(c.program_category || c.category), w: prefHeaderCols[0].w },
      { value: norm(c.department),                      w: prefHeaderCols[1].w },
      { value: norm(c.course_name),                     w: prefHeaderCols[2].w },
      { value: norm(c.campus_name),                     w: prefHeaderCols[3].w },
    ], 18);
  }

  // --- PERSONAL DETAILS -----------------------------------------------
  drawSection(ctx, "Personal Details");
  drawKVGrid(ctx, [
    { label: "Title",          value: norm(app.title) },
    { label: "First Name",     value: upper(app.first_name || (app.full_name || "").split(" ")[0]) },
    { label: "Middle Name",    value: upper(app.middle_name) },
    { label: "Last Name",      value: upper(app.last_name || (app.full_name || "").split(" ").slice(1).join(" ")) },
    { label: "Gender",         value: upper(app.gender) },
    { label: "Date of Birth",  value: fmtDate(app.dob) },
    { label: "Mobile Number",  value: norm(app.phone) },
    { label: "Alternate Mobile", value: norm(app.alternate_phone) },
    { label: "Email ID",       value: norm(app.email) },
    { label: "Blood Group",    value: norm(app.blood_group) },
    { label: "Marital Status", value: upper(app.marital_status) },
    { label: "Mother Tongue",  value: upper(app.mother_tongue) },
    { label: "Religion",       value: upper(app.religion) },
    { label: "PwD",            value: upper(app.pwd ? "YES" : "NO") },
    { label: "Nationality",    value: upper(app.nationality) },
    { label: "Aadhaar No",     value: norm(app.aadhaar) },
    { label: "Category",       value: upper(app.category) },
    { label: "APAAR ID",       value: norm(app.apaar_id) },
    { label: "PEN Number",     value: norm(app.pen_number) },
    { label: "State Domicile", value: upper(app.state_domicile) },
  ]);

  // --- EDUCATION -------------------------------------------------------
  const ad = app.academic_details || {};
  const customBoardFlag      = flags.has("custom_board");
  const customUniversityFlag = flags.has("custom_university");

  drawSection(ctx, "Educational Details");

  if (ad.class_10) {
    drawHeaderRow(ctx, [{ label: "10th / SSC Details", w: ctx.width - ctx.margin*2 }], 14);
    const c10 = ad.class_10;
    const cols10 = [
      { label: "Institute Name",  w: (ctx.width - ctx.margin*2) * 0.25 },
      { label: "Board / University", w: (ctx.width - ctx.margin*2) * 0.30 },
      { label: "Year",            w: (ctx.width - ctx.margin*2) * 0.10 },
      { label: "Result Status",   w: (ctx.width - ctx.margin*2) * 0.13 },
      { label: "Marking Scheme",  w: (ctx.width - ctx.margin*2) * 0.12 },
      { label: "%/CGPA",          w: (ctx.width - ctx.margin*2) * 0.10 },
    ];
    drawHeaderRow(ctx, cols10, 14);
    drawValueRow(ctx, [
      { value: norm(c10.institute || c10.school), w: cols10[0].w },
      { value: norm(c10.board),                    w: cols10[1].w, red: customBoardFlag && !!c10.board },
      { value: norm(c10.year),                     w: cols10[2].w },
      { value: norm(c10.result_status),            w: cols10[3].w },
      { value: norm(c10.marking_scheme),           w: cols10[4].w },
      { value: norm(c10.percentage || c10.cgpa),   w: cols10[5].w },
    ], 20);
  }

  if (ad.class_12) {
    drawHeaderRow(ctx, [{ label: "12th / HSC Details", w: ctx.width - ctx.margin*2 }], 14);
    const c12 = ad.class_12;
    const cols12 = [
      { label: "School Name",       w: (ctx.width - ctx.margin*2) * 0.22 },
      { label: "Board / University", w: (ctx.width - ctx.margin*2) * 0.27 },
      { label: "Major Subject",     w: (ctx.width - ctx.margin*2) * 0.13 },
      { label: "Year",              w: (ctx.width - ctx.margin*2) * 0.08 },
      { label: "Result Status",     w: (ctx.width - ctx.margin*2) * 0.12 },
      { label: "Marking",           w: (ctx.width - ctx.margin*2) * 0.10 },
      { label: "%/CGPA",            w: (ctx.width - ctx.margin*2) * 0.08 },
    ];
    drawHeaderRow(ctx, cols12, 14);
    drawValueRow(ctx, [
      { value: norm(c12.institute || c12.school),       w: cols12[0].w },
      { value: norm(c12.board),                          w: cols12[1].w, red: customBoardFlag && !!c12.board },
      { value: norm(c12.major_subject || c12.stream),    w: cols12[2].w },
      { value: norm(c12.year),                           w: cols12[3].w },
      { value: norm(c12.result_status),                  w: cols12[4].w },
      { value: norm(c12.marking_scheme),                 w: cols12[5].w },
      { value: norm(c12.percentage || c12.cgpa),         w: cols12[6].w },
    ], 20);
  }

  if (ad.diploma) {
    drawHeaderRow(ctx, [{ label: "Diploma Details", w: ctx.width - ctx.margin*2 }], 14);
    drawKVGrid(ctx, [
      { label: "Institute",        value: norm(ad.diploma.institute) },
      { label: "Board/University", value: norm(ad.diploma.board || ad.diploma.university), red: customBoardFlag || customUniversityFlag },
      { label: "Major Subject",    value: norm(ad.diploma.major_subject) },
      { label: "Year",             value: norm(ad.diploma.year) },
      { label: "Marking Scheme",   value: norm(ad.diploma.marking_scheme) },
      { label: "%/CGPA",           value: norm(ad.diploma.percentage || ad.diploma.cgpa) },
    ]);
  }

  if (ad.graduation) {
    drawHeaderRow(ctx, [{ label: "Graduation Details", w: ctx.width - ctx.margin*2 }], 14);
    drawKVGrid(ctx, [
      { label: "Institute",      value: norm(ad.graduation.institute) },
      { label: "University",     value: norm(ad.graduation.university), red: customUniversityFlag && !!ad.graduation.university },
      { label: "Degree",         value: norm(ad.graduation.degree) },
      { label: "Specialization", value: norm(ad.graduation.specialization || ad.graduation.discipline) },
      { label: "Year",           value: norm(ad.graduation.year) },
      { label: "Result Status",  value: norm(ad.graduation.result_status) },
      { label: "Marking Scheme", value: norm(ad.graduation.marking_scheme) },
      { label: "%/CGPA",         value: norm(ad.graduation.percentage || ad.graduation.cgpa) },
    ]);
  }

  if (customBoardFlag || customUniversityFlag) {
    ensureSpace(ctx, 28);
    ctx.page.drawRectangle({
      x: ctx.margin, y: ctx.y - 24, width: ctx.width - ctx.margin*2, height: 24,
      color: COLORS.redFill, borderColor: COLORS.redBorder, borderWidth: 1,
    });
    ctx.page.drawText("⚠ Note for Admissions Team — Manual Verification Required", {
      x: ctx.margin + 8, y: ctx.y - 11, size: 9, font: bold, color: COLORS.redBorder,
    });
    ctx.page.drawText("Candidate selected a board/university not in our predefined list. Verify the highlighted entries before issuing an offer.", {
      x: ctx.margin + 8, y: ctx.y - 21, size: 7.5, font, color: COLORS.text,
    });
    ctx.y -= 30;
  }

  // --- WORK EXPERIENCE -------------------------------------------------
  const work: any[] = Array.isArray(ad.work_experience) ? ad.work_experience : [];
  if (work.length > 0) {
    drawSection(ctx, "Work Experience");
    const cols = [
      { label: "#",            w: 24 },
      { label: "Position",     w: (ctx.width - ctx.margin*2 - 24) * 0.30 },
      { label: "Organisation", w: (ctx.width - ctx.margin*2 - 24) * 0.34 },
      { label: "From",         w: (ctx.width - ctx.margin*2 - 24) * 0.12 },
      { label: "To",           w: (ctx.width - ctx.margin*2 - 24) * 0.12 },
      { label: "Total",        w: (ctx.width - ctx.margin*2 - 24) * 0.12 },
    ];
    drawHeaderRow(ctx, cols, 14);
    work.slice(0, 8).forEach((w, i) => {
      drawValueRow(ctx, [
        { value: String(i + 1), w: cols[0].w },
        { value: norm(w.position), w: cols[1].w },
        { value: norm(w.organisation || w.organization || w.company), w: cols[2].w },
        { value: norm(w.from || w.from_year), w: cols[3].w },
        { value: norm(w.to || w.to_year),     w: cols[4].w },
        { value: norm(w.total || w.duration), w: cols[5].w },
      ], 16);
    });
  }

  // --- CO-CURRICULAR ---------------------------------------------------
  const eca: any[] = Array.isArray(app.extracurricular) ? app.extracurricular
    : Array.isArray(ad.extracurricular) ? ad.extracurricular : [];
  if (eca.length > 0) {
    drawSection(ctx, "Co-curricular Activities");
    const cols = [
      { label: "#",                    w: 24 },
      { label: "Name of the Activity", w: (ctx.width - ctx.margin*2 - 24) * 0.6 },
      { label: "Level",                w: (ctx.width - ctx.margin*2 - 24) * 0.2 },
      { label: "Year / Date",          w: (ctx.width - ctx.margin*2 - 24) * 0.2 },
    ];
    drawHeaderRow(ctx, cols, 14);
    eca.slice(0, 8).forEach((e, i) => {
      drawValueRow(ctx, [
        { value: String(i + 1), w: cols[0].w },
        { value: norm(e.name || e.activity), w: cols[1].w },
        { value: norm(e.level),                w: cols[2].w },
        { value: norm(e.date || e.year),       w: cols[3].w },
      ], 16);
    });
  }

  // --- PARENTS / GUARDIAN ---------------------------------------------
  drawSection(ctx, "Parents' / Guardian Details");
  const f = app.father || {}, m = app.mother || {}, g = app.guardian || {};
  drawHeaderRow(ctx, [{ label: "Father's Details", w: ctx.width - ctx.margin*2 }], 14);
  drawKVGrid(ctx, [
    { label: "Title",         value: norm(f.title) },
    { label: "Name",          value: fmtPersonName(f) },
    { label: "Mobile",        value: norm(f.phone || f.mobile) },
    { label: "Email",         value: norm(f.email) },
    { label: "Occupation",    value: norm(f.occupation) },
    { label: "Annual Income", value: norm(f.annual_income || app.family_annual_income) },
  ]);
  drawHeaderRow(ctx, [{ label: "Mother's Details", w: ctx.width - ctx.margin*2 }], 14);
  drawKVGrid(ctx, [
    { label: "Title",         value: norm(m.title) },
    { label: "Name",          value: fmtPersonName(m) },
    { label: "Mobile",        value: norm(m.phone || m.mobile) },
    { label: "Email",         value: norm(m.email) },
    { label: "Occupation",    value: norm(m.occupation) },
    { label: "Annual Income", value: norm(m.annual_income) },
  ]);
  if (g && (g.name || g.phone)) {
    drawHeaderRow(ctx, [{ label: "Local Guardian", w: ctx.width - ctx.margin*2 }], 14);
    drawKVGrid(ctx, [
      { label: "Name",     value: fmtPersonName(g) },
      { label: "Mobile",   value: norm(g.phone || g.mobile) },
      { label: "Relation", value: norm(g.relation) },
      { label: "Address",  value: norm(g.address) },
    ]);
  }

  // --- ADDRESS ---------------------------------------------------------
  drawSection(ctx, "Address Details");
  const addr = app.address || {};
  const corres = addr.correspondence || addr;
  const perm   = addr.permanent || addr;
  drawHeaderRow(ctx, [{ label: "Address for Correspondence", w: ctx.width - ctx.margin*2 }], 14);
  drawWide(ctx, "Address", fmtAddress(corres));
  drawHeaderRow(ctx, [{ label: "Permanent Address", w: ctx.width - ctx.margin*2 }], 14);
  drawWide(ctx, "Address", fmtAddress(perm));

  // --- DOCUMENTS UPLOADED (with clickable file links) ------------------
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
      const linkText = d.url.length > 70 ? d.url.slice(0, 70) + "…" : d.url;
      ctx.page.drawText(linkText, { x: fileX + 4, y: ctx.y - 11, size: 7.5, font, color: COLORS.link });
      addLinkAnnotation(ctx, fileX, ctx.y - 16, colsD[2].w, 16, d.url);
      ctx.y -= 16;
    });
  }

  // --- DECLARATION -----------------------------------------------------
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

  // --- SIGNATURE ROW ---------------------------------------------------
  ensureSpace(ctx, 36);
  ctx.y -= 6;
  const sigCols = [
    { label: "Applicant Name", value: norm(app.full_name) },
    { label: "Parent Name",    value: fmtPersonName(f) === "—" ? fmtPersonName(m) : fmtPersonName(f) },
    { label: "Date",           value: fmtDate(app.submitted_at || app.updated_at) },
    { label: "Place",          value: norm((app.address?.city) || (corres?.city)) },
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

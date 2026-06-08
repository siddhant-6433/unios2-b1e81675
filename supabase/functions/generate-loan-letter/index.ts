import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, PDFFont, PDFPage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fmtINR = (n: number) =>
  "Rs. " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LOAN_LETTER_UNLOCK_TOKEN_FEE = 5000;
const DEFAULT_BANK_DETAILS = {
  beneficiary_name: "NIMT B. SCHOOL'S FOUNDATION",
  bank_name: "IDFC BANK",
  account_no: "10118454426",
  ifsc: "IDFB0020154",
  branch: "Alpha 1, Greater Noida",
  upi_id: "-",
};

const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

const letterRefNo = (offerId?: string | null, applicationId?: string | null) => {
  const year = new Date().getFullYear();
  const suffix = (applicationId || offerId || "NA").replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase() || "NA";
  return `NIMT/EL/${year}/${suffix}`;
};

async function fetchImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "";
    const png = ct.includes("png") || url.toLowerCase().endsWith(".png");
    try {
      return png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      return png ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    }
  } catch {
    return null;
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

const COLORS = {
  border: rgb(0.55, 0.55, 0.6),
  labelBg: rgb(0.93, 0.93, 0.96),
  sectionBg: rgb(0.10, 0.13, 0.24),
  sectionFg: rgb(1, 1, 1),
  text: rgb(0.10, 0.10, 0.15),
  muted: rgb(0.45, 0.45, 0.5),
  hilite: rgb(0.94, 0.97, 0.94),
};

type LoanLetterOpts = {
  offer: any;
  lead: any;
  course: { name?: string | null; duration_years?: number | null } | null;
  campus: any;
  applicationId: string | null;
  bankDetails: {
    beneficiary_name: string;
    bank_name: string;
    account_no: string;
    ifsc: string;
    branch: string;
    upi_id: string;
  };
  branding: any;
  sessionName: string | null;
  firstYearFee: number;
  totalCourseFee: number;
  tokenRequired: number;
  tokenPaid: number;
  firstYearAmountDue: number;
  loanLetterUnlockAmount: number;
  yearItems: { term: string; total: number; waiver: number; applicable: number; dueDate?: string | null }[];
};

type LoanLetterCtx = {
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
  appId?: string | null;
  sessionName?: string | null;
};

function newPage(ctx: LoanLetterCtx) {
  ctx.page = ctx.pdf.addPage([595, 842]);
  let topReserve = 90;
  let bottomReserve = 50;

  if (ctx.hasLetterhead && ctx.branding?._lh) {
    const lh = ctx.branding._lh as PDFImage;
    const aspectHW = lh.height / lh.width;

    if (aspectHW >= 1.2) {
      ctx.page.drawImage(lh, { x: 0, y: 0, width: ctx.width, height: ctx.height });
      topReserve = 150;
      bottomReserve = 104;
    } else {
      const lhHeight = ctx.width * aspectHW;
      ctx.page.drawImage(lh, { x: 0, y: ctx.height - lhHeight, width: ctx.width, height: lhHeight });
      topReserve = lhHeight + 16;

      if (ctx.branding._footer) {
        const f = ctx.branding._footer as PDFImage;
        const fAspect = f.height / f.width;
        const fH = Math.min(ctx.width * fAspect, 120);
        ctx.page.drawImage(f, { x: 0, y: 0, width: ctx.width, height: fH });
        bottomReserve = fH + 8;
      }
    }
  } else {
    ctx.page.drawRectangle({ x: 0, y: ctx.height - 70, width: ctx.width, height: 70, color: COLORS.sectionBg });
    ctx.page.drawText(ctx.branding?.name || "NIMT Educational Institutions", {
      x: ctx.margin, y: ctx.height - 36, size: 14, font: ctx.bold, color: COLORS.sectionFg,
    });
    if (ctx.branding?.address) {
      ctx.page.drawText(ctx.branding.address, {
        x: ctx.margin, y: ctx.height - 54, size: 8, font: ctx.font, color: rgb(0.85, 0.88, 0.95),
      });
    }
  }

  ctx.contentStart = ctx.height - topReserve;
  ctx.contentEnd = bottomReserve;
  ctx.y = ctx.contentStart;

  if (ctx.appId) {
    const line1 = "Application ID";
    const line3 = ctx.appId;
    const sizeSm = 10;
    const sizeLg = 16;
    const padX = 18;
    const padY = 10;
    const lineGap = 4;
    const w1 = ctx.bold.widthOfTextAtSize(line1, sizeSm);
    const w3 = ctx.bold.widthOfTextAtSize(line3, sizeLg);
    const badgeW = Math.max(w1, w3) + padX * 2;
    const linesH = sizeSm + lineGap + sizeLg;
    const badgeH = padY * 2 + linesH;
    const badgeX = ctx.width - ctx.margin - badgeW;
    const badgeY = ctx.height - 18;
    const badgeColor = rgb(0.20, 0.69, 0.39);
    const radius = 10;

    ctx.page.drawRectangle({ x: badgeX + radius, y: badgeY - badgeH, width: badgeW - radius * 2, height: badgeH, color: badgeColor });
    ctx.page.drawRectangle({ x: badgeX, y: badgeY - badgeH + radius, width: badgeW, height: badgeH - radius * 2, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + radius, y: badgeY - radius, size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + badgeW - radius, y: badgeY - radius, size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + radius, y: badgeY - badgeH + radius, size: radius, color: badgeColor });
    ctx.page.drawCircle({ x: badgeX + badgeW - radius, y: badgeY - badgeH + radius, size: radius, color: badgeColor });

    let textY = badgeY - padY - sizeSm + 2;
    ctx.page.drawText(line1, { x: badgeX + (badgeW - w1) / 2, y: textY, size: sizeSm, font: ctx.bold, color: rgb(1, 1, 1) });
    textY -= lineGap + sizeLg;
    ctx.page.drawText(line3, { x: badgeX + (badgeW - w3) / 2, y: textY, size: sizeLg, font: ctx.bold, color: rgb(1, 1, 1) });
  }
}

function ensureSpace(ctx: LoanLetterCtx, need: number) {
  if (ctx.y - need < ctx.contentEnd) newPage(ctx);
}

function drawSection(ctx: LoanLetterCtx, title: string, height = 14) {
  ensureSpace(ctx, height + 4);
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - height, width: ctx.width - ctx.margin * 2, height,
    color: COLORS.sectionBg,
  });
  ctx.page.drawText(title, {
    x: ctx.margin + 8, y: ctx.y - height + 4.5, size: 7.8, font: ctx.bold, color: COLORS.sectionFg,
  });
  ctx.y -= height + 1;
}

function drawParagraph(ctx: LoanLetterCtx, text: string, size = 7.7, gapAfter = 2) {
  const lineH = size + 3;
  const lines = wrapText(text, ctx.font, size, ctx.width - ctx.margin * 2);
  for (const line of lines) {
    ensureSpace(ctx, lineH);
    ctx.page.drawText(line, { x: ctx.margin, y: ctx.y - size, size, font: ctx.font, color: COLORS.text });
    ctx.y -= lineH;
  }
  ctx.y -= gapAfter;
}

function drawCell(
  ctx: LoanLetterCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  opts: { valueSize?: number; maxLines?: number } = {},
) {
  ctx.page.drawRectangle({ x, y: y - h, width: w, height: h, color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5 });
  ctx.page.drawText(label, { x: x + 4, y: y - 11, size: 6.5, font: ctx.font, color: COLORS.muted });
  const valueSize = opts.valueSize ?? 6.8;
  const lines = wrapText(value || "-", ctx.bold, valueSize, w - 8).slice(0, opts.maxLines ?? 3);
  const lineH = valueSize + 2.2;
  lines.forEach((line, i) => {
    ctx.page.drawText(line, { x: x + 4, y: y - 20 - i * lineH, size: valueSize, font: ctx.bold, color: COLORS.text });
  });
}

function drawKVGrid(ctx: LoanLetterCtx, pairs: { label: string; value: string }[], cols = 4) {
  const totalW = ctx.width - ctx.margin * 2;
  const cellW = totalW / cols;
  const valueSize = 6.8;
  const lineH = valueSize + 2.2;
  for (let i = 0; i < pairs.length; i += cols) {
    const row = pairs.slice(i, i + cols);
    const maxLines = Math.max(1, ...row.map(pair => wrapText(pair.value || "-", ctx.bold, valueSize, cellW - 8).slice(0, 2).length));
    const cellH = Math.max(25, 18 + maxLines * lineH);
    ensureSpace(ctx, cellH);
    let x = ctx.margin;
    for (let j = 0; j < cols; j++) {
      const pair = row[j];
      if (pair) drawCell(ctx, x, ctx.y, cellW, cellH, pair.label, pair.value, { valueSize, maxLines: 2 });
      else ctx.page.drawRectangle({ x, y: ctx.y - cellH, width: cellW, height: cellH, color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5 });
      x += cellW;
    }
    ctx.y -= cellH;
  }
}

function drawFeeTable(ctx: LoanLetterCtx, items: LoanLetterOpts["yearItems"]) {
  const totalW = ctx.width - ctx.margin * 2;
  const colW = [totalW * 0.28, totalW * 0.18, totalW * 0.18, totalW * 0.18, totalW * 0.18];
  const colX = [ctx.margin, ctx.margin + colW[0], ctx.margin + colW[0] + colW[1], ctx.margin + colW[0] + colW[1] + colW[2], ctx.margin + colW[0] + colW[1] + colW[2] + colW[3]];
  const headers = ["Year", "Due Date", "Published", "Waiver", "Applicable"];
  const rowH = 16;
  const drawRow = (values: string[], header = false, highlight = false) => {
    ensureSpace(ctx, rowH);
    values.forEach((value, i) => {
      ctx.page.drawRectangle({
        x: colX[i], y: ctx.y - rowH, width: colW[i], height: rowH,
        color: header ? COLORS.labelBg : highlight ? COLORS.hilite : rgb(1, 1, 1),
        borderColor: COLORS.border, borderWidth: 0.5,
      });
      const f = header || highlight || i === 4 ? ctx.bold : ctx.font;
      const size = header ? 6.6 : 6.8;
      if (i === 0) {
        ctx.page.drawText(value, { x: colX[i] + 8, y: ctx.y - 12.5, size, font: f, color: COLORS.text });
      } else {
        const textWidth = f.widthOfTextAtSize(value, size);
        ctx.page.drawText(value, { x: colX[i] + colW[i] - textWidth - 8, y: ctx.y - 12.5, size, font: f, color: COLORS.text });
      }
    });
    ctx.y -= rowH;
  };

  drawRow(headers, true);
  let totalPublished = 0;
  let totalWaiver = 0;
  let totalApplicable = 0;
  for (const item of items) {
    totalPublished += item.total;
    totalWaiver += item.waiver;
    totalApplicable += item.applicable;
    drawRow([
      item.term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      fmtDate(item.dueDate),
      fmtINR(item.total),
      item.waiver > 0 ? "- " + fmtINR(item.waiver) : "—",
      fmtINR(item.applicable),
    ]);
  }
  drawRow(["Total Programme Fee", "—", fmtINR(totalPublished), totalWaiver > 0 ? "- " + fmtINR(totalWaiver) : "—", fmtINR(totalApplicable)], false, true);
}

async function buildLoanLetterPdf(opts: LoanLetterOpts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const letterhead = await fetchImage(pdf, opts.branding?.letterhead_url ?? null);
  const footer = await fetchImage(pdf, opts.branding?.footer_url ?? null);
  const signature = await fetchImage(pdf, opts.branding?.signature_url ?? null);

  const ctx: LoanLetterCtx = {
    pdf, page: undefined as any, font, bold,
    width: 595, height: 842, margin: 36,
    y: 0, contentStart: 0, contentEnd: 0,
    branding: { ...(opts.branding || {}), _lh: letterhead, _footer: footer },
    hasLetterhead: !!letterhead,
    appId: opts.applicationId || opts.lead?.application_id,
    sessionName: opts.sessionName,
  };
  newPage(ctx);
  ctx.y -= 14;
  const loanReferenceNo = letterRefNo(opts.offer?.id, opts.applicationId);

  ctx.page.drawText(`Letter Date: ${fmtDate(new Date().toISOString())}`, {
    x: ctx.margin, y: ctx.y - 8, size: 8, font: ctx.font, color: COLORS.muted,
  });
  const refText = `Reference No.: ${loanReferenceNo}`;
  const refTextW = ctx.font.widthOfTextAtSize(refText, 8);
  ctx.page.drawText(refText, {
    x: ctx.width - ctx.margin - refTextW, y: ctx.y - 8, size: 8, font: ctx.font, color: COLORS.muted,
  });
  ctx.y -= 14;

  ctx.page.drawText("EDUCATION LOAN SUPPORT LETTER", {
    x: ctx.margin, y: ctx.y - 12, size: 12, font: ctx.bold, color: COLORS.text,
  });
  ctx.y -= 17;

  drawParagraph(ctx, "To Whom It May Concern,", 8, 2);
  drawParagraph(ctx,
    `This is to certify that ${opts.lead?.name || "the applicant"} has been offered provisional admission to ${opts.course?.name || "the selected programme"} at ${opts.campus?.name || opts.branding?.name || "NIMT Educational Institutions"} for the ${opts.sessionName || "current"} academic session.`,
  );
  drawParagraph(ctx,
    `The applicant has paid at least ${fmtINR(opts.loanLetterUnlockAmount)} as token fee against the admission offer. This letter is issued to support the applicant's education loan application with a bank or financial institution. Please quote Loan Reference Letter No. ${loanReferenceNo} for verification.`,
  );

  drawSection(ctx, "APPLICANT AND PROGRAMME DETAILS");
  drawKVGrid(ctx, [
    { label: "Applicant Name", value: opts.lead?.name || "-" },
    { label: "Application ID", value: opts.applicationId || opts.lead?.application_id || "-" },
    { label: "Loan Reference Letter No.", value: loanReferenceNo },
    { label: "Programme", value: opts.course?.name || "-" },
    { label: "Duration", value: opts.course?.duration_years ? `${opts.course.duration_years} year${opts.course.duration_years > 1 ? "s" : ""}` : "-" },
    { label: "Campus", value: opts.campus?.name || "-" },
    { label: "Academic Session", value: opts.sessionName || "-" },
    { label: "Admission Mode", value: opts.offer?.admission_mode === "entrance"
      ? `Entrance / Counselling${opts.offer?.entrance_exam_name ? ` - ${opts.offer.entrance_exam_name}` : ""}`
      : "Direct Admission" },
  ]);

  ctx.y -= 3;
  drawSection(ctx, "INSTITUTION BANK ACCOUNT DETAILS");
  drawKVGrid(ctx, [
    { label: "Beneficiary Name", value: opts.bankDetails.beneficiary_name },
    { label: "Bank Name", value: opts.bankDetails.bank_name },
    { label: "Account No.", value: opts.bankDetails.account_no },
    { label: "IFSC Code", value: opts.bankDetails.ifsc },
    { label: "Branch", value: opts.bankDetails.branch },
    { label: "UPI ID", value: opts.bankDetails.upi_id },
  ], 3);

  ctx.y -= 3;
  drawParagraph(ctx,
    `Banks may remit the sanctioned education-loan amount directly to the above college account on behalf of ${opts.lead?.name || "the applicant"}.`,
    7,
    2,
  );

  ctx.y -= 1;
  drawSection(ctx, "FEE DETAILS");
  drawFeeTable(ctx, opts.yearItems);
  ctx.y -= 3;
  drawKVGrid(ctx, [
    { label: "First-Year Applicable Fee", value: fmtINR(opts.firstYearFee) },
    { label: "First-Year Amount Due", value: fmtINR(opts.firstYearAmountDue) },
    { label: "Token Fee Required", value: fmtINR(opts.tokenRequired) },
    { label: "Token Fee Paid", value: fmtINR(opts.tokenPaid) },
  ]);

  ctx.y -= 3;
  drawParagraph(ctx,
    "Examination Fee, Uniform Fee and other university / examination-body charges are not included in the above fee structure.",
    7,
    2,
  );

  drawParagraph(ctx,
    "This letter does not constitute a guarantee of loan approval. Final sanction, amount, terms, and disbursement are subject to the lending institution's policies and verification.",
    7,
    5,
  );

  const totalW = ctx.width - ctx.margin * 2;
  const signRowH = 32;
  ensureSpace(ctx, signRowH + 8);
  ctx.page.drawRectangle({
    x: ctx.margin, y: ctx.y - signRowH, width: totalW * 0.55, height: signRowH,
    color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("Principal / Director Signature & Seal", {
    x: ctx.margin + 6, y: ctx.y - 9, size: 6.5, font: ctx.font, color: COLORS.muted,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin + 12, y: ctx.y - 24 },
    end: { x: ctx.margin + totalW * 0.55 - 12, y: ctx.y - 24 },
    thickness: 0.4, color: COLORS.muted,
  });

  ctx.page.drawRectangle({
    x: ctx.margin + totalW * 0.55, y: ctx.y - signRowH, width: totalW * 0.45, height: signRowH,
    color: rgb(1, 1, 1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  ctx.page.drawText("For the Institution", {
    x: ctx.margin + totalW * 0.55 + 6, y: ctx.y - 9, size: 6.5, font: ctx.font, color: COLORS.muted,
  });
  if (signature) {
    ctx.page.drawImage(signature, {
      x: ctx.margin + totalW * 0.55 + 8,
      y: ctx.y - signRowH + 8,
      width: 66, height: 20,
    });
  } else {
    ctx.page.drawLine({
      start: { x: ctx.margin + totalW * 0.55 + 12, y: ctx.y - 22 },
      end: { x: ctx.margin + totalW - 12, y: ctx.y - 22 },
      thickness: 0.4, color: COLORS.muted,
    });
  }
  ctx.page.drawText(opts.branding?.signatory_name || "AUTHORISED SIGNATORY", {
    x: ctx.margin + totalW * 0.55 + 6,
    y: ctx.y - signRowH + 4,
    size: 7, font: ctx.bold, color: COLORS.text,
  });
  ctx.y -= signRowH + 10;

  const footerNoteY = Math.max(28, ctx.contentEnd - 18);
  ctx.page.drawText(`This is a system-generated education loan support letter. Generated: ${fmtDate(new Date().toISOString())}`, {
    x: ctx.margin, y: footerNoteY, size: 7, font: ctx.font, color: COLORS.muted,
  });

  return pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { offer_letter_id, application_id, force } = await req.json();
    if (!offer_letter_id || !application_id) {
      return new Response(JSON.stringify({ error: "offer_letter_id and application_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: offer, error: offerErr } = await admin
      .from("offer_letters")
      .select(`
        id, lead_id, total_fee, scholarship_amount, token_fee_amount, loan_letter_url, approval_status,
        admission_mode, entrance_exam_name,
        course_id, campus_id, session_id, created_at,
        leads:lead_id ( id, name, phone, email, application_id ),
        courses:course_id ( name, duration_years ),
        campuses:campus_id ( name )
      `)
      .eq("id", offer_letter_id)
      .single();

    if (offerErr || !offer) {
      return new Response(JSON.stringify({ error: offerErr?.message || "Offer not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (offer.approval_status !== "approved") {
      return new Response(JSON.stringify({ error: "Offer is not approved yet" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: appRow } = await admin
      .from("applications")
      .select("application_id, lead_id")
      .eq("application_id", application_id)
      .eq("lead_id", offer.lead_id)
      .maybeSingle();

    if (!appRow) {
      return new Response(JSON.stringify({ error: "Application does not match this offer" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: feeStatus, error: feeErr } = await admin.rpc("lead_fee_status" as any, { _lead_id: offer.lead_id });
    if (feeErr || !feeStatus) {
      return new Response(JSON.stringify({ error: feeErr?.message || "Could not verify token fee payment" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenRequired = Number((feeStatus as any).token_required || offer.token_fee_amount || 0);
    const tokenPaid = Number((feeStatus as any).token_paid || 0);
    const paidTowardCourse = Number(
      (feeStatus as any).paid_toward_course
      ?? Math.max(0, Number((feeStatus as any).total_paid || 0) - Number((feeStatus as any).application_paid || 0))
      ?? tokenPaid
    );
    if (tokenPaid < LOAN_LETTER_UNLOCK_TOKEN_FEE) {
      return new Response(JSON.stringify({
        error: `Loan letter unlocks after token fee payment of at least ${fmtINR(LOAN_LETTER_UNLOCK_TOKEN_FEE)}.`,
      }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((offer as any).loan_letter_url && !force) {
      return new Response(JSON.stringify({ ok: true, loan_letter_url: (offer as any).loan_letter_url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sessionName: string | null = null;
    if (offer.session_id) {
      const { data: sess } = await admin.from("admission_sessions").select("name").eq("id", offer.session_id).maybeSingle();
      sessionName = sess?.name || null;
    }

    const { data: yearRows } = await admin
      .from("fee_structures")
      .select("id, fee_structure_items ( term, amount )")
      .eq("course_id", offer.course_id)
      .eq("session_id", offer.session_id)
      .eq("is_active", true)
      .maybeSingle();

    const yearMap = new Map<string, number>();
    for (const it of ((yearRows as any)?.fee_structure_items || []) as { term: string; amount: number }[]) {
      if (!String(it.term || "").startsWith("year_")) continue;
      yearMap.set(it.term, (yearMap.get(it.term) || 0) + Number(it.amount || 0));
    }

    const { data: feePreviewRows } = await admin.rpc("lead_fee_preview" as any, { _lead_id: offer.lead_id });
    const dueDateMap = new Map<string, string>();
    for (const row of ((feePreviewRows || []) as { term: string; due_date: string | null }[])) {
      if (!String(row.term || "").startsWith("year_") || !row.due_date) continue;
      if (!dueDateMap.has(row.term)) dueDateMap.set(row.term, row.due_date);
    }

    const { data: waiverRows } = await admin
      .from("offer_waivers")
      .select("term, amount")
      .eq("offer_letter_id", offer.id)
      .eq("status", "approved");

    const waiverMap = new Map<string, number>();
    for (const w of ((waiverRows || []) as { term: string; amount: number }[])) {
      waiverMap.set(w.term, (waiverMap.get(w.term) || 0) + Number(w.amount || 0));
    }
    if (!waiverMap.has("year_1") && Number(offer.scholarship_amount || 0) > 0) {
      waiverMap.set("year_1", Number(offer.scholarship_amount || 0));
    }

    const yearItems = Array.from(yearMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([term, total]) => {
        const waiver = Math.min(Number(total || 0), waiverMap.get(term) || 0);
        return {
          term,
          total: Number(total || 0),
          waiver,
          applicable: Math.max(0, Number(total || 0) - waiver),
          dueDate: dueDateMap.get(term) || null,
        };
      });

    const firstYearFee = yearItems.find(y => y.term === "year_1")?.applicable
      ?? Number((feeStatus as any).post_scholarship_year_1 || yearMap.get("year_1") || 0);
    const totalCourseFee = yearItems.reduce((s, y) => s + y.applicable, 0) || Number(offer.total_fee || 0);
    const firstYearAmountDue = Math.max(0, Number(firstYearFee || 0) - paidTowardCourse);

    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: offer.lead_id,
      _doc_type: "offer_letter",
    });
    const bankConfigKeys = [
      "loan_letter_bank_beneficiary_name",
      "loan_letter_bank_name",
      "loan_letter_bank_account_no",
      "loan_letter_bank_ifsc",
      "loan_letter_bank_branch",
      "loan_letter_bank_upi_id",
    ];
    const { data: bankRows } = await admin
      .from("_app_config")
      .select("key, value")
      .in("key", bankConfigKeys);
    const bankConfig = Object.fromEntries(((bankRows || []) as { key: string; value: string }[]).map(row => [row.key, row.value]));
    const bankDetails = {
      beneficiary_name: bankConfig.loan_letter_bank_beneficiary_name || DEFAULT_BANK_DETAILS.beneficiary_name,
      bank_name: bankConfig.loan_letter_bank_name || DEFAULT_BANK_DETAILS.bank_name,
      account_no: bankConfig.loan_letter_bank_account_no || DEFAULT_BANK_DETAILS.account_no,
      ifsc: bankConfig.loan_letter_bank_ifsc || DEFAULT_BANK_DETAILS.ifsc,
      branch: bankConfig.loan_letter_bank_branch || DEFAULT_BANK_DETAILS.branch,
      upi_id: bankConfig.loan_letter_bank_upi_id || DEFAULT_BANK_DETAILS.upi_id,
    };

    const pdfBytes = await buildLoanLetterPdf({
      offer,
      lead: (offer as any).leads,
      course: (offer as any).courses,
      campus: (offer as any).campuses,
      applicationId: appRow.application_id,
      bankDetails,
      branding,
      sessionName,
      firstYearFee,
      totalCourseFee,
      tokenRequired,
      tokenPaid,
      firstYearAmountDue,
      loanLetterUnlockAmount: LOAN_LETTER_UNLOCK_TOKEN_FEE,
      yearItems,
    });

    const refSlug = letterRefNo(offer.id, appRow.application_id).replace(/[^A-Za-z0-9]+/g, "-");
    const path = `loan-letters/${offer.lead_id}/${refSlug}-${Date.now()}.pdf`;
    const { error: uploadErr } = await admin.storage
      .from("application-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true, cacheControl: "no-cache, max-age=0" });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pub } = admin.storage.from("application-documents").getPublicUrl(path);
    const loanLetterUrl = pub?.publicUrl || path;
    await admin.from("offer_letters").update({ loan_letter_url: loanLetterUrl }).eq("id", offer.id);

    return new Response(JSON.stringify({ ok: true, loan_letter_url: loanLetterUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-loan-letter] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

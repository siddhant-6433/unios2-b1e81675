// Brand-coloured payment receipt — mirrors the styling used by
// ReceiptDialog.tsx in the applicant portal. Header strip with a
// brand-coloured divider, light-grey "details" card, brand-coloured
// "Amount Paid" band, payment-method + transaction-ref boxes, and a
// system-generated footer. The brand colour is resolved from the
// lead's institution_branding slug (nimt = #0035C5; falls back to the
// NIMT default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAY_TYPE_LABELS: Record<string, string> = {
  application_fee:     "Application Fee",
  token_fee:           "Token / Admission Fee",
  pre_admission_token: "Token Fee (prior to admission)",
  registration_fee:    "Registration Fee",
  other:               "Other Charges",
};

const MODE_LABELS: Record<string, string> = {
  cash:          "Cash",
  upi:           "UPI",
  bank_transfer: "Bank Transfer / NEFT",
  cheque:        "Cheque / DD",
  online:        "Online",
  gateway:       "Online",
};

const GATEWAY_LABELS: Record<string, string> = {
  easebuzz: "Easebuzz",
  icici:    "ICICI",
  cashfree: "Cashfree",
  razorpay: "Razorpay",
  // Manually-recorded payments — admin entered an UTR / cheque ref through
  // the UI rather than going through a gateway. Render as "Marked Offline"
  // so the receipt is unambiguous about the source.
  offline:  "Marked Offline",
  manual:   "Marked Offline",
};

function inferGatewayFromPaymentRef(paymentRef?: string | null) {
  const ref = (paymentRef || "").trim().toLowerCase();
  if (!ref) return null;
  if (ref.startsWith("pay_") || ref.startsWith("order_")) return "razorpay";
  if (ref.startsWith("manual_")) return "manual";
  if (ref.startsWith("cf_") || ref.includes("cashfree")) return "cashfree";
  if (ref.startsWith("icici") || ref.startsWith("ic_") || ref.startsWith("lp-")) return "icici";
  if (ref.startsWith("eb") || ref.includes("easepay")) return "easebuzz";
  return null;
}

function gatewayLabel(gateway?: string | null, paymentMode?: string | null, paymentRef?: string | null) {
  if (gateway) return GATEWAY_LABELS[gateway] || gateway;
  const inferred = inferGatewayFromPaymentRef(paymentRef);
  if (inferred) return GATEWAY_LABELS[inferred] || inferred;
  if (paymentMode === "gateway" || paymentMode === "online") return "Online Gateway";
  if (paymentMode) return GATEWAY_LABELS.manual;
  return "Not Recorded";
}

// Per-portal brand colour (matches portalConfig.ts in the React app).
const BRAND_BY_SLUG: Record<string, string> = {
  nimt:     "#0035C5",
  nimt_grn: "#0035C5",
  nimt_he:  "#0035C5",
  beacon:   "#0044FF",
  mirai:    "#77966D",
};

// Per-portal logo PNG (uploaded to public-assets/branding/). The receipt
// embeds the logo image instead of the brand-coloured initial square.
const LOGO_BY_SLUG: Record<string, string> = {
  nimt:     "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/nimt-logo.png",
  nimt_grn: "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/nimt-logo.png",
  nimt_he:  "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/nimt-logo.png",
  beacon:   "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/beacon-logo.png",
  mirai:    "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/mirai-logo.png",
};

async function fetchLogoPng(pdf: PDFDocument, url: string | null) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await pdf.embedPng(new Uint8Array(await r.arrayBuffer()));
  } catch { return null; }
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0x0035c5;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function lightenForBg(hex: string) {
  // Mix the hex colour with white at ~92% to get the soft background tint
  // shown on the React amount-paid label ("Amount Paid" sub-text).
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0x0035c5;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return rgb(r * 0.6 + 0.4, g * 0.6 + 0.4, b * 0.6 + 0.4);
}

const fmtINR = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateTime = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Kolkata",
  });
};

const fmtDateShort = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

function wrapText(text: string, font: any, size: number, maxWidth: number, maxLines = 6): string[] {
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

function fitText(text: string, font: any, size: number, maxWidth: number): string {
  if (!text) return "—";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

// Symbol-safe rupee marker — Helvetica doesn't ship the ₹ glyph and pdf-lib
// throws on missing glyphs, so use "Rs." in the body and the band.
const RUP = "Rs. ";

const appIdFromNotes = (notes?: unknown): string | null => {
  const match = String(notes || "").match(/APP-\d{2}-[A-Z0-9]+/i);
  return match?.[0]?.toUpperCase() || null;
};

interface Branding {
  slug?: string | null;
  name: string;
  contact_email: string | null;
  website: string | null;
  address: string | null;
}

interface BuildOpts {
  receiptNo: string;
  receiptTitle: string;          // "PAYMENT RECEIPT" / "APPLICATION RECEIPT"
  payerHeading: string;          // "APPLICANT DETAILS" / "STUDENT DETAILS"
  rows: [string, string][];      // payer detail rows
  amount: number;
  paymentMode: string;
  paymentGateway?: string | null;
  paymentRef: string;
  paymentDate: string;
  campusName: string | null;
  institutionName: string | null;   // college/school offering the course (course → dept → institution)
  letterheadAddress: string | null; // address of that institution's campus
  brandHex: string;
  logoUrl: string | null;
  branding: Branding;
}

async function buildPdf(opts: BuildOpts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const brand     = hexToRgb(opts.brandHex);
  const brandSoft = lightenForBg(opts.brandHex);
  const text      = rgb(0.10, 0.11, 0.18);
  const muted     = rgb(0.58, 0.62, 0.69);
  const subtle    = rgb(0.40, 0.45, 0.53);
  const cardBg    = rgb(0.972, 0.980, 0.988);
  const border    = rgb(0.886, 0.910, 0.941);

  const margin = 40;
  let y = height - 50;

  // ── Header — institution logo image, no text title beside it ──────
  // Embed the portal logo PNG; fall back to a brand-coloured initial
  // square if the logo can't be fetched. The image's native aspect is
  // preserved with width capped at 180pt and height capped at 60pt.
  const logoImg = await fetchLogoPng(pdf, opts.logoUrl);
  const logoMaxH = 56;
  const logoMaxW = 200;
  let logoH = logoMaxH;
  let logoW = logoMaxW;
  let textLeftX = margin;
  if (logoImg) {
    const aspect = logoImg.width / logoImg.height;
    logoH = logoMaxH;
    logoW = Math.min(logoMaxW, logoH * aspect);
    if (logoW > logoMaxW) {
      logoW = logoMaxW;
      logoH = logoW / aspect;
    }
    page.drawImage(logoImg, { x: margin, y: y - logoH, width: logoW, height: logoH });
    textLeftX = margin + logoW + 14;
    // Institution (from the course) + its campus address, drawn small next to
    // the logo. Institution name comes from course → dept → institution; falls
    // back to the campus name when the lead has no course.
    const headLine = opts.institutionName || opts.campusName;
    const headAddr = opts.letterheadAddress || opts.branding.address;
    if (headLine) {
      page.drawText(headLine.slice(0, 60), {
        x: textLeftX, y: y - 18, size: 10, font: bold, color: subtle,
      });
    }
    if (headAddr) {
      page.drawText(headAddr.slice(0, 70), {
        x: textLeftX, y: y - 32, size: 8.5, font, color: muted,
      });
    }
  } else {
    // Fallback: brand-coloured initial square.
    const fallbackSize = 40;
    page.drawRectangle({ x: margin, y: y - fallbackSize, width: fallbackSize, height: fallbackSize, color: brand });
    const initial = (opts.branding.name || "N").trim().charAt(0).toUpperCase();
    const initW = bold.widthOfTextAtSize(initial, 22);
    page.drawText(initial, {
      x: margin + (fallbackSize - initW) / 2,
      y: y - fallbackSize + (fallbackSize - 22) / 2 + 4,
      size: 22, font: bold, color: rgb(1, 1, 1),
    });
    page.drawText(opts.branding.name, {
      x: margin + fallbackSize + 12, y: y - 14, size: 13, font: bold, color: text,
    });
    const fbLine = opts.institutionName || opts.campusName;
    if (fbLine) {
      page.drawText(fbLine.slice(0, 60), {
        x: margin + fallbackSize + 12, y: y - 28, size: 10, font, color: subtle,
      });
    }
    logoH = fallbackSize;
  }

  // Right column: receipt title + number + date — all right-aligned so they
  // stack neatly under each other and don't collide with the campus/address
  // text drawn next to the logo on the left side.
  const titleW = bold.widthOfTextAtSize(opts.receiptTitle, 13);
  page.drawText(opts.receiptTitle, {
    x: width - margin - titleW, y: y - 14, size: 13, font: bold, color: brand,
  });
  const rcptText = `Receipt No: ${opts.receiptNo}`;
  const rcptW = font.widthOfTextAtSize(rcptText, 10);
  page.drawText(rcptText, {
    x: width - margin - rcptW, y: y - 32, size: 10, font, color: muted,
  });
  const dateText = `Date: ${fmtDateShort(opts.paymentDate)}`;
  const dateW = font.widthOfTextAtSize(dateText, 10);
  page.drawText(dateText, {
    x: width - margin - dateW, y: y - 48, size: 10, font, color: muted,
  });

  y -= Math.max(64, logoH + 12);
  // Brand-coloured divider line beneath header
  page.drawRectangle({ x: margin, y, width: width - margin * 2, height: 2, color: brand });
  y -= 22;

  // ── Payer details card ─────────────────────────────────────────────
  const cardPad = 14;
  const rowGap = 16;
  const valueX = margin + cardPad + 130;
  const valueMaxW = width - margin - cardPad - valueX;
  // Pre-wrap each value so long notes stay inside the card instead of running off-page.
  const wrappedRows = opts.rows.map(([k, v]) => [k, wrapText(v || "—", bold, 10, valueMaxW)] as [string, string[]]);
  const totalLines = wrappedRows.reduce((n, [, lines]) => n + lines.length, 0);
  const cardH = 22 + totalLines * rowGap + cardPad;
  page.drawRectangle({
    x: margin, y: y - cardH, width: width - margin * 2, height: cardH,
    color: cardBg, borderColor: border, borderWidth: 0.5,
  });
  page.drawText(opts.payerHeading, {
    x: margin + cardPad, y: y - 14, size: 9, font: bold, color: muted,
  });
  let ry = y - 30;
  for (const [k, lines] of wrappedRows) {
    page.drawText(k, { x: margin + cardPad, y: ry, size: 10, font, color: subtle });
    for (const line of lines) {
      page.drawText(line, { x: valueX, y: ry, size: 10, font: bold, color: text });
      ry -= rowGap;
    }
  }
  y -= cardH + 14;

  // ── Amount band (brand-coloured pill) ──────────────────────────────
  const bandH = 50;
  page.drawRectangle({
    x: margin, y: y - bandH, width: width - margin * 2, height: bandH, color: brand,
  });
  page.drawText("Amount Paid", {
    x: margin + cardPad, y: y - bandH + 18, size: 12, font, color: brandSoft,
  });
  const amountText = `${RUP}${fmtINR(opts.amount)}`;
  const amountW = bold.widthOfTextAtSize(amountText, 22);
  page.drawText(amountText, {
    x: width - margin - cardPad - amountW, y: y - bandH + 14, size: 22, font: bold, color: rgb(1, 1, 1),
  });
  y -= bandH + 16;

  // ── Payment-method + gateway + transaction-ref cards ───────────────
  const paymentCards: [string, string][] = [["PAYMENT METHOD", opts.paymentMode.toUpperCase()]];
  if (opts.paymentGateway) paymentCards.push(["PAYMENT GATEWAY", opts.paymentGateway]);
  paymentCards.push(["TRANSACTION REF", opts.paymentRef || "—"]);
  const gap = 12;
  const boxW = (width - margin * 2 - gap * (paymentCards.length - 1)) / paymentCards.length;
  const boxH = 52;
  paymentCards.forEach(([label, value], index) => {
    const x = margin + index * (boxW + gap);
    page.drawRectangle({
      x, y: y - boxH, width: boxW, height: boxH,
      color: rgb(1, 1, 1), borderColor: border, borderWidth: 0.5,
    });
    page.drawText(label, { x: x + 12, y: y - 16, size: 8, font: bold, color: muted });
    page.drawText(fitText(value, bold, 11, boxW - 24), {
      x: x + 12, y: y - 36, size: 11, font: bold, color: text,
    });
  });
  y -= boxH + 26;

  // ── Footer — thin divider + computer-generated line ────────────────
  page.drawRectangle({ x: margin, y, width: width - margin * 2, height: 0.5, color: border });
  y -= 14;
  page.drawText("This is a computer-generated receipt.", {
    x: margin, y, size: 9, font, color: muted,
  });
  page.drawText("Note: All fees paid are strictly non-refundable under any circumstances.", {
    x: margin, y: y - 12, size: 9, font: bold, color: muted,
  });
  const isBoarding = opts.branding.slug === "mirai" || opts.branding.slug === "beacon";
  if (isBoarding) {
    page.drawText("Only Security Deposit amount paid against boarding admissions are refundable.", {
      x: margin, y: y - 23, size: 9, font, color: muted,
    });
  }
  const contactY = y - (isBoarding ? 36 : 24);
  if (opts.branding.contact_email) {
    page.drawText(`For queries: ${opts.branding.contact_email}`, {
      x: margin, y: contactY, size: 9, font, color: muted,
    });
  }
  const siteText = opts.branding.website || "unios.nimt.ac.in";
  const siteW = bold.widthOfTextAtSize(siteText, 9);
  page.drawText(siteText, { x: width - margin - siteW, y, size: 9, font: bold, color: brand });

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const body = await req.json();
    const lead_payment_id = body.lead_payment_id || body.payment_id;
    const requestedApplicationId = body.application_id || null;
    if (!lead_payment_id) {
      return new Response(JSON.stringify({ error: "lead_payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lp, error: lpErr } = await admin
      .from("lead_payments")
      .select(`
        id, receipt_no, type, amount, payment_mode, gateway, transaction_ref,
        payment_date, status, receipt_url, created_at, recorded_by, notes, application_id,
        fee_codes:fee_code_id ( name ),
        leads:lead_id (
          id, name, phone, email, application_id, pre_admission_no, admission_no,
          courses:course_id ( name ),
          campuses:campus_id ( name )
        )
      `)
      .eq("id", lead_payment_id)
      .single();

    if (lpErr || !lp) {
      return new Response(JSON.stringify({ error: lpErr?.message || "Payment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lp.status !== "confirmed") {
      return new Response(JSON.stringify({ error: "Payment is not confirmed yet" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lead: any = lp.leads;
    const isApp = lp.type === "application_fee";
    const resolvedApplicationId =
      isApp
        ? requestedApplicationId || lp.application_id || appIdFromNotes(lp.notes) || lead?.application_id || null
        : null;
    let app: any = null;
    if (resolvedApplicationId && lead?.id) {
      const { data } = await admin
        .from("applications")
        .select("application_id, full_name, phone, email, course_selections")
        .eq("lead_id", lead.id)
        .eq("application_id", resolvedApplicationId)
        .maybeSingle();
      app = data || null;
    }
    const firstChoice = (app?.course_selections || [])[0] || {};
    const courseName = isApp ? firstChoice.course_name ?? lead?.courses?.name ?? null : lead?.courses?.name ?? null;
    const campusName = lead?.campuses?.name ?? null;

    // Institution name (from the lead's course → dept → institution) and the
    // address of that institution's campus. This is what the header prints, so
    // a Greater Noida nursing receipt shows its nursing institute + Greater
    // Noida address, a Kotputli B.Ed shows the Mahila B.Ed College + Kotputli
    // address, etc. Falls back to campus name / branding address when absent.
    const { data: lh } = await admin.rpc("lead_letterhead" as any, { _lead_id: lead?.id });
    const letterhead = Array.isArray(lh) ? lh[0] : lh;
    const institutionName: string | null = letterhead?.institution_name ?? null;
    const letterheadAddress: string | null = letterhead?.address ?? null;

    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: lead?.id, _doc_type: "receipt",
    });
    const brandingResolved: Branding = {
      slug:           branding?.slug ?? null,
      name:           branding?.name || "NIMT Educational Institutions",
      contact_email:  branding?.contact_email || "admissions@nimt.ac.in",
      website:        branding?.website || null,
      address:        branding?.address || null,
    };
    const brandHex = (brandingResolved.slug && BRAND_BY_SLUG[brandingResolved.slug]) || "#0035C5";
    const logoUrl  = (brandingResolved.slug && LOGO_BY_SLUG[brandingResolved.slug]) || LOGO_BY_SLUG.nimt;

    let paymentMode: string;
    let paymentGateway: string | null = null;
    if (lp.payment_mode === "gateway" || lp.payment_mode === "online") {
      paymentMode = "Online";
      paymentGateway = gatewayLabel(lp.gateway, lp.payment_mode, lp.transaction_ref);
    } else {
      paymentMode = MODE_LABELS[lp.payment_mode] || lp.payment_mode || "—";
      paymentGateway = gatewayLabel(lp.gateway, lp.payment_mode, lp.transaction_ref);
    }

    const rows: [string, string][] = [
      ["Name",  app?.full_name || lead?.name || "—"],
      ["Phone", app?.phone || lead?.phone || "—"],
    ];
    if (app?.email || lead?.email) rows.push(["Email", app?.email || lead?.email]);
    if (isApp && resolvedApplicationId) rows.push(["Application ID", resolvedApplicationId]);
    if (!isApp) {
      if (lead?.admission_no) rows.push(["Admission No", lead.admission_no]);
      else if (lead?.pre_admission_no) rows.push(["Pre-Admission No", lead.pre_admission_no]);
      if (courseName) rows.push(["Course", courseName]);
    }
    // An ad-hoc charge collected at the counter names its actual head
    // (Sports, Transfer Certificate…) instead of the generic "Other Charges".
    const feeHeadName = (lp as { fee_codes?: { name?: string } | null }).fee_codes?.name;
    rows.push(["Fee Head", feeHeadName || PAY_TYPE_LABELS[lp.type] || lp.type]);
    rows.push(["Paid On",  fmtDateTime(lp.payment_date || lp.created_at)]);

    // Pre-admission token receipts must carry the adjustable-against-admission
    // wording (owner requirement) so the candidate knows this money is credited
    // toward the eventual admission fee.
    const isPreAdmissionToken = lp.type === "pre_admission_token";
    if (isPreAdmissionToken) {
      rows.push(["Note", "Token fee prior to admission — adjustable against admission fee"]);
    }

    // Counsellor / staff who recorded the offline receipt — gives the candidate
    // and auditors a name to attach to the transaction. We resolve the profile
    // here (not via the SELECT) because lead_payments → profiles isn't a
    // declared FK relationship.
    if (lp.recorded_by) {
      const { data: prof } = await admin
        .from("profiles")
        .select("display_name, email")
        .eq("id", lp.recorded_by)
        .maybeSingle();
      const recorderName = (prof as any)?.display_name || (prof as any)?.email || null;
      if (recorderName) rows.push(["Recorded By", recorderName]);
    }
    // Surface any free-form context the operator packed into notes (e.g.
    // "Bank: HDFC · Cheque #1234") so the receipt is self-explanatory.
    if (lp.notes) rows.push(["Notes", String(lp.notes)]);

    const pdfBytes = await buildPdf({
      receiptNo:     lp.receipt_no || "—",
      receiptTitle:  isApp ? "APPLICATION RECEIPT" : isPreAdmissionToken ? "TOKEN FEE RECEIPT" : "PAYMENT RECEIPT",
      payerHeading:  isApp ? "APPLICANT DETAILS" : "PAYER DETAILS",
      rows,
      amount:        Number(lp.amount),
      paymentMode,
      paymentGateway,
      paymentRef:    lp.transaction_ref || "—",
      paymentDate:   lp.payment_date || lp.created_at,
      campusName,
      institutionName,
      letterheadAddress,
      brandHex,
      logoUrl,
      branding:      brandingResolved,
    });

    const path = `receipts/${lead?.id || "unassigned"}/${lp.receipt_no}.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("[receipt] upload error:", upErr.message);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: urlData } = admin.storage.from("application-documents").getPublicUrl(path);
    const receiptUrl = urlData?.publicUrl || path;

    await admin.from("lead_payments").update({ receipt_url: receiptUrl }).eq("id", lp.id);
    if (isApp && resolvedApplicationId) {
      await admin
        .from("applications")
        .update({ fee_receipt_url: receiptUrl })
        .eq("application_id", resolvedApplicationId)
        .eq("lead_id", lead?.id);
    }

    return new Response(JSON.stringify({
      ok: true, receipt_no: lp.receipt_no, receipt_url: receiptUrl, application_id: resolvedApplicationId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[receipt] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

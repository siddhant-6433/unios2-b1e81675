// Application-fee receipt — same brand-coloured pdf-lib layout as
// generate-payment-receipt: logo header, brand divider, details card,
// amount band, payment-method + txn-ref boxes, system-generated footer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRAND_BY_SLUG: Record<string, string> = {
  nimt:     "#0035C5",
  nimt_grn: "#0035C5",
  nimt_he:  "#0035C5",
  beacon:   "#0044FF",
  mirai:    "#77966D",
};

const LOGO_BY_SLUG: Record<string, string> = {
  nimt:     "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/nimt-logo.png",
  nimt_grn: "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/nimt-logo.png",
  nimt_he:  "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/nimt-logo.png",
  beacon:   "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/beacon-logo.png",
  mirai:    "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/public-assets/branding/mirai-logo.png",
};

const GATEWAY_LABELS: Record<string, string> = {
  easebuzz: "Easebuzz",
  icici:    "ICICI",
  cashfree: "Cashfree",
  razorpay: "Razorpay",
  // Manually-recorded payments where the accountant entered an UTR / cheque
  // ref through the admin UI rather than going through a gateway. Render
  // as "Marked Offline" instead of the raw value.
  offline:  "Marked Offline",
  manual:   "Marked Offline",
};

const MODE_LABELS: Record<string, string> = {
  cash:          "Cash",
  upi:           "UPI",
  bank_transfer: "Bank Transfer / NEFT",
  cheque:        "Cheque / DD",
  online:        "Online",
  gateway:       "Online",
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

const RUP = "Rs. ";

const appIdFromNotes = (notes?: unknown): string | null => {
  const match = String(notes || "").match(/APP-\d{2}-[A-Z0-9]+/i);
  return match?.[0]?.toUpperCase() || null;
};

function fitText(text: string, font: any, size: number, maxWidth: number): string {
  if (!text) return "—";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

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

interface Branding {
  slug?: string | null;
  name: string;
  contact_email: string | null;
  website: string | null;
  address: string | null;
}

interface BuildOpts {
  receiptNo: string;
  receiptTitle: string;
  payerHeading: string;
  rows: [string, string][];
  amount: number;
  paymentMode: string;
  paymentGateway?: string | null;
  paymentRef: string;
  paymentDate: string;
  campusName: string | null;
  brandHex: string;
  logoUrl: string | null;
  branding: Branding;
}

async function buildPdf(opts: BuildOpts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
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
    if (opts.campusName) {
      page.drawText(opts.campusName, {
        x: textLeftX, y: y - 18, size: 10, font: bold, color: subtle,
      });
    }
    if (opts.branding.address) {
      page.drawText(opts.branding.address.slice(0, 70), {
        x: textLeftX, y: y - 32, size: 8.5, font, color: muted,
      });
    }
  } else {
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
    if (opts.campusName) {
      page.drawText(opts.campusName, {
        x: margin + fallbackSize + 12, y: y - 28, size: 10, font, color: subtle,
      });
    }
    logoH = fallbackSize;
  }

  const titleWords = opts.receiptTitle.split(/\s+/);
  const titleLine1 = titleWords.slice(0, -1).join(" ") || titleWords[0];
  const titleLine2 = titleWords.length > 1 ? titleWords[titleWords.length - 1] : null;
  const t1W = bold.widthOfTextAtSize(titleLine1, 13);
  page.drawText(titleLine1, {
    x: width - margin - t1W, y: y - 6, size: 13, font: bold, color: brand,
  });
  if (titleLine2) {
    const t2W = bold.widthOfTextAtSize(titleLine2, 13);
    page.drawText(titleLine2, {
      x: width - margin - t2W, y: y - 22, size: 13, font: bold, color: brand,
    });
  }
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
  page.drawRectangle({ x: margin, y, width: width - margin * 2, height: 2, color: brand });
  y -= 22;

  const cardPad = 14;
  const rowGap = 16;
  const valueX = margin + cardPad + 130;
  const valueMaxW = width - margin - cardPad - valueX;
  // Pre-wrap each value so long values stay inside the card instead of running off-page.
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
  const siteText = opts.branding.website || "uni.nimt.ac.in";
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

    const { application_id } = await req.json();
    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: app, error: appErr } = await admin
      .from("applications")
      .select("*")
      .eq("application_id", application_id)
      .maybeSingle();
    if (appErr || !app) {
      return new Response(JSON.stringify({ error: appErr?.message || "Application not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch lead for contact details
    let lead: any = null;
    if (app.lead_id) {
      const { data: l } = await admin
        .from("leads")
        .select("id, name, phone, email, campuses:campus_id(name)")
        .eq("id", app.lead_id)
        .maybeSingle();
      lead = l || null;
    }

    // Resolve confirmed application-fee payment; fall back to application row data
    let payment: any = null;
    if (app.lead_id) {
      const { data: lp } = await admin
        .from("lead_payments")
        .select("id, receipt_no, amount, payment_mode, gateway, transaction_ref, payment_date, created_at, status, application_id, notes")
        .eq("lead_id", app.lead_id)
        .eq("type", "application_fee")
        .eq("status", "confirmed")
        .eq("application_id", app.application_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      payment = lp || null;
    }
    if (!payment && app.lead_id) {
      const { data: rows } = await admin
        .from("lead_payments")
        .select("id, receipt_no, amount, payment_mode, gateway, transaction_ref, payment_date, created_at, status, application_id, notes")
        .eq("lead_id", app.lead_id)
        .eq("type", "application_fee")
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(10);
      payment = (rows || []).find((row: any) => appIdFromNotes(row.notes) === app.application_id) || null;
    }
    if (!payment && app.lead_id) {
      const { data: rows } = await admin
        .from("lead_payments")
        .select("id, receipt_no, amount, payment_mode, gateway, transaction_ref, payment_date, created_at, status, application_id, notes")
        .eq("lead_id", app.lead_id)
        .eq("type", "application_fee")
        .eq("status", "confirmed")
        .eq("amount", app.fee_amount)
        .is("application_id", null)
        .order("created_at", { ascending: false })
        .limit(2);
      if ((rows || []).length === 1 && !appIdFromNotes(rows[0].notes)) {
        payment = rows[0];
        await admin
          .from("lead_payments")
          .update({ application_id: app.application_id } as any)
          .eq("id", payment.id)
          .is("application_id", null);
      }
    }
    if (!payment && app.payment_status === "paid") {
      payment = {
        id: null,
        receipt_no: null,
        amount: app.fee_amount,
        payment_mode: "gateway",
        gateway: "easebuzz",
        transaction_ref: app.payment_ref,
        payment_date: app.submitted_at || app.updated_at,
        status: "confirmed",
      };
    }

    if (!payment) {
      return new Response(JSON.stringify({ error: "No confirmed application-fee payment found" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: app.lead_id, _doc_type: "receipt",
    });
    const brandingResolved: Branding = {
      slug:          branding?.slug ?? null,
      name:          branding?.name || "NIMT Educational Institutions",
      contact_email: branding?.contact_email || "admissions@nimt.ac.in",
      website:       branding?.website || null,
      address:       branding?.address || null,
    };
    const brandHex = (brandingResolved.slug && BRAND_BY_SLUG[brandingResolved.slug]) || "#0035C5";
    const logoUrl  = (brandingResolved.slug && LOGO_BY_SLUG[brandingResolved.slug]) || LOGO_BY_SLUG.nimt;

    let paymentMode: string;
    let paymentGateway: string | null = null;
    if (payment.payment_mode === "gateway" || payment.payment_mode === "online") {
      paymentMode = "Online";
      paymentGateway = gatewayLabel(payment.gateway, payment.payment_mode, payment.transaction_ref);
    } else {
      paymentMode = MODE_LABELS[payment.payment_mode] || payment.payment_mode || "—";
      paymentGateway = gatewayLabel(payment.gateway, payment.payment_mode, payment.transaction_ref);
    }

    const firstChoice = (app.course_selections || [])[0] || {};
    const courseName = firstChoice.course_name || null;
    const campusName = (lead?.campuses?.name) || firstChoice.campus_name || null;

    const rows: [string, string][] = [
      ["Name",           app.full_name || lead?.name || "—"],
      ["Phone",          lead?.phone || "—"],
    ];
    if (lead?.email) rows.push(["Email", lead.email]);
    rows.push(["Application ID", app.application_id]);
    if (courseName) rows.push(["Course", courseName]);
    rows.push(["Fee Head", "Application Fee"]);
    rows.push(["Paid On",  fmtDateTime(payment.payment_date || payment.created_at || app.submitted_at)]);

    const receiptNo = payment.receipt_no || `APP-${app.application_id}`;

    const pdfBytes = await buildPdf({
      receiptNo,
      receiptTitle:  "APPLICATION RECEIPT",
      payerHeading:  "APPLICANT DETAILS",
      rows,
      amount:        Number(payment.amount || app.fee_amount || 0),
      paymentMode,
      paymentGateway,
      paymentRef:    payment.transaction_ref || "—",
      paymentDate:   payment.payment_date || payment.created_at || app.submitted_at || app.updated_at,
      campusName,
      brandHex,
      logoUrl,
      branding:      brandingResolved,
    });

    const path = `applications/${app.application_id}-fee-receipt.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pub } = admin.storage.from("application-documents").getPublicUrl(path);
    const url = pub?.publicUrl || path;
    await admin.from("applications").update({ fee_receipt_url: url }).eq("id", app.id);

    return new Response(JSON.stringify({ ok: true, fee_receipt_url: url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[application-fee-receipt] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

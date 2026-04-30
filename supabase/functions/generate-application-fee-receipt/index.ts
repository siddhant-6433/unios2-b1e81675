// Application-fee acknowledgement receipt. Mirrors the historical
// NIMT-UG electronic receipt: title strip, identity, acknowledgement
// line referencing the chosen course + campus, payment-details table,
// non-refund clause, system-generated footer. Branded via the
// institution_branding row matching the application's program_category
// (NIMT Higher Ed banner for higher-ed; default for school programs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument, PDFImage, PDFName, PDFArray, PDFString, rgb, StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COLORS = {
  border:    rgb(0.55, 0.55, 0.6),
  light:     rgb(0.85, 0.85, 0.88),
  labelBg:   rgb(0.93, 0.93, 0.96),
  sectionBg: rgb(0.10, 0.13, 0.24),
  sectionFg: rgb(1, 1, 1),
  text:      rgb(0.10, 0.10, 0.15),
  muted:     rgb(0.45, 0.45, 0.5),
};

async function fetchImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const looksPng = (r.headers.get("content-type") || "").includes("png") || url.toLowerCase().endsWith(".png");
    try {
      return looksPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      try { return looksPng ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes); } catch { return null; }
    }
  } catch { return null; }
}

const fmtINR = (n: number) => {
  const v = Number(n || 0);
  return "Rs. " + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtIST = (d?: string | null) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }) + " IST";
};

function wrapText(text: string, font: any, size: number, maxWidth: number, maxLines = 10): string[] {
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
  name: string;
  letterhead_url: string | null;
  footer_url: string | null;
}

async function buildReceiptPdf(opts: {
  applicationId: string;
  applicantName: string;
  courseSelectionLine: string; // e.g. "BSc in Radiology & Imaging Technology (BMRIT), Greater Noida, Uttar Pradesh"
  programCategoryLabel: string; // e.g. "Course After 12th"
  paymentType: string;          // "Online" / "Cash" / etc.
  amount: number;
  paymentDate: string;          // ISO timestamp
  transactionMode: string;      // "Online" / "Cash" / etc.
  transactionId: string;
  branding: Branding;
  isHigherEd: boolean;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Header banner (top, native aspect, full width).
  const lhImg = await fetchImage(pdf, opts.branding.letterhead_url);
  let topReserve = 60;
  if (lhImg) {
    const aspectHW = lhImg.height / lhImg.width;
    if (aspectHW >= 1.2) {
      page.drawImage(lhImg, { x: 0, y: 0, width, height });
      topReserve = 150;
    } else {
      const lhH = width * aspectHW;
      page.drawImage(lhImg, { x: 0, y: height - lhH, width, height: lhH });
      topReserve = lhH + 20;
    }
  } else {
    // Fallback dark band.
    page.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: COLORS.sectionBg });
    page.drawText(opts.branding.name || "NIMT Educational Institutions",
      { x: 50, y: height - 36, size: 14, font: bold, color: COLORS.sectionFg });
  }

  // Footer band (bottom) — only when banner-style letterhead.
  let bottomReserve = 50;
  if (lhImg && lhImg.height / lhImg.width < 1.2 && opts.branding.footer_url) {
    const ftrImg = await fetchImage(pdf, opts.branding.footer_url);
    if (ftrImg) {
      const fAspect = ftrImg.height / ftrImg.width;
      const fH = Math.min(width * fAspect, 130);
      page.drawImage(ftrImg, { x: 0, y: 0, width, height: fH });
      bottomReserve = fH + 16;
    }
  } else if (lhImg && lhImg.height / lhImg.width >= 1.2) {
    bottomReserve = 150;
  }

  const margin = 50;
  let y = height - topReserve;

  // Title strip
  const titleText = "ELECTRONIC RECEIPT";
  const titleW = bold.widthOfTextAtSize(titleText, 16);
  page.drawText(titleText, { x: (width - titleW) / 2, y: y - 16, size: 16, font: bold, color: COLORS.text });
  y -= 32;

  // Identity strip — boxed
  const idH = 44;
  page.drawRectangle({
    x: margin, y: y - idH, width: width - margin*2, height: idH,
    color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5,
  });
  page.drawText("Application Number", { x: margin + 12, y: y - 13, size: 8, font, color: COLORS.muted });
  page.drawText(opts.applicationId, { x: margin + 12, y: y - 26, size: 12, font: bold, color: COLORS.text });
  page.drawText("Applicant Name", { x: margin + (width - margin*2) / 2 + 12, y: y - 13, size: 8, font, color: COLORS.muted });
  page.drawText(opts.applicantName.toUpperCase(), { x: margin + (width - margin*2) / 2 + 12, y: y - 26, size: 12, font: bold, color: COLORS.text });
  y -= idH + 16;

  // Acknowledgement paragraph
  const ackPrefix = `Online form submitted. Payment successfully received towards Application Fee for the `;
  const ackHighlight = `${opts.programCategoryLabel}; `;
  const ackTail = opts.courseSelectionLine;
  const fullAck = ackPrefix + ackHighlight + ackTail;
  const ackLines = wrapText(fullAck, font, 11, width - margin*2);
  ackLines.forEach((line, i) => {
    page.drawText(line, { x: margin, y: y - 12 - i * 14, size: 11, font, color: COLORS.text });
  });
  y -= ackLines.length * 14 + 12;

  // Payment-details table — 2 cols, 5 rows
  const rowH = 22;
  const labelW = (width - margin*2) * 0.32;
  const valueW = (width - margin*2) * 0.68;
  const rows: [string, string][] = [
    ["Payment Type",     opts.paymentType],
    ["Payment Amount",   fmtINR(opts.amount)],
    ["Payment Date",     fmtIST(opts.paymentDate)],
    ["Transaction Mode", opts.transactionMode],
    ["Transaction ID",   opts.transactionId || "-"],
  ];
  rows.forEach(([k, v]) => {
    page.drawRectangle({ x: margin, y: y - rowH, width: labelW, height: rowH, color: COLORS.labelBg, borderColor: COLORS.border, borderWidth: 0.5 });
    page.drawText(k, { x: margin + 10, y: y - 14, size: 10, font, color: COLORS.text });
    page.drawRectangle({ x: margin + labelW, y: y - rowH, width: valueW, height: rowH, color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5 });
    page.drawText(String(v), { x: margin + labelW + 10, y: y - 14, size: 10, font: bold, color: COLORS.text });
    y -= rowH;
  });
  y -= 14;

  // Declaration
  const decl =
    "I declare that I am aware that the fee paid towards the application fee, token fee, tuition fee, " +
    "hostel fee or any other fee to the institution is non-refundable. The institution in any case will " +
    "not issue any refund and that I will not be liable to claim the refund of the deposited fee.";
  const declLines = wrapText(decl, font, 9, width - margin*2);
  page.drawRectangle({
    x: margin, y: y - (declLines.length * 12 + 12), width: width - margin*2, height: declLines.length * 12 + 12,
    color: rgb(1,1,1), borderColor: COLORS.border, borderWidth: 0.5,
  });
  declLines.forEach((line, i) => {
    page.drawText(line, { x: margin + 8, y: y - 12 - i * 12, size: 9, font, color: COLORS.text });
  });
  y -= declLines.length * 12 + 18;

  // System-generated footer line
  const sysText = "This is a system generated receipt and does not require a signature.";
  const sysW = font.widthOfTextAtSize(sysText, 9);
  page.drawText(sysText, { x: (width - sysW) / 2, y: y - 10, size: 9, font, color: COLORS.muted });

  return await pdf.save();
}

const PROGRAM_LABELS: Record<string, string> = {
  school:        "School Admission",
  undergraduate: "Course After 12th",
  postgraduate:  "Course After Graduation",
  mba_pgdm:      "MBA / PGDM Program",
  professional:  "Professional Course",
  bed:           "B.Ed Program",
  deled:         "D.El.Ed Program",
};

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

    // Resolve the application-fee payment.
    let payment: any = null;
    if (app.lead_id) {
      const { data: lp } = await admin
        .from("lead_payments")
        .select("amount, payment_mode, gateway, transaction_ref, payment_date, created_at, status")
        .eq("lead_id", app.lead_id)
        .eq("type", "application_fee")
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      payment = lp || null;
    }
    if (!payment && app.payment_status === "paid") {
      payment = {
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
      _lead_id: app.lead_id, _doc_type: "application_form",
    });

    const programCategory = app.program_category || "undergraduate";
    const isHigherEd = !["school"].includes(programCategory);

    // Build the course-selection line for the acknowledgement.
    const firstChoice = (app.course_selections || [])[0] || {};
    const parts = [firstChoice.course_name, firstChoice.campus_name].filter(Boolean);
    const courseLine = parts.join(", ") || "-";

    const gatewayLabel: Record<string, string> = {
      easebuzz: "Easebuzz Gateway",
      icici:    "ICICI Gateway",
      cashfree: "Cashfree Gateway",
    };
    const modeLabel: Record<string, string> = {
      cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer / NEFT",
      cheque: "Cheque / DD", online: "Online",
    };
    let paymentTypeLabel: string;
    if (payment.payment_mode === "gateway" || payment.payment_mode === "online") {
      const gw = payment.gateway ? (gatewayLabel[payment.gateway] || payment.gateway) : null;
      paymentTypeLabel = gw ? `Online (${gw})` : "Online";
    } else {
      paymentTypeLabel = modeLabel[payment.payment_mode] || payment.payment_mode || "-";
    }

    const out = await buildReceiptPdf({
      applicationId:        app.application_id,
      applicantName:        app.full_name || "Applicant",
      courseSelectionLine:  courseLine,
      programCategoryLabel: PROGRAM_LABELS[programCategory] || "Application",
      paymentType:          paymentTypeLabel,
      amount:               Number(payment.amount || app.fee_amount || 0),
      paymentDate:          payment.payment_date || payment.created_at || app.submitted_at || app.updated_at,
      transactionMode:      payment.payment_mode === "gateway" ? "Online" : (modeLabel[payment.payment_mode] || payment.payment_mode || "-"),
      transactionId:        payment.transaction_ref || "-",
      branding:             branding || { name: "NIMT Educational Institutions", letterhead_url: null, footer_url: null },
      isHigherEd,
    });

    const path = `applications/${app.application_id}-fee-receipt.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, out, { contentType: "application/pdf", upsert: true });
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

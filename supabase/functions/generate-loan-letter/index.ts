import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, PDFFont, PDFPage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fmtINR = (n: number) =>
  "Rs. " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

const BANK_REMITTANCE_DETAILS = [
  ["Beneficiary Name", "NIMT B. SCHOOL'S FOUNDATION"],
  ["Account Type", "Current Account"],
  ["Bank Name", "IDFC BANK"],
  ["Account No.", "10118454426"],
  ["IFSC", "IDFB0020154"],
];

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

type LoanLetterOpts = {
  offer: any;
  lead: any;
  course: { name?: string | null; duration_years?: number | null } | null;
  campus: any;
  applicationId: string | null;
  branding: any;
  sessionName: string | null;
  firstYearFee: number;
  totalCourseFee: number;
  tokenRequired: number;
  tokenPaid: number;
  yearItems: { term: string; total: number; waiver: number; applicable: number }[];
};

async function buildLoanLetterPdf(opts: LoanLetterOpts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 54;
  let y = height - 72;

  const letterhead = await fetchImage(pdf, opts.branding?.letterhead_url ?? null);
  const footer = await fetchImage(pdf, opts.branding?.footer_url ?? null);
  const signature = await fetchImage(pdf, opts.branding?.signature_url ?? null);

  if (letterhead) {
    const aspect = letterhead.height / letterhead.width;
    const h = Math.min(width * aspect, 135);
    page.drawImage(letterhead, { x: 0, y: height - h, width, height: h });
    y = height - h - 36;
  } else {
    page.drawRectangle({ x: 0, y: height - 68, width, height: 68, color: rgb(0.08, 0.10, 0.18) });
    page.drawText(opts.branding?.name || "NIMT Educational Institutions", {
      x: margin, y: height - 35, size: 15, font: bold, color: rgb(1, 1, 1),
    });
    if (opts.branding?.address) {
      page.drawText(opts.branding.address, {
        x: margin, y: height - 52, size: 8, font, color: rgb(0.86, 0.88, 0.94),
      });
    }
  }

  if (footer) {
    const aspect = footer.height / footer.width;
    const h = Math.min(width * aspect, 90);
    page.drawImage(footer, { x: 0, y: 0, width, height: h });
  }

  const drawFooter = () => {
    if (!footer) return;
    const aspect = footer.height / footer.width;
    const h = Math.min(width * aspect, 90);
    page.drawImage(footer, { x: 0, y: 0, width, height: h });
  };

  const newPage = () => {
    page = pdf.addPage([595, 842]);
    drawFooter();
    y = height - 72;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 110) newPage();
  };

  const drawParagraph = (text: string, size = 10.5, gap = 8) => {
    const lines = wrapText(text, font, size, width - margin * 2);
    ensureSpace(lines.length * (size + 5) + gap);
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.12, 0.12, 0.16) });
      y -= size + 5;
    }
    y -= gap;
  };

  const row = (label: string, value: string, rowY = y, left = margin, w = width - margin * 2) => {
    const valueX = left + w * 0.42;
    const valueW = w - (valueX - left) - 8;
    const valueLines = wrapText(value || "-", bold, 9, valueW);
    const rowH = Math.max(25, 13 + valueLines.length * 11);
    ensureSpace(rowH);
    rowY = y;
    page.drawRectangle({
      x: left, y: rowY - rowH, width: w, height: rowH,
      borderColor: rgb(0.72, 0.72, 0.78), borderWidth: 0.5,
      color: rgb(1, 1, 1),
    });
    page.drawText(label, { x: left + 8, y: rowY - 16, size: 8, font, color: rgb(0.42, 0.42, 0.48) });
    valueLines.forEach((line, i) => {
      page.drawText(line || "-", { x: valueX, y: rowY - 16 - (i * 11), size: 9, font: bold, color: rgb(0.10, 0.10, 0.14) });
    });
    return rowH;
  };

  const fullRow = (label: string, value: string) => {
    const w = width - margin * 2;
    const valueLines = wrapText(value || "-", bold, 9, w - 16);
    const rowH = Math.max(36, 24 + valueLines.length * 11);
    ensureSpace(rowH);
    const rowY = y;
    page.drawRectangle({
      x: margin, y: rowY - rowH, width: w, height: rowH,
      borderColor: rgb(0.72, 0.72, 0.78), borderWidth: 0.5,
      color: rgb(1, 1, 1),
    });
    page.drawText(label, { x: margin + 8, y: rowY - 14, size: 8, font, color: rgb(0.42, 0.42, 0.48) });
    valueLines.forEach((line, i) => {
      page.drawText(line || "-", { x: margin + 8, y: rowY - 29 - (i * 11), size: 9, font: bold, color: rgb(0.10, 0.10, 0.14) });
    });
    return rowH;
  };

  const termLabel = (term: string) => term
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  const feeTable = () => {
    const tableW = width - margin * 2;
    const colW = [tableW * 0.30, tableW * 0.24, tableW * 0.22, tableW * 0.24];
    const colX = [margin, margin + colW[0], margin + colW[0] + colW[1], margin + colW[0] + colW[1] + colW[2]];
    const headers = ["Year", "Published Fee", "Waiver", "Applicable Fee"];
    const rowH = 24;
    const drawCells = (values: string[], rowY: number, header = false) => {
      ensureSpace(rowH);
      rowY = y;
      values.forEach((value, i) => {
        page.drawRectangle({
          x: colX[i], y: rowY - rowH, width: colW[i], height: rowH,
          color: header ? rgb(0.94, 0.95, 0.98) : rgb(1, 1, 1),
          borderColor: rgb(0.72, 0.72, 0.78),
          borderWidth: 0.5,
        });
        const f = header || i === 3 ? bold : font;
        const size = header ? 8 : 8.5;
        const textWidth = f.widthOfTextAtSize(value, size);
        const x = i === 0 ? colX[i] + 8 : colX[i] + colW[i] - textWidth - 8;
        page.drawText(value, { x, y: rowY - 15, size, font: f, color: rgb(0.10, 0.10, 0.14) });
      });
    };

    drawCells(headers, y, true);
    y -= rowH;
    let totalPublished = 0;
    let totalWaiver = 0;
    let totalApplicable = 0;
    for (const item of opts.yearItems) {
      totalPublished += item.total;
      totalWaiver += item.waiver;
      totalApplicable += item.applicable;
      drawCells([
        termLabel(item.term),
        fmtINR(item.total),
        item.waiver > 0 ? "- " + fmtINR(item.waiver) : "-",
        fmtINR(item.applicable),
      ], y);
      y -= rowH;
    }
    drawCells([
      "Total",
      fmtINR(totalPublished),
      totalWaiver > 0 ? "- " + fmtINR(totalWaiver) : "-",
      fmtINR(totalApplicable),
    ], y, true);
    y -= rowH;
  };

  const bankTable = () => {
    const tableW = width - margin * 2;
    const labelW = tableW * 0.34;
    const valueW = tableW - labelW;
    const drawBankRow = (label: string, value: string, header = false) => {
      const valueLines = wrapText(value || "-", header ? bold : font, header ? 8 : 9, valueW - 16);
      const rowH = Math.max(24, 13 + valueLines.length * 11);
      ensureSpace(rowH);
      const rowY = y;
      page.drawRectangle({
        x: margin, y: rowY - rowH, width: labelW, height: rowH,
        color: header ? rgb(0.94, 0.95, 0.98) : rgb(1, 1, 1),
        borderColor: rgb(0.72, 0.72, 0.78),
        borderWidth: 0.5,
      });
      page.drawRectangle({
        x: margin + labelW, y: rowY - rowH, width: valueW, height: rowH,
        color: header ? rgb(0.94, 0.95, 0.98) : rgb(1, 1, 1),
        borderColor: rgb(0.72, 0.72, 0.78),
        borderWidth: 0.5,
      });
      page.drawText(label, {
        x: margin + 8, y: rowY - 15, size: header ? 8 : 8.5,
        font: header ? bold : font, color: rgb(0.10, 0.10, 0.14),
      });
      valueLines.forEach((line, i) => {
        page.drawText(line || "-", {
          x: margin + labelW + 8, y: rowY - 15 - (i * 11), size: header ? 8 : 9,
          font: header ? bold : font, color: rgb(0.10, 0.10, 0.14),
        });
      });
      y -= rowH;
    };

    drawBankRow("Detail", "Value", true);
    for (const [label, value] of BANK_REMITTANCE_DETAILS) {
      drawBankRow(label, value);
    }
  };

  page.drawText("EDUCATION LOAN SUPPORT LETTER", {
    x: margin, y, size: 15, font: bold, color: rgb(0.07, 0.09, 0.18),
  });
  page.drawText(`Letter Date: ${fmtDate(new Date().toISOString())}`, {
    x: width - margin - 180, y: y + 4, size: 8.5, font, color: rgb(0.42, 0.42, 0.48),
  });
  page.drawText(`Reference No.: ${letterRefNo(opts.offer?.id, opts.applicationId)}`, {
    x: width - margin - 180, y: y - 8, size: 8.5, font, color: rgb(0.42, 0.42, 0.48),
  });
  y -= 34;

  drawParagraph("To Whom It May Concern,", 10.5, 10);
  drawParagraph(
    `This is to certify that ${opts.lead?.name || "the applicant"} has been offered provisional admission to ${opts.course?.name || "the selected programme"} at ${opts.campus?.name || opts.branding?.name || "NIMT Educational Institutions"} for the ${opts.sessionName || "current"} academic session.`,
  );
  drawParagraph(
    `The applicant has paid the required token fee of ${fmtINR(opts.tokenPaid)} against the admission offer. This letter is issued to support the applicant's education loan application with a bank or financial institution.`,
  );

  page.drawRectangle({ x: margin, y: y - 20, width: width - margin * 2, height: 20, color: rgb(0.08, 0.10, 0.18) });
  page.drawText("APPLICANT AND PROGRAMME DETAILS", { x: margin + 8, y: y - 14, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  y -= 22;

  y -= fullRow("Letter Reference", letterRefNo(opts.offer?.id, opts.applicationId));
  const rows = [
    ["Applicant Name", opts.lead?.name || "-"],
    ["Application ID", opts.applicationId || opts.lead?.application_id || "-"],
    ["Programme", opts.course?.name || "-"],
    ["Course Duration", opts.course?.duration_years ? `${opts.course.duration_years} year${opts.course.duration_years > 1 ? "s" : ""}` : "-"],
    ["Campus", opts.campus?.name || "-"],
    ["Academic Session", opts.sessionName || "-"],
    ["Admission Route", opts.offer?.admission_mode === "entrance"
      ? `Entrance / Counselling${opts.offer?.entrance_exam_name ? ` - ${opts.offer.entrance_exam_name}` : ""}`
      : "Direct Admission"],
  ];
  for (const [label, value] of rows) {
    y -= row(label, value, y);
  }

  y -= 14;
  ensureSpace(42);
  page.drawRectangle({ x: margin, y: y - 20, width: width - margin * 2, height: 20, color: rgb(0.08, 0.10, 0.18) });
  page.drawText("FEE DETAILS", { x: margin + 8, y: y - 14, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  y -= 22;

  feeTable();
  y -= 10;
  y -= row("First-Year Applicable Fee", fmtINR(opts.firstYearFee), y);
  y -= row("Total Programme Applicable Fee", fmtINR(opts.totalCourseFee || opts.offer?.total_fee || 0), y);
  y -= row("Token Fee Required", fmtINR(opts.tokenRequired), y);
  y -= row("Token Fee Paid", fmtINR(opts.tokenPaid), y);

  y -= 8;
  ensureSpace(205);
  page.drawRectangle({ x: margin, y: y - 20, width: width - margin * 2, height: 20, color: rgb(0.08, 0.10, 0.18) });
  page.drawText("BANK REMITTANCE DETAILS", { x: margin + 8, y: y - 14, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  y -= 22;
  bankTable();
  y -= 8;
  drawParagraph(
    `Banks may remit the sanctioned education-loan amount directly to the above college account on behalf of ${opts.lead?.name || "the applicant"}.`,
    9.5,
    10,
  );

  drawParagraph(
    "Examination Fee, Uniform Fee and other university / examination-body charges are not included in the above fee structure.",
    9.5,
    10,
  );

  y -= 18;
  drawParagraph(
    "This letter does not constitute a guarantee of loan approval. The final loan sanction, amount, terms, and disbursement remain subject to the policies and verification process of the lending institution.",
    9.5,
    20,
  );

  ensureSpace(76);
  const signX = width - margin - 180;
  if (signature) {
    page.drawImage(signature, { x: signX, y: y - 28, width: 92, height: 32 });
  } else {
    page.drawLine({
      start: { x: signX, y: y - 28 },
      end: { x: width - margin, y: y - 28 },
      thickness: 0.5,
      color: rgb(0.48, 0.48, 0.52),
    });
  }
  page.drawText(opts.branding?.signatory_name || "Authorised Signatory", {
    x: signX, y: y - 48, size: 10, font: bold, color: rgb(0.10, 0.10, 0.14),
  });
  page.drawText(opts.branding?.signatory_designation || "Admissions Office", {
    x: signX, y: y - 62, size: 8.5, font, color: rgb(0.42, 0.42, 0.48),
  });

  return pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { offer_letter_id, application_id } = await req.json();
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
    if (!((feeStatus as any).token_complete) || tokenPaid < tokenRequired) {
      return new Response(JSON.stringify({
        error: `Loan letter unlocks after token fee payment of ${fmtINR(tokenRequired)}.`,
      }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        };
      });

    const firstYearFee = yearItems.find(y => y.term === "year_1")?.applicable
      ?? Number((feeStatus as any).post_scholarship_year_1 || yearMap.get("year_1") || 0);
    const totalCourseFee = yearItems.reduce((s, y) => s + y.applicable, 0) || Number(offer.total_fee || 0);

    const { data: branding } = await admin.rpc("lead_branding" as any, {
      _lead_id: offer.lead_id,
      _doc_type: "bona_fide",
    });

    const pdfBytes = await buildLoanLetterPdf({
      offer,
      lead: (offer as any).leads,
      course: (offer as any).courses,
      campus: (offer as any).campuses,
      applicationId: appRow.application_id,
      branding,
      sessionName,
      firstYearFee,
      totalCourseFee,
      tokenRequired,
      tokenPaid,
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

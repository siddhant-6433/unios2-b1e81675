import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtINR(n: number): string {
  return "Rs. " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("png") || url.toLowerCase().endsWith(".png")) {
      return await pdf.embedPng(bytes);
    }
    return await pdf.embedJpg(bytes);
  } catch (e) {
    console.error("[offer-letter] image fetch failed:", url, (e as Error).message);
    return null;
  }
}

async function buildOfferPdf(opts: {
  offer: { net_fee: number; total_fee: number; scholarship_amount: number | null; acceptance_deadline: string | null; created_at: string };
  lead: { name: string; phone: string | null; email: string | null; application_id: string | null; pre_admission_no: string | null };
  course: { name: string; duration?: number | null } | null;
  campus: { name: string; address?: string | null } | null;
  yearItems: { term: string; total: number }[];
  branding: any;
  totalCourseFee: number;
  tokenAmount: number;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Letterhead background — covers entire page if supplied, else fall back
  // to a coloured header band so the doc still looks branded.
  const lh = await fetchImage(pdf, opts.branding?.letterhead_url ?? null);
  if (lh) {
    page.drawImage(lh, { x: 0, y: 0, width, height });
  } else {
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.07, 0.09, 0.18) });
    page.drawText(opts.branding?.name || "NIMT Educational Institutions",
      { x: 50, y: height - 40, size: 18, font: bold, color: rgb(1,1,1) });
    page.drawText(opts.branding?.address || "", { x: 50, y: height - 60, size: 9, font, color: rgb(0.85,0.88,0.95) });
    page.drawRectangle({ x: 0, y: 0, width, height: 30, color: rgb(0.07, 0.09, 0.18) });
  }

  // Body region. Numbers are tuned to leave the top ~120pt and bottom ~80pt
  // of the page free so most letterheads (which carry header + footer
  // already) are not overlapped.
  const margin = 60;
  let y = height - 150;

  // Title
  page.drawText("OFFER OF ADMISSION", { x: margin, y, size: 16, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 22;

  page.drawText(`Date: ${new Date(opts.offer.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
    { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
  if (opts.lead.application_id) {
    page.drawText(`Application ID: ${opts.lead.application_id}`,
      { x: width - margin - 200, y, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
  }
  y -= 24;

  // Salutation
  page.drawText(`Dear ${opts.lead.name},`, { x: margin, y, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 22;

  const intro = `Congratulations! We are pleased to offer you provisional admission to`;
  page.drawText(intro, { x: margin, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
  y -= 16;

  if (opts.course?.name) {
    page.drawText(opts.course.name, { x: margin, y, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
    y -= 16;
  }
  if (opts.campus?.name) {
    page.drawText(`Campus: ${opts.campus.name}`, { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
    y -= 18;
  }

  // Fee table
  y -= 6;
  page.drawText("Fee Summary", { x: margin, y, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.85,0.85,0.85) });
  y -= 16;

  const drawRow = (label: string, value: string, opts2: { bold?: boolean } = {}) => {
    page.drawText(label, { x: margin, y, size: 11, font: opts2.bold ? bold : font, color: rgb(0.2,0.2,0.2) });
    page.drawText(value, { x: width - margin - 130, y, size: 11, font: opts2.bold ? bold : font, color: rgb(0.2,0.2,0.2) });
    y -= 16;
  };

  for (const item of opts.yearItems) {
    drawRow(item.term.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), fmtINR(item.total));
  }
  y -= 4;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.85,0.85,0.85) });
  y -= 14;
  drawRow("Total Course Fee", fmtINR(opts.totalCourseFee), { bold: true });
  if ((opts.offer.scholarship_amount || 0) > 0) {
    drawRow("Scholarship Applied", `- ${fmtINR(opts.offer.scholarship_amount || 0)}`);
    drawRow("Net Offer Fee", fmtINR(opts.offer.net_fee), { bold: true });
  }
  y -= 4;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.85,0.85,0.85) });
  y -= 18;

  drawRow("Token Fee Required (10% of First Year)", fmtINR(opts.tokenAmount), { bold: true });

  if (opts.offer.acceptance_deadline) {
    y -= 8;
    page.drawText(`Please confirm by paying token fee on or before ${new Date(opts.offer.acceptance_deadline).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`,
      { x: margin, y, size: 11, font, color: rgb(0.4,0.1,0.1) });
    y -= 16;
  }

  y -= 12;
  page.drawText("Pay online: https://uni.nimt.ac.in", { x: margin, y, size: 10, font, color: rgb(0.07,0.4,0.7) });
  y -= 26;

  page.drawText("This is a system-generated offer letter and remains valid till the date noted above.",
    { x: margin, y, size: 9, font, color: rgb(0.5,0.5,0.5) });
  y -= 14;

  // Signature block
  const sig = await fetchImage(pdf, opts.branding?.signature_url ?? null);
  if (sig) {
    const sigW = 120, sigH = 50;
    page.drawImage(sig, { x: width - margin - sigW - 10, y: y - sigH - 4, width: sigW, height: sigH });
  }
  page.drawLine({ start: { x: width - margin - 140, y: y - 60 }, end: { x: width - margin - 10, y: y - 60 }, thickness: 0.5, color: rgb(0.5,0.5,0.5) });
  page.drawText(opts.branding?.signatory_name || "Authorised Signatory",
    { x: width - margin - 140, y: y - 74, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText(opts.branding?.signatory_designation || "Admissions",
    { x: width - margin - 140, y: y - 86, size: 9, font, color: rgb(0.4,0.4,0.4) });

  return await pdf.save();
}

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
        courses:course_id ( name, duration ),
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

    // Branding (campus → branding_slug → row, fallback to default).
    const { data: branding } = await admin.rpc("lead_branding" as any, { _lead_id: offer.lead_id });

    const pdfBytes = await buildOfferPdf({
      offer,
      lead,
      course,
      campus,
      yearItems,
      branding,
      totalCourseFee,
      tokenAmount: Number(lead?.token_amount || 0),
    });

    const path = `offer-letters/${offer.lead_id}/${offer.id}.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
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

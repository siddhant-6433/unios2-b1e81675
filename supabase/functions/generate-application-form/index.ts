import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const fmtINR = (n?: number | null) => n == null ? "—" : "Rs. " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface PdfCtx {
  pdf: PDFDocument;
  page: any;
  font: any;
  bold: any;
  width: number;
  height: number;
  margin: number;
  y: number;
  branding: any;
  hasLetterhead: boolean;
}

function newPage(ctx: PdfCtx) {
  ctx.page = ctx.pdf.addPage([595, 842]);
  if (ctx.hasLetterhead && ctx.branding?._lh) {
    ctx.page.drawImage(ctx.branding._lh, { x: 0, y: 0, width: ctx.width, height: ctx.height });
  } else {
    ctx.page.drawRectangle({ x: 0, y: ctx.height - 60, width: ctx.width, height: 60, color: rgb(0.07, 0.09, 0.18) });
    ctx.page.drawText(ctx.branding?.name || "NIMT Educational Institutions",
      { x: ctx.margin, y: ctx.height - 36, size: 14, font: ctx.bold, color: rgb(1,1,1) });
  }
  ctx.y = ctx.height - (ctx.hasLetterhead ? 140 : 110);
}

function ensureSpace(ctx: PdfCtx, need: number) {
  if (ctx.y - need < 90) newPage(ctx);
}

function drawSectionTitle(ctx: PdfCtx, title: string) {
  ensureSpace(ctx, 30);
  ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - 4, width: ctx.width - ctx.margin*2, height: 22, color: rgb(0.93, 0.95, 1) });
  ctx.page.drawText(title, { x: ctx.margin + 10, y: ctx.y + 4, size: 11, font: ctx.bold, color: rgb(0.07, 0.09, 0.18) });
  ctx.y -= 30;
}

function drawKV(ctx: PdfCtx, k: string, v: string) {
  if (!v || v === "—") return;
  ensureSpace(ctx, 16);
  ctx.page.drawText(k + ":", { x: ctx.margin, y: ctx.y, size: 9, font: ctx.font, color: rgb(0.45,0.45,0.45) });
  ctx.page.drawText(v, { x: ctx.margin + 130, y: ctx.y, size: 10, font: ctx.bold, color: rgb(0.1, 0.1, 0.1) });
  ctx.y -= 14;
}

function drawTwoCol(ctx: PdfCtx, k1: string, v1: string, k2: string, v2: string) {
  const colW = (ctx.width - ctx.margin*2) / 2;
  ensureSpace(ctx, 16);
  if (v1 && v1 !== "—") {
    ctx.page.drawText(k1 + ":", { x: ctx.margin, y: ctx.y, size: 9, font: ctx.font, color: rgb(0.45,0.45,0.45) });
    ctx.page.drawText(v1, { x: ctx.margin + 100, y: ctx.y, size: 10, font: ctx.bold, color: rgb(0.1,0.1,0.1) });
  }
  if (v2 && v2 !== "—") {
    ctx.page.drawText(k2 + ":", { x: ctx.margin + colW, y: ctx.y, size: 9, font: ctx.font, color: rgb(0.45,0.45,0.45) });
    ctx.page.drawText(v2, { x: ctx.margin + colW + 100, y: ctx.y, size: 10, font: ctx.bold, color: rgb(0.1,0.1,0.1) });
  }
  ctx.y -= 14;
}

function fmtAddress(addr: any): string {
  if (!addr || typeof addr !== "object") return "—";
  return [addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country]
    .filter(Boolean).join(", ") || "—";
}

function fmtPerson(p: any): string {
  if (!p || typeof p !== "object") return "—";
  return [p.name, p.occupation, p.phone, p.email].filter(Boolean).join(" · ") || "—";
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

    // Pull application by application_id (text) — that's the friendly id used in URLs.
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

    const { data: branding } = await admin.rpc("lead_branding" as any, { _lead_id: app.lead_id, _doc_type: "application_form" });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const lhImg = await fetchImage(pdf, branding?.letterhead_url ?? null);

    const ctx: PdfCtx = {
      pdf, page: null, font, bold,
      width: 595, height: 842, margin: 50, y: 0,
      branding: { ...(branding || {}), _lh: lhImg },
      hasLetterhead: !!lhImg,
    };
    newPage(ctx);

    // Header strip — title + application id + status pill
    ctx.page.drawText("APPLICATION FORM", { x: ctx.margin, y: ctx.y, size: 16, font: bold, color: rgb(0.07,0.09,0.18) });
    ctx.page.drawText(`App ID: ${app.application_id}`, { x: ctx.width - ctx.margin - 200, y: ctx.y, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
    ctx.y -= 16;
    const submittedLabel = app.submitted_at ? `Submitted ${fmtDate(app.submitted_at)}` : `Status: ${app.status || "draft"}`;
    ctx.page.drawText(submittedLabel, { x: ctx.margin, y: ctx.y, size: 9, font, color: rgb(0.45,0.45,0.45) });
    ctx.page.drawText(`Payment: ${app.payment_status || "pending"}${app.fee_amount ? " · " + fmtINR(Number(app.fee_amount)) : ""}`, {
      x: ctx.width - ctx.margin - 240, y: ctx.y, size: 9, font, color: rgb(0.45,0.45,0.45),
    });
    ctx.y -= 22;

    // Passport photo (top-right). Convention: <application_id>/passport_photo.png in application-documents.
    try {
      const photoPath = `${app.application_id}/passport_photo.png`;
      const { data: photoUrl } = admin.storage.from("application-documents").getPublicUrl(photoPath);
      const photo = await fetchImage(pdf, photoUrl?.publicUrl || null);
      if (photo) {
        const w = 90, h = 110;
        ctx.page.drawRectangle({ x: ctx.width - ctx.margin - w - 4, y: ctx.y - h - 4, width: w + 8, height: h + 8, color: rgb(1,1,1), borderColor: rgb(0.85,0.85,0.85), borderWidth: 0.5 });
        ctx.page.drawImage(photo, { x: ctx.width - ctx.margin - w, y: ctx.y - h, width: w, height: h });
      }
    } catch {}

    drawSectionTitle(ctx, "Personal Details");
    drawTwoCol(ctx, "Full Name", app.full_name || "—", "Date of Birth", fmtDate(app.dob));
    drawTwoCol(ctx, "Gender", app.gender || "—", "Nationality", app.nationality || "—");
    drawTwoCol(ctx, "Category", app.category || "—", "State Domicile", app.state_domicile || "—");
    drawTwoCol(ctx, "Aadhaar", app.aadhaar || "—", "APAAR ID", app.apaar_id || "—");
    drawTwoCol(ctx, "PEN Number", app.pen_number || "—", "Gap Years", app.gap_years != null ? String(app.gap_years) : "—");
    drawKV(ctx, "Applicant Type", [app.applicant_type, app.is_nri ? "NRI" : null].filter(Boolean).join(" · ") || "—");

    drawSectionTitle(ctx, "Contact");
    drawTwoCol(ctx, "Phone", app.phone || "—", "Email", app.email || "—");
    drawKV(ctx, "Address", fmtAddress(app.address));

    drawSectionTitle(ctx, "Family");
    drawKV(ctx, "Father", fmtPerson(app.father));
    drawKV(ctx, "Mother", fmtPerson(app.mother));
    drawKV(ctx, "Guardian", fmtPerson(app.guardian));

    drawSectionTitle(ctx, "Course Selections");
    const courses: any[] = Array.isArray(app.course_selections) ? app.course_selections : [];
    if (courses.length === 0) drawKV(ctx, "Selected", "—");
    courses.forEach((c, i) => {
      drawKV(ctx, `Choice ${i+1}`, [c.course_name, c.campus_name, c.program_category].filter(Boolean).join(" · "));
    });

    if (app.school_details && Object.keys(app.school_details).length > 0) {
      drawSectionTitle(ctx, "School Details");
      Object.entries(app.school_details as Record<string, any>).slice(0, 8).forEach(([k, v]) => {
        if (v && typeof v !== "object") drawKV(ctx, k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), String(v));
      });
    }

    if (app.academic_details) {
      drawSectionTitle(ctx, "Academic Details");
      const ad = app.academic_details as any;
      if (Array.isArray(ad.qualifications)) {
        ad.qualifications.forEach((q: any) => {
          drawKV(ctx, q.level || "Qualification", [q.board, q.school, q.year, q.percentage ? q.percentage + "%" : null].filter(Boolean).join(" · "));
        });
      } else {
        Object.entries(ad).slice(0, 8).forEach(([k, v]) => {
          if (v && typeof v !== "object") drawKV(ctx, k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), String(v));
        });
      }
    }

    if (app.extracurricular && Array.isArray(app.extracurricular) && app.extracurricular.length > 0) {
      drawSectionTitle(ctx, "Extracurricular");
      (app.extracurricular as any[]).slice(0, 6).forEach((e, i) => {
        drawKV(ctx, `Activity ${i+1}`, [e.name, e.level, e.year].filter(Boolean).join(" · "));
      });
    }

    // Declaration + signature footer.
    ensureSpace(ctx, 80);
    ctx.y -= 8;
    ctx.page.drawText("Declaration", { x: ctx.margin, y: ctx.y, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
    ctx.y -= 14;
    const decl = "I hereby declare that the information given above is true and correct to the best of my knowledge. I agree to abide by the rules and regulations of the institution.";
    // Naive line break at ~95 chars.
    decl.match(/.{1,95}(\s|$)/g)?.forEach(line => {
      ctx.page.drawText(line.trim(), { x: ctx.margin, y: ctx.y, size: 9, font, color: rgb(0.3,0.3,0.3) });
      ctx.y -= 12;
    });
    ctx.y -= 18;

    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + 180, y: ctx.y }, thickness: 0.5, color: rgb(0.5,0.5,0.5) });
    ctx.page.drawText("Applicant Signature", { x: ctx.margin, y: ctx.y - 12, size: 9, font, color: rgb(0.45,0.45,0.45) });

    // Authority signature block (right).
    const sig = await fetchImage(pdf, branding?.signature_url ?? null);
    if (sig) {
      const sigW = 100, sigH = 40;
      ctx.page.drawImage(sig, { x: ctx.width - ctx.margin - sigW, y: ctx.y + 4, width: sigW, height: sigH });
    }
    ctx.page.drawLine({ start: { x: ctx.width - ctx.margin - 180, y: ctx.y }, end: { x: ctx.width - ctx.margin, y: ctx.y }, thickness: 0.5, color: rgb(0.5,0.5,0.5) });
    ctx.page.drawText(branding?.signatory_name || "Admissions Authority",
      { x: ctx.width - ctx.margin - 180, y: ctx.y - 12, size: 9, font: bold, color: rgb(0.07,0.09,0.18) });
    ctx.page.drawText(branding?.signatory_designation || "for the Institution",
      { x: ctx.width - ctx.margin - 180, y: ctx.y - 24, size: 8, font, color: rgb(0.45,0.45,0.45) });

    const pdfBytes = await pdf.save();

    const path = `applications/${app.application_id}.pdf`;
    const { error: upErr } = await admin.storage
      .from("application-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
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

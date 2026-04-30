// Sample-data preview of a branding template for a given doc type.
// Returns the rendered PDF inline so the frontend can iframe it without
// touching any real lead/payment/application records.

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

const fmtINR = (n: number) => "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Branding {
  name: string;
  letterhead_url: string | null;
  signature_url: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  gstin: string | null;
}

async function paintLetterhead(pdf: PDFDocument, page: any, branding: Branding, width: number, height: number, font: any, bold: any) {
  const lh = await fetchImage(pdf, branding.letterhead_url);
  if (lh) {
    page.drawImage(lh, { x: 0, y: 0, width, height });
    return true;
  }
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.07, 0.09, 0.18) });
  page.drawText(branding.name, { x: 50, y: height - 38, size: 18, font: bold, color: rgb(1,1,1) });
  page.drawText(branding.address || "", { x: 50, y: height - 60, size: 9, font, color: rgb(0.85,0.88,0.95) });
  page.drawRectangle({ x: 0, y: 0, width, height: 30, color: rgb(0.07, 0.09, 0.18) });
  return false;
}

async function paintSignature(pdf: PDFDocument, page: any, branding: Branding, x: number, y: number) {
  const sig = await fetchImage(pdf, branding.signature_url);
  if (sig) {
    const w = 100, h = 40;
    page.drawImage(sig, { x: x - w + 10, y: y + 4, width: w, height: h });
  }
}

async function buildOfferLetterPreview(branding: Branding): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const hasLh = await paintLetterhead(pdf, page, branding, width, height, font, bold);

  const margin = 60;
  let y = height - (hasLh ? 150 : 110);

  page.drawText("OFFER OF ADMISSION", { x: margin, y, size: 16, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 22;
  page.drawText("Date: 30 April 2026", { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
  page.drawText("Application ID: NIMT/26/0123", { x: width - margin - 200, y, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 24;
  page.drawText("Dear Rohan Sharma,", { x: margin, y, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 22;
  page.drawText("Congratulations! We are pleased to offer you provisional admission to", { x: margin, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
  y -= 16;
  page.drawText("Bachelor of Business Administration (BBA)", { x: margin, y, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 16;
  page.drawText("Campus: NIMT Modinagar", { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
  y -= 22;

  page.drawText("Fee Summary", { x: margin, y, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.85,0.85,0.85) });
  y -= 16;

  const drawRow = (label: string, value: string, b = false) => {
    page.drawText(label, { x: margin, y, size: 11, font: b ? bold : font, color: rgb(0.2,0.2,0.2) });
    page.drawText(value, { x: width - margin - 130, y, size: 11, font: b ? bold : font, color: rgb(0.2,0.2,0.2) });
    y -= 16;
  };
  drawRow("Year 1", fmtINR(100000));
  drawRow("Year 2", fmtINR(100000));
  drawRow("Year 3", fmtINR(100000));
  drawRow("Year 4", fmtINR(100000));
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.85,0.85,0.85) });
  y -= 14;
  drawRow("Total Course Fee", fmtINR(400000), true);
  drawRow("Token Fee Required (10%)", fmtINR(10000), true);

  y -= 8;
  page.drawText("Please confirm by paying token fee on or before 15 May 2026.", { x: margin, y, size: 11, font, color: rgb(0.4,0.1,0.1) });
  y -= 36;

  // Signature block
  await paintSignature(pdf, page, branding, width - margin, y);
  page.drawLine({ start: { x: width - margin - 140, y: y - 60 }, end: { x: width - margin - 10, y: y - 60 }, thickness: 0.5, color: rgb(0.5,0.5,0.5) });
  page.drawText(branding.signatory_name || "Authorised Signatory", { x: width - margin - 140, y: y - 74, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText(branding.signatory_designation || "Admissions", { x: width - margin - 140, y: y - 86, size: 9, font, color: rgb(0.4,0.4,0.4) });

  return pdf.save();
}

async function buildReceiptPreview(branding: Branding): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const hasLh = await paintLetterhead(pdf, page, branding, width, height, font, bold);

  const margin = 50;
  let y = height - (hasLh ? 150 : 120);

  page.drawText("Payment Receipt", { x: margin, y, size: 14, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText("Receipt No: N123", { x: width - margin - 180, y, size: 11, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText("Date: 30 Apr 2026", { x: width - margin - 180, y: y - 14, size: 10, font, color: rgb(0.4,0.4,0.4) });
  y -= 30;

  page.drawText("Received from", { x: margin, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
  y -= 16;
  page.drawText("Rohan Sharma", { x: margin, y, size: 14, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 18;
  page.drawText("9876543210  ·  rohan@example.com", { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
  y -= 14;
  page.drawText("Bachelor of Business Administration · NIMT Modinagar", { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
  y -= 24;

  page.drawText("Particulars", { x: margin, y, size: 11, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText("Amount", { x: width - margin - 100, y, size: 11, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 16;
  page.drawText("Token Fee", { x: margin, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
  page.drawText(fmtINR(10000), { x: width - margin - 100, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
  y -= 28;

  page.drawRectangle({ x: margin, y: y - 10, width: width - margin*2, height: 36, color: rgb(0.95,0.97,1) });
  page.drawText("Total Received", { x: margin + 12, y: y + 2, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText(fmtINR(10000), { x: width - margin - 130, y: y + 2, size: 14, font: bold, color: rgb(0.07,0.4,0.2) });
  y -= 50;

  page.drawText("Payment Mode", { x: margin, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
  page.drawText("Transaction Ref", { x: width/2, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
  y -= 14;
  page.drawText("Online (Easebuzz)", { x: margin, y, size: 11, font: bold, color: rgb(0.2,0.2,0.2) });
  page.drawText("EZBZ12345TXNREF", { x: width/2, y, size: 11, font: bold, color: rgb(0.2,0.2,0.2) });

  return pdf.save();
}

async function buildApplicationFormPreview(branding: Branding): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const hasLh = await paintLetterhead(pdf, page, branding, width, height, font, bold);

  const margin = 50;
  let y = height - (hasLh ? 140 : 110);

  page.drawText("APPLICATION FORM", { x: margin, y, size: 16, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText("App ID: NIMT/26/0123", { x: width - margin - 200, y, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 22;

  const section = (title: string) => {
    page.drawRectangle({ x: margin, y: y - 4, width: width - margin*2, height: 22, color: rgb(0.93, 0.95, 1) });
    page.drawText(title, { x: margin + 10, y: y + 4, size: 11, font: bold, color: rgb(0.07, 0.09, 0.18) });
    y -= 30;
  };
  const kv = (k: string, v: string) => {
    page.drawText(k + ":", { x: margin, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
    page.drawText(v, { x: margin + 130, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 14;
  };

  section("Personal Details");
  kv("Full Name", "Rohan Sharma");
  kv("Date of Birth", "12 Aug 2008");
  kv("Gender", "Male");
  kv("Category", "General");

  section("Contact");
  kv("Phone", "9876543210");
  kv("Email", "rohan@example.com");
  kv("Address", "B-12, Sector 11, Noida, UP, 201301");

  section("Course Selections");
  kv("Choice 1", "Bachelor of Business Administration · NIMT Modinagar");

  return pdf.save();
}

const BUILDERS: Record<string, (b: Branding) => Promise<Uint8Array>> = {
  offer_letter:     buildOfferLetterPreview,
  receipt:          buildReceiptPreview,
  application_form: buildApplicationFormPreview,
  // admission_letter / transcript / bona_fide reuse the offer-letter shape for now
  admission_letter: buildOfferLetterPreview,
  transcript:       buildOfferLetterPreview,
  bona_fide:        buildOfferLetterPreview,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || (await req.json().catch(() => ({}))).slug;
    const docType = url.searchParams.get("doc_type") || "offer_letter";

    if (!slug) {
      return new Response(JSON.stringify({ error: "slug required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: branding } = await admin
      .from("institution_branding")
      .select("name, letterhead_url, signature_url, signatory_name, signatory_designation, address, contact_email, contact_phone, website, gstin")
      .eq("slug", slug)
      .single();
    if (!branding) {
      return new Response(JSON.stringify({ error: "Branding not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const builder = BUILDERS[docType] || BUILDERS.offer_letter;
    const bytes = await builder(branding as Branding);

    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="preview-${slug}-${docType}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[preview-document] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

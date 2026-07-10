/**
 * CBSE Transfer Certificate PDF generator.
 *
 * Renders the CBSE-prescribed 23-field TC proforma for a
 * `student_tc_requests` row (status must be 'approved', i.e. a serial
 * number has been assigned). Data comes from the request's `tc_details`
 * jsonb (assembled + edited in the frontend), with the school header
 * resolved via the `student_branding` RPC. Mirrors the data-fetch /
 * pdf-lib / uploadToR2 pattern of generate-offer-letter.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { uploadToR2 } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NAVY = rgb(0.09, 0.13, 0.28);
const GREY = rgb(0.35, 0.35, 0.4);
const BLACK = rgb(0, 0, 0);

async function fetchImage(pdf: PDFDocument, url: string | null | undefined): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const looksPng = (r.headers.get("content-type") || "").includes("png") || url.toLowerCase().endsWith(".png");
    try {
      return looksPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      try { return looksPng ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes); }
      catch { return null; }
    }
  } catch {
    return null;
  }
}

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Spell a number < 1000 in words (used for day-of-month and year chunks). */
function numWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
  return (ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + numWords(n % 100) : "")).trim();
}

/** Spell a year, e.g. 2010 -> "Two Thousand Ten", 1998 -> "Nineteen Ninety Eight". */
function yearWords(y: number): string {
  if (y >= 2000 && y < 2100) return ("Two Thousand" + (y % 100 ? " " + numWords(y % 100) : "")).trim();
  if (y >= 1900 && y < 2000) return (numWords(Math.floor(y / 100)) + " " + numWords(y % 100)).trim();
  return numWords(y);
}

/** "2010-03-05" -> "Fifth March Two Thousand Ten". Empty string on bad input. */
function dateInWords(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${numWords(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${yearWords(d.getUTCFullYear())}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { tc_request_id } = await req.json();
    if (!tc_request_id) {
      return new Response(JSON.stringify({ error: "tc_request_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: reqRow, error: reqErr } = await admin
      .from("student_tc_requests")
      .select("id, student_id, status, tc_details, tc_number, issue_date, requested_at, reason_for_leaving")
      .eq("id", tc_request_id)
      .maybeSingle();
    if (reqErr) throw reqErr;
    if (!reqRow) {
      return new Response(JSON.stringify({ error: "TC request not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (reqRow.status !== "approved") {
      return new Response(JSON.stringify({ error: "TC must be approved before generating the PDF" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: student } = await admin
      .from("students")
      .select("id, name, admission_no, dob")
      .eq("id", reqRow.student_id)
      .maybeSingle();

    const { data: branding } = await admin.rpc("student_branding" as any, { _student_id: reqRow.student_id });

    // Principal name: a linked user account (auto-updates on principal change)
    // takes precedence over the static principal_name text.
    let principalName = branding?.principal_name ? String(branding.principal_name) : "";
    if (branding?.principal_user_id) {
      const { data: prof } = await admin
        .from("profiles").select("display_name, salutation").eq("user_id", branding.principal_user_id).maybeSingle();
      if (prof?.display_name) {
        principalName = [prof.salutation, prof.display_name].filter(Boolean).join(" ").trim();
      }
    }

    const d = (reqRow.tc_details || {}) as Record<string, unknown>;
    const v = (k: string): string => {
      const x = d[k];
      return x === null || x === undefined ? "" : String(x);
    };

    // ── Build PDF ──
    const pdf = await PDFDocument.create();
    const page: PDFPage = pdf.addPage([595.28, 841.89]); // A4
    const font: PDFFont = await pdf.embedFont(StandardFonts.Helvetica);
    const bold: PDFFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const seal = await fetchImage(pdf, branding?.seal_url);

    const M = 50;
    const RIGHT = 595.28 - M;
    let y = 800;

    const centerText = (t: string, f: PDFFont, size: number, color = BLACK) => {
      const w = f.widthOfTextAtSize(t, size);
      page.drawText(t, { x: (595.28 - w) / 2, y, size, font: f, color });
    };
    const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
      const out: string[] = [];
      let line = "";
      for (const word of String(text).split(/\s+/)) {
        const trial = line ? line + " " + word : word;
        if (f.widthOfTextAtSize(trial, size) > maxW && line) { out.push(line); line = word; }
        else line = trial;
      }
      if (line) out.push(line);
      return out.length ? out : [""];
    };

    // Header
    centerText(String(branding?.name || "NIMT School"), bold, 16, NAVY); y -= 18;
    if (branding?.address) { centerText(String(branding.address), font, 9, GREY); y -= 12; }
    const idBits = [
      branding?.affiliation_no ? `CBSE Affiliation No: ${branding.affiliation_no}` : "",
      branding?.school_code ? `School Code: ${branding.school_code}` : "",
    ].filter(Boolean);
    if (idBits.length) { centerText(idBits.join("    |    "), font, 9, GREY); y -= 12; }
    y -= 6;
    centerText("TRANSFER CERTIFICATE", bold, 13, BLACK); y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1, color: NAVY }); y -= 18;

    // TC No / Admission No row
    page.drawText(`T.C. No.: ${reqRow.tc_number || "-"}`, { x: M, y, size: 10, font: bold });
    const admText = `Admission No.: ${student?.admission_no || v("admissionNo") || "-"}`;
    page.drawText(admText, { x: RIGHT - bold.widthOfTextAtSize(admText, 10), y, size: 10, font: bold });
    y -= 22;

    // 23 CBSE fields. value resolves from tc_details; a few derive here.
    const dob = v("dob") || student?.dob || "";
    const dobFig = fmtDate(dob);
    const dobWords = v("dobWords") || dateInWords(dob);
    const fields: [string, string][] = [
      ["Name of the Pupil", v("name") || student?.name || ""],
      ["Mother's Name", v("motherName")],
      ["Father's / Guardian's Name", v("fatherName")],
      ["Nationality", v("nationality")],
      ["Whether belongs to SC / ST / OBC", v("category")],
      ["Date of first admission in the school with class", v("firstAdmissionDateClass")],
      ["Date of Birth (in figures and words)", [dobFig, dobWords].filter(Boolean).join("  —  ")],
      ["Class in which the pupil last studied (in figures & words)", v("classLastStudied")],
      ["School / Board Annual Examination last taken with result", v("lastExamResult")],
      ["Whether failed, if so once / twice in the same class", v("whetherFailed")],
      ["Subjects studied", v("subjects")],
      ["Whether qualified for promotion to higher class; if so, to which class", v("promotion")],
      ["Month upto which the (pupil has paid) school dues paid", v("duesPaidUpto")],
      ["Any fee concession availed of; if so, the nature of concession", v("feeConcession")],
      ["Total number of working days", v("workingDays")],
      ["Total number of working days present", v("daysPresent")],
      ["Whether NCC Cadet / Boy Scout / Girl Guide", v("nccScoutGuide")],
      ["Games played / extra-curricular activities & achievement", v("gamesActivities")],
      ["General Conduct", v("conduct")],
      ["Date of application for certificate", fmtDate(v("applicationDate") || reqRow.requested_at)],
      ["Date of issue of certificate", fmtDate(v("issueDate") || reqRow.issue_date)],
      ["Reason for leaving the school", v("reasonForLeaving") || reqRow.reason_for_leaving || ""],
      ["Any other remarks", v("remarks")],
    ];

    const labelW = 300;
    fields.forEach(([label, value], i) => {
      const num = `${i + 1}.`;
      const labelLines = wrap(label, font, 9.5, labelW - 18);
      const valueLines = wrap(value || "-", font, 9.5, RIGHT - (M + labelW) - 4);
      const rows = Math.max(labelLines.length, valueLines.length);
      page.drawText(num, { x: M, y, size: 9.5, font: bold });
      for (let r = 0; r < rows; r++) {
        if (labelLines[r]) page.drawText(labelLines[r], { x: M + 18, y: y - r * 11, size: 9.5, font });
        if (valueLines[r]) page.drawText(valueLines[r], { x: M + labelW, y: y - r * 11, size: 9.5, font: bold });
      }
      page.drawText(":", { x: M + labelW - 8, y, size: 9.5, font });
      y -= rows * 11 + 5;
    });

    // Footer: certification line + signatures
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: GREY }); y -= 16;
    wrap("Certified that the above information is in accordance with the School Register.", font, 9, RIGHT - M)
      .forEach((ln) => { page.drawText(ln, { x: M, y, size: 9, font, color: GREY }); y -= 11; });

    y -= 40;
    if (seal) {
      const dims = seal.scale(80 / seal.width);
      page.drawImage(seal, { x: (595.28 - dims.width) / 2, y: y - dims.height + 30, width: dims.width, height: dims.height, opacity: 0.9 });
    }
    page.drawText("Class Teacher", { x: M, y, size: 9, font });
    centerText("Checked by", font, 9);
    page.drawText("Principal", { x: RIGHT - font.widthOfTextAtSize("Principal", 9), y, size: 9, font });
    if (principalName) {
      page.drawText(principalName, { x: RIGHT - font.widthOfTextAtSize(principalName, 8), y: y - 11, size: 8, font, color: GREY });
    }

    const pdfBytes = await pdf.save();
    const path = `transfer-certificates/${reqRow.student_id}/${reqRow.id}.pdf`;
    const uploaded = await uploadToR2({ key: path, body: pdfBytes, contentType: "application/pdf" });

    await admin.from("student_tc_requests").update({ tc_pdf_path: uploaded.url }).eq("id", reqRow.id);

    return new Response(JSON.stringify({ ok: true, tc_pdf_path: uploaded.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[transfer-certificate] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ponytail: self-check for the only non-trivial logic (date-in-words). Run with:
//   deno run supabase/functions/generate-transfer-certificate/index.ts
if (import.meta.main) {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error("FAIL: " + m); };
  assert(dateInWords("2010-03-05") === "Five March Two Thousand Ten", "2010-03-05 -> " + dateInWords("2010-03-05"));
  assert(dateInWords("1998-12-21") === "Twenty One December Nineteen Ninety Eight", "1998 -> " + dateInWords("1998-12-21"));
  assert(dateInWords("2000-01-01") === "One January Two Thousand", "2000 -> " + dateInWords("2000-01-01"));
  assert(dateInWords("") === "", "empty");
  assert(yearWords(2015) === "Two Thousand Fifteen", "2015");
  console.log("generate-transfer-certificate self-check passed");
}

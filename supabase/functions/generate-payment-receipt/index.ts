import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PAY_TYPE_LABELS: Record<string, string> = {
  application_fee:  "Application Fee",
  token_fee:        "Token Fee",
  registration_fee: "Registration Fee",
  other:            "Other",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer / NEFT",
  cheque: "Cheque / DD", online: "Online", gateway: "Online (PG)",
};

function fmtINR(n: number): string {
  return "Rs. " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function buildReceiptPdf(opts: {
  receipt_no: string;
  payment_date: string;
  applicant_name: string;
  phone: string | null;
  email: string | null;
  course_name: string | null;
  campus_name: string | null;
  type_label: string;
  amount: number;
  mode_label: string;
  transaction_ref: string | null;
  application_id: string | null;
  pre_admission_no: string | null;
  admission_no: string | null;
  branding?: any;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = height - 60;
  const lh = await fetchImage(pdf, opts.branding?.letterhead_url ?? null);
  if (lh) {
    // Letterhead occupies the page; body starts ~140pt from top, ends 90pt from bottom.
    page.drawImage(lh, { x: 0, y: 0, width, height });
    y = height - 150;
  } else {
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.07, 0.09, 0.18) });
    page.drawText(opts.branding?.name || "NIMT Educational Institutions", { x: margin, y: height - 38, size: 18, font: bold, color: rgb(1,1,1) });
    page.drawText("Payment Receipt", { x: margin, y: height - 60, size: 11, font, color: rgb(0.85,0.88,0.95) });

    page.drawText(`Receipt No: ${opts.receipt_no}`, { x: width - margin - 180, y: height - 38, size: 11, font: bold, color: rgb(1,1,1) });
    page.drawText(`Date: ${opts.payment_date}`, { x: width - margin - 180, y: height - 56, size: 10, font, color: rgb(0.85,0.88,0.95) });

    y = height - 120;
  }
  // When a letterhead is in use, render receipt-no/date inside the body.
  if (lh) {
    page.drawText(`Receipt No: ${opts.receipt_no}`, { x: width - margin - 180, y, size: 11, font: bold, color: rgb(0.07,0.09,0.18) });
    page.drawText(`Date: ${opts.payment_date}`, { x: width - margin - 180, y: y - 14, size: 10, font, color: rgb(0.4,0.4,0.4) });
    page.drawText("Payment Receipt", { x: margin, y, size: 14, font: bold, color: rgb(0.07,0.09,0.18) });
    y -= 30;
  }
  page.drawText("Received from", { x: margin, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
  y -= 16;
  page.drawText(opts.applicant_name, { x: margin, y, size: 14, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 18;
  const contactBits = [opts.phone, opts.email].filter(Boolean).join("  ·  ");
  if (contactBits) {
    page.drawText(contactBits, { x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4) });
    y -= 18;
  }
  if (opts.course_name || opts.campus_name) {
    page.drawText([opts.course_name, opts.campus_name].filter(Boolean).join("  ·  "), {
      x: margin, y, size: 10, font, color: rgb(0.4,0.4,0.4),
    });
    y -= 16;
  }

  // Identifiers row
  const ids: [string, string | null][] = [
    ["Application ID", opts.application_id],
    ["Pre-Admission No (PAN)", opts.pre_admission_no],
    ["Admission No (AN)", opts.admission_no],
  ].filter(([, v]) => !!v) as [string, string][];
  if (ids.length) {
    y -= 8;
    for (const [k, v] of ids) {
      page.drawText(`${k}: `, { x: margin, y, size: 10, font, color: rgb(0.45,0.45,0.45) });
      page.drawText(v!, { x: margin + 130, y, size: 10, font: bold, color: rgb(0.07,0.09,0.18) });
      y -= 14;
    }
  }

  // Divider
  y -= 12;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0.85,0.85,0.85) });
  y -= 24;

  // Particulars
  page.drawText("Particulars", { x: margin, y, size: 11, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText("Amount", { x: width - margin - 100, y, size: 11, font: bold, color: rgb(0.07,0.09,0.18) });
  y -= 16;
  page.drawText(opts.type_label, { x: margin, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
  page.drawText(fmtINR(opts.amount), { x: width - margin - 100, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
  y -= 28;

  // Total band
  page.drawRectangle({ x: margin, y: y - 10, width: width - margin*2, height: 36, color: rgb(0.95,0.97,1) });
  page.drawText("Total Received", { x: margin + 12, y: y + 2, size: 12, font: bold, color: rgb(0.07,0.09,0.18) });
  page.drawText(fmtINR(opts.amount), { x: width - margin - 130, y: y + 2, size: 14, font: bold, color: rgb(0.07,0.4,0.2) });
  y -= 50;

  // Payment mode + ref
  page.drawText("Payment Mode", { x: margin, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
  page.drawText("Transaction Ref", { x: width/2, y, size: 9, font, color: rgb(0.45,0.45,0.45) });
  y -= 14;
  page.drawText(opts.mode_label, { x: margin, y, size: 11, font: bold, color: rgb(0.2,0.2,0.2) });
  page.drawText(opts.transaction_ref || "—", { x: width/2, y, size: 11, font: bold, color: rgb(0.2,0.2,0.2) });
  y -= 40;

  page.drawText("This is a system-generated receipt and does not require a physical signature.", {
    x: margin, y, size: 9, font, color: rgb(0.5,0.5,0.5),
  });
  y -= 14;
  page.drawText("For queries: admissions@nimt.ac.in  ·  https://www.nimt.ac.in", {
    x: margin, y, size: 9, font, color: rgb(0.5,0.5,0.5),
  });

  // Footer band — only render when no letterhead is present (letterhead carries its own footer).
  if (!opts.branding?.letterhead_url) {
    page.drawRectangle({ x: 0, y: 0, width, height: 30, color: rgb(0.07, 0.09, 0.18) });
    page.drawText("UniOs · " + (opts.branding?.name || "NIMT Educational Institutions"), {
      x: margin, y: 11, size: 9, font, color: rgb(0.85,0.88,0.95),
    });
  }

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey   = Deno.env.get("RESEND_API_KEY");
    const waToken     = Deno.env.get("WHATSAPP_API_TOKEN");
    const waPhoneId   = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const admin       = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { lead_payment_id } = await req.json();
    if (!lead_payment_id) {
      return new Response(JSON.stringify({ error: "lead_payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull payment + denormalised lead/course/campus.
    const { data: lp, error: lpErr } = await admin
      .from("lead_payments")
      .select(`
        id, receipt_no, type, amount, payment_mode, transaction_ref,
        payment_date, status, receipt_url,
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
    const courseName = lead?.courses?.name ?? null;
    const campusName = lead?.campuses?.name ?? null;
    const dateStr = new Date(lp.payment_date || Date.now()).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });

    // Resolve branding (campus → branding_slug → row, fallback to default).
    const { data: branding } = await admin.rpc("lead_branding" as any, { _lead_id: lead?.id });

    // Build PDF.
    const pdfBytes = await buildReceiptPdf({
      receipt_no:      lp.receipt_no || "—",
      payment_date:    dateStr,
      applicant_name:  lead?.name || "Candidate",
      phone:           lead?.phone || null,
      email:           lead?.email || null,
      course_name:     courseName,
      campus_name:     campusName,
      type_label:      PAY_TYPE_LABELS[lp.type] || lp.type,
      amount:          Number(lp.amount),
      mode_label:      MODE_LABELS[lp.payment_mode] || lp.payment_mode,
      transaction_ref: lp.transaction_ref,
      application_id:  lead?.application_id || null,
      pre_admission_no: lead?.pre_admission_no || null,
      admission_no:    lead?.admission_no || null,
      branding,
    });

    // Upload (overwrite is fine — receipt content is immutable per receipt_no).
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

    // Send WhatsApp (template: payment_receipt — must be approved at Meta)
    let waSent = false;
    if (lead?.phone && waToken && waPhoneId) {
      try {
        const payload = {
          messaging_product: "whatsapp",
          to: lead.phone.replace(/[^0-9]/g, ""),
          type: "template",
          template: {
            name: "payment_receipt",
            language: { code: "en" },
            components: [
              { type: "body", parameters: [
                { type: "text", text: lead.name || "Candidate" },
                { type: "text", text: PAY_TYPE_LABELS[lp.type] || lp.type },
                { type: "text", text: fmtINR(Number(lp.amount)) },
                { type: "text", text: lp.receipt_no || "—" },
                { type: "text", text: receiptUrl },
              ]},
            ],
          },
        };
        const waRes = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const waBody = await waRes.json();
        waSent = waRes.ok;
        if (waRes.ok) {
          await admin.from("whatsapp_messages").insert({
            wa_message_id: waBody?.messages?.[0]?.id || null,
            direction: "outbound",
            phone: lead.phone.replace(/[^0-9]/g, ""),
            message_type: "template",
            content: `Payment receipt: ${lp.receipt_no} for ${PAY_TYPE_LABELS[lp.type]} of ${fmtINR(Number(lp.amount))}. View: ${receiptUrl}`,
            template_key: "payment_receipt",
            status: "sent", is_read: true, lead_id: lead.id,
          } as any);
        } else {
          console.error("[receipt] whatsapp failed:", waBody?.error?.message);
        }
      } catch (e) {
        console.error("[receipt] whatsapp threw:", e);
      }
    }

    // Send email (Resend) with PDF attached.
    let emailSent = false;
    if (lead?.email && resendKey) {
      try {
        // Pdf bytes -> base64 (chunked to avoid stack issues).
        let bin = "";
        for (let i = 0; i < pdfBytes.length; i += 8192) {
          bin += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
        }
        const b64 = btoa(bin);

        const subject = `Payment receipt ${lp.receipt_no} — ${PAY_TYPE_LABELS[lp.type]}`;
        const html = `
          <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
            <h2 style="color:#111827;margin:0 0 8px">Payment received — ${PAY_TYPE_LABELS[lp.type]}</h2>
            <p style="color:#4b5563;font-size:14px;margin:0 0 16px">
              Hi ${lead.name || "there"}, we've received your payment of <strong>${fmtINR(Number(lp.amount))}</strong>
              on ${dateStr}.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;background:#f9fafb;border-radius:12px;padding:8px">
              <tr><td style="padding:6px 12px;color:#6b7280">Receipt No</td><td style="padding:6px 12px;font-weight:600">${lp.receipt_no}</td></tr>
              <tr><td style="padding:6px 12px;color:#6b7280">Type</td><td style="padding:6px 12px;font-weight:600">${PAY_TYPE_LABELS[lp.type]}</td></tr>
              <tr><td style="padding:6px 12px;color:#6b7280">Mode</td><td style="padding:6px 12px;font-weight:600">${MODE_LABELS[lp.payment_mode] || lp.payment_mode}</td></tr>
              ${lp.transaction_ref ? `<tr><td style="padding:6px 12px;color:#6b7280">Transaction Ref</td><td style="padding:6px 12px;font-weight:600">${lp.transaction_ref}</td></tr>` : ""}
            </table>
            <p style="color:#4b5563;font-size:13px;margin:16px 0 4px">
              The receipt is attached as a PDF. You can also <a href="${receiptUrl}" style="color:#4f46e5">download it from this link</a>.
            </p>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">
              NIMT Educational Institutions · admissions@nimt.ac.in
            </p>
          </div>`;

        const emailFrom = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: emailFrom, to: [lead.email], subject, html,
            attachments: [{ filename: `${lp.receipt_no}.pdf`, content: b64 }],
          }),
        });
        emailSent = r.ok;
        if (!r.ok) {
          console.error("[receipt] resend failed:", await r.text());
        }
      } catch (e) {
        console.error("[receipt] email threw:", e);
      }
    }

    return new Response(JSON.stringify({
      ok: true, receipt_no: lp.receipt_no, receipt_url: receiptUrl,
      whatsapp_sent: waSent, email_sent: emailSent,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[receipt] error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

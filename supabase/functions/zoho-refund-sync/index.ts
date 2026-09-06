// zoho-refund-sync (auth required — staff only)
//
// Sync student fee refunds to Zoho Books. Same shape as zoho-video-bill-sync:
// each refund is its own Zoho Bill, booked under a PER-STUDENT vendor (name
// "Name - Father Name - Adm No") with the payee bank details mapped onto that
// vendor. The vendor id is cached on students.zoho_vendor_id (dedup across a
// student's refunds) and fee_refunds.zoho_vendor_id.
//
// Actions:
//   create_bill    : ensure the student's Zoho vendor (create + attach bank if
//                    needed), create a Bill for the approved refund under the
//                    refund expense account, notes carry admission no / reason /
//                    per-head breakup, attach the cancelled-cheque/passbook
//                    proof, store ids back.
//   record_payment : record a Vendor Payment against the refund's Zoho bill
//                    (called after the refund is marked paid inside UniOs).
//
// Env: ZOHO_REFUND_ACCOUNT_ID / ZOHO_REFUND_ACCOUNT_NAME (refund expense
//      account; falls back to the shared video-bill payout account).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zohoConfigured, zohoAccessToken, zohoApi, zohoAttach, zohoResolveExpenseAccount, zohoSearchVendors } from "../_shared/zoho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STAFF_ROLES = new Set(["super_admin", "accountant", "campus_admin"]);

async function fetchProofBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!zohoConfigured()) return json({ error: "Zoho is not configured. Set ZOHO_* secrets." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(supabaseUrl, serviceKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!(roles || []).some((r: { role: string }) => STAFF_ROLES.has(r.role))) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const refundId: string = body.refund_id;
    const action: string = body.action || "create_bill";
    if (!refundId) return json({ error: "refund_id required" }, 400);

    const { data: refund } = await admin.from("fee_refunds").select("*").eq("id", refundId).maybeSingle();
    if (!refund) return json({ error: "Refund not found" }, 404);
    const { data: student } = await admin.from("students")
      .select("name, father_name, admission_no, pre_admission_no, phone, email, zoho_vendor_id")
      .eq("id", refund.student_id).maybeSingle();

    const token = await zohoAccessToken();

    const studentName = student?.name || "Student";
    const admissionNo = student?.admission_no || student?.pre_admission_no || student?.phone || refund.student_id.slice(0, 8);
    // Vendor display name: "Name - Father Name - Adm No" (skip empty parts).
    const vendorName = [studentName, student?.father_name, admissionNo].map((s) => (s || "").trim()).filter(Boolean).join(" - ");

    // Payee bank details as a single line — carried on the vendor's remarks and
    // the bill notes (the reliable, always-visible place for finance to pay from).
    const bankRemarks = (): string => [
      refund.bank_account_name ? `A/C Holder: ${refund.bank_account_name}` : null,
      refund.bank_account_number ? `A/C No: ${refund.bank_account_number}` : null,
      refund.bank_ifsc ? `IFSC: ${refund.bank_ifsc}` : null,
      refund.bank_name ? `Bank: ${refund.bank_name}` : null,
      refund.bank_upi ? `UPI: ${refund.bank_upi}` : null,
    ].filter(Boolean).join(" | ");

    // Ensure a per-student Zoho vendor, cached on the student + refund. Reuse an
    // existing phone match before creating (avoids duplicate vendors); map the
    // refund's bank details onto the vendor once.
    const ensureVendor = async (): Promise<string> => {
      let vId: string | null = refund.zoho_vendor_id || student?.zoho_vendor_id || null;
      if (!vId && student?.phone) {
        const [hit] = await zohoSearchVendors(token, { phone: student.phone });
        if (hit && (hit.phone || "").replace(/\D/g, "").slice(-10) === student.phone.replace(/\D/g, "").slice(-10)) {
          vId = hit.contact_id;
        }
      }
      if (!vId) {
        // Payee bank details go in the contact's remarks so they're visible on
        // the vendor. Zoho Books' /contacts/{id}/bankaccount endpoint is the
        // connected-banking gateway registration (requires a `gateway` value),
        // not a plain vendor bank field, so it can't be used for display.
        const res = await zohoApi(token, "POST", "/contacts", {
          contact_name: vendorName,
          contact_type: "vendor",
          phone: student?.phone || undefined,
          email: student?.email || undefined,
          notes: bankRemarks(),
        });
        if (!res.ok) throw new Error(`vendor create failed: ${JSON.stringify(res.data)}`);
        vId = res.data.contact.contact_id as string;
      } else {
        // Existing vendor — keep its remarks in sync with this refund's payee bank.
        const rem = bankRemarks();
        if (rem) await zohoApi(token, "PUT", `/contacts/${vId}`, { notes: rem });
      }
      // Cache for dedup + record_payment.
      if (vId !== student?.zoho_vendor_id) await admin.from("students").update({ zoho_vendor_id: vId }).eq("id", refund.student_id);
      if (vId !== refund.zoho_vendor_id) {
        await admin.from("fee_refunds").update({ zoho_vendor_id: vId }).eq("id", refundId);
        refund.zoho_vendor_id = vId;
      }
      return vId;
    };

    if (action === "create_bill") {
      try {
        // Always ensure the vendor (creates it + syncs its bank remarks), even
        // when the bill already exists so a Resync repairs vendor details.
        const vendorId = await ensureVendor();
        let zohoBillId = refund.zoho_bill_id;
        let zohoBillNumber = refund.zoho_bill_number;

        // A stored bill id may point at a bill that was deleted in Zoho —
        // verify it still exists, else drop it so we recreate below.
        if (zohoBillId) {
          const check = await zohoApi(token, "GET", `/bills/${zohoBillId}`);
          if (!check.ok) { zohoBillId = null; zohoBillNumber = null; }
        }

        // Idempotency: reuse an existing Zoho bill for this refund.
        if (!zohoBillId) {
          const existing = await zohoApi(token, "GET", "/bills", undefined, { reference_number: refundId });
          const found = existing.ok ? (existing.data?.bills || [])[0] : null;
          if (found) { zohoBillId = found.bill_id; zohoBillNumber = found.bill_number; }
        }

        if (!zohoBillId) {
          // Refund expense account. Reuse the video-bill payout account by
          // default (ZOHO_PAYOUT_ACCOUNT_ID/NAME); ZOHO_REFUND_ACCOUNT_* override
          // it if refunds should book to a distinct Refund category.
          const acctId = Deno.env.get("ZOHO_REFUND_ACCOUNT_ID") || Deno.env.get("ZOHO_PAYOUT_ACCOUNT_ID");
          const acctName = Deno.env.get("ZOHO_REFUND_ACCOUNT_NAME") || Deno.env.get("ZOHO_PAYOUT_ACCOUNT_NAME");
          let lineAccount: Record<string, unknown>;
          if (acctId) lineAccount = { account_id: acctId };
          else {
            try { lineAccount = { account_id: await zohoResolveExpenseAccount(token) }; }
            catch (e) { if (acctName) lineAccount = { account_name: acctName }; else throw e; }
          }

          // Per-head breakup for the description + notes.
          const { data: items } = await admin
            .from("fee_refund_items")
            .select("amount, fee_ledger:fee_ledger_id(term, fee_codes:fee_code_id(name))")
            .eq("refund_id", refundId);
          const breakup = (items || []).map((it: any) => {
            const head = it.fee_ledger?.fee_codes?.name || "Fee";
            const term = it.fee_ledger?.term ? ` (${it.fee_ledger.term})` : "";
            return `${head}${term}: ₹${Number(it.amount).toLocaleString("en-IN")}`;
          }).join("; ");

          const bank = bankRemarks();
          const notes = [
            `Refund · ${studentName} · Admission No ${admissionNo}`,
            refund.reason ? `Reason: ${refund.reason}` : null,
            breakup ? `Breakup — ${breakup}` : null,
            bank ? `Payee Bank — ${bank}` : null,
            refund.notes || null,
          ].filter(Boolean).join("\n");

          const res = await zohoApi(token, "POST", "/bills", {
            vendor_id: vendorId,
            bill_number: `REF-${refundId.slice(0, 8).toUpperCase()}`,
            reference_number: refundId,
            line_items: [{
              ...lineAccount,
              name: `Fee refund — ${studentName} (${admissionNo})`,
              description: breakup || refund.reason || "Student fee refund",
              rate: Number(refund.total_amount),
              quantity: 1,
            }],
            notes,
          });
          if (!res.ok) throw new Error(`bill create failed: ${JSON.stringify(res.data)}`);
          zohoBillId = res.data.bill.bill_id;
          zohoBillNumber = res.data.bill.bill_number;
        }

        // Attach the cancelled cheque / passbook proof (best-effort).
        if (refund.proof_url) {
          const bytes = await fetchProofBytes(refund.proof_url);
          if (bytes) {
            const ext = refund.proof_url.split("?")[0].split(".").pop()?.toLowerCase();
            const ct = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
            const att = await zohoAttach(token, `/bills/${zohoBillId}/attachment`, `refund-proof-${refundId.slice(0, 8)}.${ext || "pdf"}`, bytes, ct);
            if (!att.ok) console.error("attachment failed", att.data);
          }
        }

        await admin.from("fee_refunds").update({
          zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber,
          zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", refundId);

        return json({ ok: true, zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber });
      } catch (e) {
        await admin.from("fee_refunds").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", refundId);
        return json({ error: String(e) }, 502);
      }
    }

    if (action === "record_payment") {
      if (!refund.zoho_bill_id) return json({ error: "No Zoho bill for this refund — create the bill first." }, 400);
      try {
        const vendorId = refund.zoho_vendor_id || await ensureVendor();
        const res = await zohoApi(token, "POST", "/vendorpayments", {
          vendor_id: vendorId,
          payment_mode: "banktransfer",
          amount: Number(refund.total_amount),
          date: refund.paid_at ? new Date(refund.paid_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          bills: [{ bill_id: refund.zoho_bill_id, amount_applied: Number(refund.total_amount) }],
        });
        if (!res.ok) throw new Error(`vendor payment failed: ${JSON.stringify(res.data)}`);
        await admin.from("fee_refunds").update({
          zoho_payment_id: res.data.vendorpayment?.payment_id,
          zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", refundId);
        return json({ ok: true, zoho_payment_id: res.data.vendorpayment?.payment_id });
      } catch (e) {
        await admin.from("fee_refunds").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", refundId);
        return json({ error: String(e) }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

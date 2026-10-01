// zoho-refund-sync (auth required — staff only)
//
// Sync fee refunds to Zoho Books. Refunds may belong to an admitted student or
// directly to a pre-admission lead payment; each refund is its own Zoho Bill.
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
import { zohoConfigured, zohoAccessToken, zohoApi, zohoAttach, zohoResolveExpenseAccount, zohoSearchVendors, zohoAddVendorBankAccount, zohoVendorHasBank } from "../_shared/zoho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function bankTxnRef(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
  if (/^\d{1,4}$/.test(s)) return null;
  return s;
}

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
    const { data: canRefund, error: permissionError } = await admin.rpc("can_manage_fee_refund", { _user: uid });
    if (permissionError || canRefund !== true) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const refundId: string = body.refund_id;
    const action: string = body.action || "create_bill";
    if (!refundId) return json({ error: "refund_id required" }, 400);

    const { data: refund } = await admin.from("fee_refunds").select("*").eq("id", refundId).maybeSingle();
    if (!refund) return json({ error: "Refund not found" }, 404);
    if (action === "create_bill" && !["approved", "paid"].includes(refund.status)) {
      return json({ error: "A Zoho refund bill can only be created after approval." }, 409);
    }
    if (action === "record_payment" && refund.status !== "paid") {
      return json({ error: "A Zoho refund payment can only be recorded after payout." }, 409);
    }
    const [{ data: student }, { data: lead }] = await Promise.all([
      refund.student_id
        ? admin.from("students")
            .select("name, father_name, admission_no, pre_admission_no, phone, email, zoho_vendor_id")
            .eq("id", refund.student_id).maybeSingle()
        : Promise.resolve({ data: null }),
      refund.lead_id
        ? admin.from("leads")
            .select("name, admission_no, pre_admission_no, phone, email")
            .eq("id", refund.lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const token = await zohoAccessToken();

    const personName = student?.name || lead?.name || "Candidate";
    const personPhone = student?.phone || lead?.phone || null;
    const personEmail = student?.email || lead?.email || null;
    const admissionNo = student?.admission_no || student?.pre_admission_no || lead?.admission_no || lead?.pre_admission_no || personPhone || (refund.student_id || refund.lead_id || refund.id).slice(0, 8);
    // Vendor display name: "Name - Father Name - Adm No" (skip empty parts).
    const vendorName = [personName, student?.father_name, admissionNo].map((s) => (s || "").trim()).filter(Boolean).join(" - ");

    // Ensure a per-student Zoho vendor, cached on the student + refund. Reuse an
    // existing phone match before creating (avoids duplicate vendors); map the
    // refund's bank details onto the vendor once.
    const ensureVendor = async (): Promise<string> => {
      let vId: string | null = refund.zoho_vendor_id || student?.zoho_vendor_id || null;
      if (!vId && personPhone) {
        const [hit] = await zohoSearchVendors(token, { phone: personPhone });
        if (hit && (hit.phone || "").replace(/\D/g, "").slice(-10) === personPhone.replace(/\D/g, "").slice(-10)) {
          vId = hit.contact_id;
        }
      }
      if (!vId) {
        const res = await zohoApi(token, "POST", "/contacts", {
          contact_name: vendorName,
          contact_type: "vendor",
          phone: personPhone || undefined,
          email: personEmail || undefined,
        });
        if (!res.ok) throw new Error(`vendor create failed: ${JSON.stringify(res.data)}`);
        vId = res.data.contact.contact_id as string;
      }
      // Map the refund's payee bank details onto the vendor (best-effort, once).
      if (refund.bank_account_number && refund.bank_ifsc && !(await zohoVendorHasBank(token, vId))) {
        const att = await zohoAddVendorBankAccount(token, vId, {
          bank_name: refund.bank_name,
          account_number: refund.bank_account_number,
          ifsc: refund.bank_ifsc,
          account_holder: refund.bank_account_name || vendorName,
        });
        if (!att.ok) console.error("vendor bank map failed", att.data);
      }
      // Cache for dedup + record_payment.
      if (student && vId !== student.zoho_vendor_id) await admin.from("students").update({ zoho_vendor_id: vId }).eq("id", refund.student_id);
      if (vId !== refund.zoho_vendor_id) {
        await admin.from("fee_refunds").update({ zoho_vendor_id: vId }).eq("id", refundId);
        refund.zoho_vendor_id = vId;
      }
      return vId;
    };

    if (action === "create_bill") {
      try {
        let zohoBillId = refund.zoho_bill_id;
        let zohoBillNumber = refund.zoho_bill_number;

        // Idempotency: reuse an existing Zoho bill for this refund.
        if (!zohoBillId) {
          const existing = await zohoApi(token, "GET", "/bills", undefined, { reference_number: refundId });
          const found = existing.ok ? (existing.data?.bills || [])[0] : null;
          if (found) { zohoBillId = found.bill_id; zohoBillNumber = found.bill_number; }
        }

        if (!zohoBillId) {
          const vendorId = await ensureVendor();
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
            .select("amount, fee_ledger:fee_ledger_id(term, fee_codes:fee_code_id(name)), lead_payment:lead_payment_id(type)")
            .eq("refund_id", refundId);
          const breakup = (items || []).map((it: any) => {
            const head = it.fee_ledger?.fee_codes?.name || it.lead_payment?.type?.replace(/_/g, " ") || "Fee";
            const term = it.fee_ledger?.term ? ` (${it.fee_ledger.term})` : "";
            return `${head}${term}: ₹${Number(it.amount).toLocaleString("en-IN")}`;
          }).join("; ");

          const notes = [
            `Refund · ${personName} · Admission No ${admissionNo}`,
            refund.reason ? `Reason: ${refund.reason}` : null,
            breakup ? `Breakup — ${breakup}` : null,
            refund.notes || null,
          ].filter(Boolean).join("\n");

          const res = await zohoApi(token, "POST", "/bills", {
            vendor_id: vendorId,
            bill_number: `REF-${refundId.slice(0, 8).toUpperCase()}`,
            reference_number: refundId,
            line_items: [{
              ...lineAccount,
              name: `Fee refund — ${personName} (${admissionNo})`,
              description: breakup || refund.reason || "Fee refund",
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

        // Paid refunds settled in Zoho may already have a bank UTR on the
        // vendor payment. Pull it so finance can share it with the candidate.
        if (refund.zoho_payment_id && !refund.payment_reference) {
          const pay = await zohoApi(token, "GET", `/vendorpayments/${refund.zoho_payment_id}`);
          const ref = bankTxnRef(pay.data?.vendorpayment?.reference_number);
          if (ref) await admin.from("fee_refunds").update({ payment_reference: ref }).eq("id", refundId);
        }

        return json({ ok: true, zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber });
      } catch (e) {
        await admin.from("fee_refunds").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", refundId);
        return json({ error: String(e) }, 502);
      }
    }

    if (action === "record_payment") {
      if (!refund.zoho_bill_id) return json({ error: "No Zoho bill for this refund — create the bill first." }, 400);
      if (refund.zoho_payment_id) {
        return json({ ok: true, zoho_payment_id: refund.zoho_payment_id, payment_reference: refund.payment_reference || null });
      }

      const { data: claimed, error: claimError } = await caller.rpc("claim_fee_refund_zoho_payment_sync", {
        _refund_id: refundId,
        _user: uid,
      });
      if (claimError) return json({ error: "Could not claim Zoho refund payment sync." }, 502);
      if (claimed !== true) {
        const { data: latest } = await admin.from("fee_refunds").select("zoho_payment_id").eq("id", refundId).maybeSingle();
        if (latest?.zoho_payment_id) return json({ ok: true, zoho_payment_id: latest.zoho_payment_id, payment_reference: refund.payment_reference || null });
        return json({ error: "Zoho refund payment sync is already in progress. Retry shortly." }, 409);
      }

      try {
        const vendorId = refund.zoho_vendor_id || await ensureVendor();

        // A stable refund marker lets a retry recover a Zoho payment when the
        // original invocation timed out before saving its ID locally.
        const existing = await zohoApi(token, "GET", "/vendorpayments", undefined, {
          description_contains: `UniOs refund ${refundId}`,
        });
        if (!existing.ok) throw new Error(`vendor payment lookup failed: ${JSON.stringify(existing.data)}`);
        const recovered = (existing.data?.vendorpayments || [])[0];
        if (recovered) {
          await admin.from("fee_refunds").update({
            zoho_payment_id: recovered.payment_id,
            zoho_payment_sync_started_at: null,
            zoho_synced_at: new Date().toISOString(),
            zoho_sync_error: null,
          }).eq("id", refundId);
          return json({ ok: true, zoho_payment_id: recovered.payment_id, payment_reference: refund.payment_reference || null });
        }

        const res = await zohoApi(token, "POST", "/vendorpayments", {
          vendor_id: vendorId,
          payment_mode: "banktransfer",
          amount: Number(refund.total_amount),
          date: refund.paid_at ? new Date(refund.paid_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          reference_number: refund.payment_reference || undefined,
          description: refund.payment_reference
            ? `UniOs refund ${refundId}; payout reference: ${refund.payment_reference}`
            : `UniOs refund ${refundId}`,
          bills: [{ bill_id: refund.zoho_bill_id, amount_applied: Number(refund.total_amount) }],
        });
        if (!res.ok) throw new Error(`vendor payment failed: ${JSON.stringify(res.data)}`);
        const vp = res.data.vendorpayment;
        const ref = bankTxnRef(refund.payment_reference) || bankTxnRef(vp?.reference_number);
        const patch: Record<string, unknown> = {
          zoho_payment_id: vp?.payment_id,
          zoho_payment_sync_started_at: null,
          zoho_synced_at: new Date().toISOString(),
          zoho_sync_error: null,
        };
        if (ref && !refund.payment_reference) patch.payment_reference = ref;
        await admin.from("fee_refunds").update(patch).eq("id", refundId);
        return json({ ok: true, zoho_payment_id: vp?.payment_id, payment_reference: ref || refund.payment_reference || null });
      } catch (e) {
        await admin.from("fee_refunds").update({
          zoho_payment_sync_started_at: null,
          zoho_sync_error: String(e).slice(0, 500),
        }).eq("id", refundId).is("zoho_payment_id", null);
        return json({ error: String(e) }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

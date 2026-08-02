// zoho-books-sync (auth required — staff only)
//
// Actions on a consultant payout:
//   create_bill    : ensure the consultant exists as a Zoho vendor (matched by
//                    phone), create a Bill for the payout, attach the payout slip
//                    PDF, and store the Zoho ids back on the payout/consultant.
//   record_payment : record a Vendor Payment against the payout's Zoho bill
//                    (called after the payout is marked paid inside UniOs).
//
// The design is deliberately generic so the same helpers can later back an
// "approved expense -> Zoho bill -> paid" flow.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zohoConfigured, zohoAccessToken, zohoApi, zohoAttach, zohoFindVendorByPhone, zohoAddVendorBankAccount } from "../_shared/zoho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STAFF_ROLES = new Set(["super_admin", "campus_admin", "admission_head"]);
const ZOHO_MODE: Record<string, string> = { bank_transfer: "banktransfer", upi: "banktransfer", cheque: "check", cash: "cash", other: "banktransfer" };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
    const payoutId: string = body.payout_id;
    const action: string = body.action || "create_bill";
    if (!payoutId) return json({ error: "payout_id required" }, 400);

    // Load payout + consultant + candidate.
    const { data: payout } = await admin.from("consultant_payouts").select("*").eq("id", payoutId).maybeSingle();
    if (!payout) return json({ error: "Payout not found" }, 404);
    const { data: consultant } = await admin.from("consultants").select("*").eq("id", payout.consultant_id).maybeSingle();
    const { data: lead } = await admin.from("leads").select("name, admission_no, pre_admission_no").eq("id", payout.lead_id).maybeSingle();
    const candidate = lead?.name || "Candidate";
    const admissionNo = lead?.admission_no || lead?.pre_admission_no || "";

    const token = await zohoAccessToken();
    let bankWarning: unknown = null; // surfaced in the response when the bank push fails

    // ---- Ensure vendor -------------------------------------------------------
    const ensureVendor = async (): Promise<string> => {
      if (consultant?.zoho_vendor_id) return consultant.zoho_vendor_id;
      let vendorId = consultant?.phone ? await zohoFindVendorByPhone(token, consultant.phone) : null;
      if (!vendorId) {
        const res = await zohoApi(token, "POST", "/contacts", {
          contact_name: consultant?.name || "Consultant",
          company_name: consultant?.company_name || consultant?.organization || consultant?.name || undefined,
          contact_type: "vendor",
          phone: consultant?.phone || undefined,
          email: consultant?.email || undefined,
        });
        if (!res.ok) throw new Error(`vendor create failed: ${JSON.stringify(res.data)}`);
        vendorId = res.data.contact.contact_id;
        // New vendor → push structured bank details (best-effort, non-fatal). Some
        // connected-banking orgs require the account number encrypted; if so this
        // fails and the warning is returned so we can adapt.
        if (consultant?.bank_account_number) {
          const bank = await zohoAddVendorBankAccount(token, vendorId!, {
            bank_name: consultant.bank_name,
            account_number: consultant.bank_account_number,
            ifsc: consultant.bank_ifsc,
            account_holder: consultant.bank_account_name || consultant.name,
          });
          if (!bank.ok) { bankWarning = bank.data; console.error("vendor bank add failed", bank.data); }
        }
      }
      await admin.from("consultants").update({ zoho_vendor_id: vendorId }).eq("id", consultant!.id);
      return vendorId!;
    };

    if (action === "create_bill") {
      try {
        const vendorId = await ensureVendor();
        let billId = payout.zoho_bill_id;
        let billNumber = payout.zoho_bill_number;
        if (!billId) {
          const res = await zohoApi(token, "POST", "/bills", {
            vendor_id: vendorId,
            bill_number: `CP-${payoutId.slice(0, 8).toUpperCase()}`,
            reference_number: payoutId,
            line_items: [{
              name: `Consultant commission — ${candidate}`,
              description: `Admission ${admissionNo}`.trim(),
              rate: Number(payout.payout_amount),
              quantity: 1,
            }],
            notes: `UniOs consultant payout · ${candidate} ${admissionNo}`,
          });
          if (!res.ok) throw new Error(`bill create failed: ${JSON.stringify(res.data)}`);
          billId = res.data.bill.bill_id;
          billNumber = res.data.bill.bill_number;
        }
        // Attach the slip PDF (generated client-side, passed as base64).
        if (body.pdf_base64) {
          const att = await zohoAttach(token, `/bills/${billId}/attachment`, `payout-${admissionNo || payoutId}.pdf`, b64ToBytes(body.pdf_base64));
          if (!att.ok) console.error("attachment failed", att.data);
        }
        await admin.from("consultant_payouts").update({
          zoho_bill_id: billId, zoho_bill_number: billNumber, zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", payoutId);
        return json({ ok: true, zoho_bill_id: billId, zoho_bill_number: billNumber, bank_warning: bankWarning });
      } catch (e) {
        await admin.from("consultant_payouts").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", payoutId);
        return json({ error: String(e) }, 502);
      }
    }

    if (action === "record_payment") {
      if (!payout.zoho_bill_id) return json({ error: "No Zoho bill for this payout — create the bill first." }, 400);
      try {
        const vendorId = await ensureVendor();
        const res = await zohoApi(token, "POST", "/vendorpayments", {
          vendor_id: vendorId,
          payment_mode: ZOHO_MODE[payout.payment_mode || "other"] || "banktransfer",
          amount: Number(payout.payout_amount),
          date: payout.payment_date || new Date().toISOString().slice(0, 10),
          reference_number: payout.payment_reference || undefined,
          bills: [{ bill_id: payout.zoho_bill_id, amount_applied: Number(payout.payout_amount) }],
        });
        if (!res.ok) throw new Error(`vendor payment failed: ${JSON.stringify(res.data)}`);
        await admin.from("consultant_payouts").update({
          zoho_payment_id: res.data.vendorpayment?.payment_id, zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", payoutId);
        return json({ ok: true, zoho_payment_id: res.data.vendorpayment?.payment_id });
      } catch (e) {
        await admin.from("consultant_payouts").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", payoutId);
        return json({ error: String(e) }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

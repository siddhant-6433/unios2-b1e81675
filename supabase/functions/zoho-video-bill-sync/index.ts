// zoho-video-bill-sync (auth required — staff only)
//
// Sync video editor bills to Zoho Books. Same pattern as zoho-books-sync
// (consultant payouts) but operates on video_bills / video_editors.
//
// Actions:
//   create_bill    : ensure video editor exists as Zoho vendor, create a Bill
//                    for the approved video_bill, store Zoho ids back.
//   record_payment : record a Vendor Payment against the video bill's Zoho bill
//                    (called after the bill is marked paid inside UniOs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { zohoConfigured, zohoAccessToken, zohoApi, zohoAttach, zohoFindVendorByPhone, zohoResolveExpenseAccount } from "../_shared/zoho.ts";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STAFF_ROLES = new Set(["super_admin", "campus_admin", "admission_head"]);

// ponytail: duplicated from src/lib/videoBrands.ts — 4 entries, not worth a shared import for Deno
const BRAND_LABEL: Record<string, string> = {
  nimt_educational_institutions: "NIMT Educational Institutions",
  nimt_beacon_school: "NIMT Beacon School",
  mirai_experiential_school: "Mirai Experiential School",
  seralis_lab: "Seralis Lab",
};

function monthLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
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
    const billId: string = body.bill_id;
    const action: string = body.action || "create_bill";
    if (!billId) return json({ error: "bill_id required" }, 400);

    // Load bill + editor.
    const { data: bill } = await admin.from("video_bills").select("*").eq("id", billId).maybeSingle();
    if (!bill) return json({ error: "Video bill not found" }, 404);
    const { data: editor } = await admin.from("video_editors").select("*").eq("id", bill.editor_id).maybeSingle();
    if (!editor) return json({ error: "Editor not found" }, 404);

    const token = await zohoAccessToken();

    // ---- Ensure vendor --------------------------------------------------------
    const ensureVendor = async (): Promise<string> => {
      let vendorId: string | null = editor.zoho_vendor_id
        || (editor.phone ? await zohoFindVendorByPhone(token, editor.phone) : null);
      if (!vendorId) {
        const res = await zohoApi(token, "POST", "/contacts", {
          contact_name: editor.name,
          contact_type: "vendor",
          phone: editor.phone || undefined,
          email: editor.email || undefined,
        });
        if (!res.ok) throw new Error(`vendor create failed: ${JSON.stringify(res.data)}`);
        vendorId = res.data.contact.contact_id;
      }
      if (vendorId !== editor.zoho_vendor_id) {
        await admin.from("video_editors").update({ zoho_vendor_id: vendorId }).eq("id", editor.id);
      }
      return vendorId!;
    };

    if (action === "create_bill") {
      try {
        const vendorId = await ensureVendor();
        let zohoBillId = bill.zoho_bill_id;
        let zohoBillNumber = bill.zoho_bill_number;

        // Idempotency: reuse existing Zoho bill for this video_bill.
        if (!zohoBillId) {
          const existing = await zohoApi(token, "GET", "/bills", undefined, { reference_number: billId });
          const found = existing.ok ? (existing.data?.bills || [])[0] : null;
          if (found) { zohoBillId = found.bill_id; zohoBillNumber = found.bill_number; }
        }

        if (!zohoBillId) {
          // Resolve expense account (same env vars as consultant sync).
          const acctId = Deno.env.get("ZOHO_PAYOUT_ACCOUNT_ID");
          const acctName = Deno.env.get("ZOHO_PAYOUT_ACCOUNT_NAME");
          let lineAccount: Record<string, unknown>;
          if (acctId) lineAccount = { account_id: acctId };
          else {
            try { lineAccount = { account_id: await zohoResolveExpenseAccount(token) }; }
            catch (e) { if (acctName) lineAccount = { account_name: acctName }; else throw e; }
          }

          const brand = BRAND_LABEL[bill.brand] || bill.brand;
          const month = monthLabel(bill.bill_month);
          const res = await zohoApi(token, "POST", "/bills", {
            vendor_id: vendorId,
            bill_number: `VB-${billId.slice(0, 8).toUpperCase()}`,
            reference_number: billId,
            line_items: [{
              ...lineAccount,
              name: `Video editing — ${brand} — ${month}`,
              description: `${bill.video_count} videos × ₹${Number(bill.per_video_rate).toLocaleString("en-IN")}`,
              rate: Number(bill.per_video_rate),
              quantity: bill.video_count,
            }],
            notes: `UniOs video bill · ${editor.name} · ${brand} · ${month}`,
          });
          if (!res.ok) throw new Error(`bill create failed: ${JSON.stringify(res.data)}`);
          zohoBillId = res.data.bill.bill_id;
          zohoBillNumber = res.data.bill.bill_number;
        }

        // Attach the payout slip PDF (generated client-side, passed as base64).
        if (body.pdf_base64) {
          const att = await zohoAttach(token, `/bills/${zohoBillId}/attachment`, `video-bill-${billId.slice(0, 8)}.pdf`, b64ToBytes(body.pdf_base64));
          if (!att.ok) console.error("attachment failed", att.data);
        }

        await admin.from("video_bills").update({
          zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber,
          zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", billId);

        return json({ ok: true, zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber });
      } catch (e) {
        await admin.from("video_bills").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", billId);
        return json({ error: String(e) }, 502);
      }
    }

    if (action === "record_payment") {
      if (!bill.zoho_bill_id) return json({ error: "No Zoho bill for this video bill — create the bill first." }, 400);
      try {
        const vendorId = await ensureVendor();
        const res = await zohoApi(token, "POST", "/vendorpayments", {
          vendor_id: vendorId,
          payment_mode: "banktransfer",
          amount: Number(bill.total_amount),
          date: bill.paid_at ? new Date(bill.paid_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          bills: [{ bill_id: bill.zoho_bill_id, amount_applied: Number(bill.total_amount) }],
        });
        if (!res.ok) throw new Error(`vendor payment failed: ${JSON.stringify(res.data)}`);
        await admin.from("video_bills").update({
          zoho_payment_id: res.data.vendorpayment?.payment_id,
          zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", billId);
        return json({ ok: true, zoho_payment_id: res.data.vendorpayment?.payment_id });
      } catch (e) {
        await admin.from("video_bills").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", billId);
        return json({ error: String(e) }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

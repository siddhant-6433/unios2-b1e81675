// Create an approved academic-partner payout batch as a Zoho Books vendor bill.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  zohoConfigured,
  zohoAccessToken,
  zohoApi,
  zohoFindVendorByPhone,
  zohoResolveExpenseAccount,
} from "../_shared/zoho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const STAFF_ROLES = new Set(["super_admin", "campus_admin", "admission_head"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!zohoConfigured()) return json({ error: "Zoho is not configured. Set ZOHO_* secrets." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!(roles || []).some((row: { role: string }) => STAFF_ROLES.has(row.role))) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const billId = String(body.bill_id || "");
    if (!billId) return json({ error: "bill_id required" }, 400);
    const { data: bill } = await admin.from("academic_partner_bills").select("*").eq("id", billId).maybeSingle();
    if (!bill) return json({ error: "Academic partner bill not found" }, 404);
    if (!["approved", "synced_to_zoho"].includes(bill.status)) {
      return json({ error: "Approve the bill before sending it to Zoho Books." }, 400);
    }
    const { data: partner } = await admin.from("academic_partners").select("*").eq("id", bill.partner_id).maybeSingle();
    if (!partner) return json({ error: "Academic partner not found" }, 404);

    const token = await zohoAccessToken();
    let vendorId: string | null = partner.zoho_vendor_id || null;
    if (!vendorId && partner.phone) vendorId = await zohoFindVendorByPhone(token, partner.phone);
    if (!vendorId) {
      const contact = await zohoApi(token, "POST", "/contacts", {
        contact_name: partner.company_name || partner.name,
        company_name: partner.company_name || partner.organization || partner.name,
          contact_type: "vendor",
          phone: partner.phone || undefined,
          email: partner.authorised_signatory_email || partner.email || undefined,
      });
      if (!contact.ok) throw new Error(`Zoho vendor creation failed: ${JSON.stringify(contact.data)}`);
      vendorId = contact.data.contact.contact_id;
    }
    if (vendorId !== partner.zoho_vendor_id) {
      await admin.from("academic_partners").update({ zoho_vendor_id: vendorId }).eq("id", partner.id);
    }

    let zohoBillId = bill.zoho_bill_id;
    let zohoBillNumber = bill.zoho_bill_number;
    if (!zohoBillId) {
      const existing = await zohoApi(token, "GET", "/bills", undefined, { reference_number: billId });
      const match = existing.ok ? (existing.data?.bills || [])[0] : null;
      if (match) {
        zohoBillId = match.bill_id;
        zohoBillNumber = match.bill_number;
      }
    }
    if (!zohoBillId) {
      const accountId = Deno.env.get("ZOHO_PAYOUT_ACCOUNT_ID");
      const accountName = Deno.env.get("ZOHO_PAYOUT_ACCOUNT_NAME");
      let lineAccount: Record<string, unknown>;
      if (accountId) lineAccount = { account_id: accountId };
      else {
        try { lineAccount = { account_id: await zohoResolveExpenseAccount(token) }; }
        catch (error) {
          if (accountName) lineAccount = { account_name: accountName };
          else throw error;
        }
      }
      const result = await zohoApi(token, "POST", "/bills", {
        vendor_id: vendorId,
        bill_number: `AP-${billId.slice(0, 8).toUpperCase()}`,
        reference_number: billId,
        date: bill.period_end,
        line_items: [{
          ...lineAccount,
          name: `Academic partner payout · ${partner.company_name || partner.name}`,
          description: `Confirmed fee receipts from ${bill.period_start} to ${bill.period_end} (${bill.payout_count} receipts)`,
          rate: Number(bill.amount),
          quantity: 1,
        }],
        notes: `UniOs academic partner payout · ${partner.name} · ${bill.period_start} to ${bill.period_end}`,
      });
      if (!result.ok) throw new Error(`Zoho bill creation failed: ${JSON.stringify(result.data)}`);
      zohoBillId = result.data.bill.bill_id;
      zohoBillNumber = result.data.bill.bill_number;
    }

    const syncedAt = new Date().toISOString();
    const { error: updateError } = await admin.from("academic_partner_bills").update({
      status: "synced_to_zoho",
      zoho_bill_id: zohoBillId,
      zoho_bill_number: zohoBillNumber,
      zoho_synced_at: syncedAt,
      zoho_sync_error: null,
    }).eq("id", billId);
    if (updateError) throw updateError;
    await admin.from("academic_partner_payouts").update({
      zoho_bill_id: zohoBillId,
      zoho_bill_number: zohoBillNumber,
      zoho_synced_at: syncedAt,
      zoho_sync_error: null,
    }).eq("bill_id", billId);
    return json({ ok: true, zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber });
  } catch (error) {
    const message = String(error).slice(0, 500);
    try {
      const body = await req.clone().json();
      if (body?.bill_id) {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
        await admin.from("academic_partner_bills").update({ zoho_sync_error: message }).eq("id", body.bill_id);
      }
    } catch { /* keep the original error response */ }
    return json({ error: message }, 502);
  }
});

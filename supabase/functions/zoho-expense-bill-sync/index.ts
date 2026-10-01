// zoho-expense-bill-sync (auth required — super admin / expense final approver)
//
// Sync approved employee expense claims to Zoho Books as vendor bills — the same
// pattern as zoho-video-bill-sync, but the "vendor" is the employee and the bill
// is the reimbursement. No TDS on employee reimbursements.
//
// Actions:
//   create_bill     : ensure the employee is a Zoho vendor, create a Bill for the
//                     approved claim, attach proofs, store Zoho ids back.
//   record_payment  : record a Vendor Payment against the claim's Zoho bill
//                     (used for the direct-Zoho reimbursement path).
//   find_vendors    : search Zoho vendors (for the link/relink picker).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  zohoConfigured, zohoAccessToken, zohoApi, zohoAttach, zohoSearchVendors,
  zohoResolveExpenseAccount, zohoAddVendorBankAccount, zohoVendorHasBank,
  type ZohoVendorCandidate,
} from "../_shared/zoho.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const { data: canFinal } = await admin.rpc("has_permission", {
      _user_id: uid, _perm: "hr:expenses_final_approve",
    });
    if (!canFinal) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const claimId: string = body.claim_id;
    const action: string = body.action || "create_bill";

    if (action === "find_vendors") {
      const token = await zohoAccessToken();
      const candidates = await zohoSearchVendors(token, { phone: body.phone, query: body.query });
      return json({ candidates });
    }

    if (!claimId) return json({ error: "claim_id required" }, 400);

    const { data: claim } = await admin.from("expense_claims").select("*").eq("id", claimId).maybeSingle();
    if (!claim) return json({ error: "Expense claim not found" }, 404);

    const { data: emp } = await admin
      .from("employee_profiles")
      .select("id, display_name, first_name, last_name, mobile_number, work_email, personal_email, zoho_vendor_id")
      .eq("id", claim.employee_profile_id)
      .maybeSingle();
    if (!emp) return json({ error: "Employee not found" }, 404);

    const { data: bank } = await admin
      .from("employee_bank_details")
      .select("account_holder_name, account_number, ifsc, bank_name")
      .eq("employee_profile_id", emp.id)
      .maybeSingle();

    const employeeName =
      (emp.display_name && emp.display_name.trim()) ||
      [emp.first_name, emp.last_name].filter(Boolean).join(" ") || "Employee";

    const token = await zohoAccessToken();

    type EnsureVendorResult = { vendorId: string } | { needsChoice: true; candidates: ZohoVendorCandidate[] };
    const linkVendor = async (vendorId: string) => {
      if (vendorId !== emp.zoho_vendor_id) {
        await admin.from("employee_profiles").update({ zoho_vendor_id: vendorId }).eq("id", emp.id);
      }
    };
    const ensureVendor = async (): Promise<EnsureVendorResult> => {
      if (body.vendor_id) { await linkVendor(body.vendor_id); return { vendorId: body.vendor_id }; }
      if (body.force_create_vendor) {
        const res = await zohoApi(token, "POST", "/contacts", {
          contact_name: employeeName,
          contact_type: "vendor",
          phone: emp.mobile_number || undefined,
          email: emp.work_email || emp.personal_email || undefined,
        });
        if (!res.ok) throw new Error(`vendor create failed: ${JSON.stringify(res.data)}`);
        const vendorId = res.data.contact.contact_id;
        await linkVendor(vendorId);
        return { vendorId };
      }
      if (emp.zoho_vendor_id && !body.relink) return { vendorId: emp.zoho_vendor_id };
      const candidates = emp.mobile_number ? await zohoSearchVendors(token, { phone: emp.mobile_number }) : [];
      return { needsChoice: true, candidates };
    };

    if (action === "create_bill") {
      try {
        const vendor = await ensureVendor();
        if ("needsChoice" in vendor) return json({ needs_vendor_choice: true, candidates: vendor.candidates });
        const vendorId = vendor.vendorId;

        // Push bank details onto the vendor once (no TDS, but payments go to bank).
        if (bank?.account_number) {
          try {
            const hasBank = await zohoVendorHasBank(token, vendorId);
            if (!hasBank) {
              await zohoAddVendorBankAccount(token, vendorId, {
                account_name: bank.account_holder_name || employeeName,
                account_number: bank.account_number,
                ifsc: bank.ifsc,
                bank_name: bank.bank_name,
              });
            }
          } catch (e) {
            console.error("[zoho-expense] bank push failed", e);
          }
        }

        let zohoBillId = claim.zoho_bill_id;
        let zohoBillNumber = claim.zoho_bill_number;

        if (!zohoBillId) {
          const existing = await zohoApi(token, "GET", "/bills", undefined, { reference_number: claimId });
          const found = existing.ok ? (existing.data?.bills || [])[0] : null;
          if (found) { zohoBillId = found.bill_id; zohoBillNumber = found.bill_number; }
        }

        if (!zohoBillId) {
          const acctId = Deno.env.get("ZOHO_EXPENSE_ACCOUNT_ID") || Deno.env.get("ZOHO_PAYOUT_ACCOUNT_ID");
          const acctName = Deno.env.get("ZOHO_EXPENSE_ACCOUNT_NAME") || Deno.env.get("ZOHO_PAYOUT_ACCOUNT_NAME");
          let lineAccount: Record<string, unknown>;
          if (acctId) lineAccount = { account_id: acctId };
          else {
            try { lineAccount = { account_id: await zohoResolveExpenseAccount(token) }; }
            catch (e) { if (acctName) lineAccount = { account_name: acctName }; else throw e; }
          }

          const res = await zohoApi(token, "POST", "/bills", {
            vendor_id: vendorId,
            bill_number: `ER-${claimId.slice(0, 8).toUpperCase()}`,
            reference_number: claimId,
            date: claim.expense_date,
            line_items: [{
              ...lineAccount,
              name: `${claim.title}`,
              description: claim.description || `Expense reimbursement · ${employeeName}`,
              rate: Number(claim.amount),
              quantity: 1,
            }],
            notes: `UniOs expense reimbursement · ${employeeName} · claim ${claimId.slice(0, 8)}`,
          });
          if (!res.ok) throw new Error(`bill create failed: ${JSON.stringify(res.data)}`);
          zohoBillId = res.data.bill.bill_id;
          zohoBillNumber = res.data.bill.bill_number;
        }

        // Attach proofs (public R2/S3 URLs fetched server-side).
        try {
          const { data: atts } = await admin
            .from("expense_claim_attachments")
            .select("file_url, file_name")
            .eq("claim_id", claimId);
          for (const a of atts || []) {
            if (!a.file_url) continue;
            const fileRes = await fetch(a.file_url);
            if (!fileRes.ok) continue;
            const bytes = new Uint8Array(await fileRes.arrayBuffer());
            await zohoAttach(token, `/bills/${zohoBillId}/attachment`, a.file_name || `proof-${claimId.slice(0, 6)}`, bytes);
          }
        } catch (e) {
          console.error("[zoho-expense] proof attach failed", e);
        }

        await admin.from("expense_claims").update({
          zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber,
          zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", claimId);

        return json({ ok: true, zoho_bill_id: zohoBillId, zoho_bill_number: zohoBillNumber });
      } catch (e) {
        await admin.from("expense_claims").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", claimId);
        return json({ error: String(e) }, 502);
      }
    }

    if (action === "record_payment") {
      if (!claim.zoho_bill_id) return json({ error: "No Zoho bill for this claim — create the bill first." }, 400);
      try {
        const vendor = await ensureVendor();
        if ("needsChoice" in vendor) return json({ needs_vendor_choice: true, candidates: vendor.candidates });
        const res = await zohoApi(token, "POST", "/vendorpayments", {
          vendor_id: vendor.vendorId,
          payment_mode: "banktransfer",
          amount: Number(claim.amount),
          date: claim.reimbursed_at ? new Date(claim.reimbursed_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          bills: [{ bill_id: claim.zoho_bill_id, amount_applied: Number(claim.amount) }],
        });
        if (!res.ok) throw new Error(`vendor payment failed: ${JSON.stringify(res.data)}`);
        await admin.from("expense_claims").update({
          zoho_payment_id: res.data.vendorpayment?.payment_id,
          zoho_synced_at: new Date().toISOString(), zoho_sync_error: null,
        }).eq("id", claimId);
        return json({ ok: true, zoho_payment_id: res.data.vendorpayment?.payment_id });
      } catch (e) {
        await admin.from("expense_claims").update({ zoho_sync_error: String(e).slice(0, 500) }).eq("id", claimId);
        return json({ error: String(e) }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

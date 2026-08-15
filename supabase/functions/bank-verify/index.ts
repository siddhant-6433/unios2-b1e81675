// bank-verify (auth required — staff only)
//
// Shared bank-detail validation for all three payee types (consultants,
// employees, video editors). Two tiers:
//   1. IFSC — regex + free Razorpay public IFSC lookup (bank + branch). Always
//      available, no RazorpayX needed.
//   2. Name — RazorpayX Fund-Account validation (penny-drop) returns the
//      registered account-holder name + a match verdict. Gated behind
//      RAZORPAYX_VALIDATION_ENABLED; degrades to status "unavailable" when off.
//
// The caller (BankDetailsFields) folds the result into its own save — this fn
// is a stateless verification oracle and writes nothing.
//
// Input:  { account_number, ifsc, name? }
// Output: { ifsc_valid, bank, branch, verification: { status, registered_name, ... } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { razorpayxValidateBankAccount } from "../_shared/razorpayx.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STAFF_ROLES = new Set(["super_admin", "campus_admin", "admission_head"]);
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Free, no-auth IFSC lookup. Returns { bank, branch } or null (404 = invalid).
async function ifscLookup(ifsc: string): Promise<{ bank: string; branch: string } | null> {
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    if (!d) return null;
    return { bank: d.BANK || d.BANKCODE || "", branch: d.BRANCH || "" };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
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
    const accountNumber: string = (body.account_number || "").trim();
    const ifsc: string = (body.ifsc || "").trim().toUpperCase();
    const name: string = (body.name || "").trim();

    if (!IFSC_RE.test(ifsc)) return json({ ifsc_valid: false, error: "Invalid IFSC format" }, 200);

    const lookup = await ifscLookup(ifsc);
    const ifscValid = lookup !== null;

    // Name verification only if we have an account number to check.
    let verification = { status: "skipped" as string, registered_name: null as string | null, ref: null as string | null, raw_status: null as string | null };
    if (accountNumber) {
      verification = await razorpayxValidateBankAccount(accountNumber, ifsc, name);
    }

    return json({
      ifsc_valid: ifscValid,
      bank: lookup?.bank || null,
      branch: lookup?.branch || null,
      verification,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

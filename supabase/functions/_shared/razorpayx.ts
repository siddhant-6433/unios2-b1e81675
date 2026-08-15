// Shared RazorpayX client for bank-account (fund-account) name verification.
//
// Uses the SAME Razorpay key pair already configured for payment collection
// (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET), but the Fund-Account Validation API
// is a RazorpayX product: it must be activated, IP-allowlisted, and does NOT
// work in test mode. We gate on RAZORPAYX_VALIDATION_ENABLED so the caller can
// dark-launch — when off/unconfigured, callers fall back to the free IFSC
// lookup and report name-verification as "unavailable".
//
// Flow (docs: razorpay.com/docs/api/x/account-validation):
//   1. POST /v1/contacts        -> contact_id
//   2. POST /v1/fund_accounts   -> fund_account_id (bank_account + ifsc)
//   3. POST /v1/fund_accounts/validations -> results.registered_name + status

const API = "https://api.razorpay.com/v1";

export function razorpayxConfigured(): boolean {
  return Boolean(
    Deno.env.get("RAZORPAY_KEY_ID") &&
    Deno.env.get("RAZORPAY_KEY_SECRET") &&
    Deno.env.get("RAZORPAYX_VALIDATION_ENABLED") === "true",
  );
}

function authHeader(): string {
  const id = Deno.env.get("RAZORPAY_KEY_ID") || "";
  const secret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
  return "Basic " + btoa(`${id}:${secret}`);
}

type RzpResult = { ok: boolean; status: number; data: any };

async function rzp(method: string, path: string, body?: Record<string, unknown>): Promise<RzpResult> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export type BankValidation = {
  status: "verified" | "mismatch" | "failed" | "unavailable";
  registered_name: string | null;
  ref: string | null;   // validation id
  raw_status: string | null; // razorpay account_status: active / invalid
};

// Normalize a name for fuzzy comparison: uppercase, strip punctuation, collapse
// spaces, drop common salutations. Returns a token set.
function nameTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toUpperCase()
      .replace(/\b(MR|MRS|MS|DR|SHRI|SMT|M\/S)\b/g, " ")
      .replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

// Token-overlap ratio (Jaccard-ish, biased to the entered name). No new deps.
export function nameMatchScore(entered: string, registered: string): number {
  const a = nameTokens(entered);
  const b = nameTokens(registered);
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return Math.round((hit / a.size) * 100);
}

// Full 3-step validation. `name` is the entered/expected holder name (used only
// for the match verdict — the registered name always comes from the bank).
export async function razorpayxValidateBankAccount(
  accountNumber: string,
  ifsc: string,
  name: string,
): Promise<BankValidation> {
  const unavailable: BankValidation = { status: "unavailable", registered_name: null, ref: null, raw_status: null };
  if (!razorpayxConfigured()) return unavailable;

  try {
    const contact = await rzp("POST", "/contacts", { name: name || "Payee", type: "vendor" });
    if (!contact.ok) return { ...unavailable, status: "failed" };

    const fa = await rzp("POST", "/fund_accounts", {
      contact_id: contact.data.id,
      account_type: "bank_account",
      bank_account: { name: name || "Payee", ifsc, account_number: accountNumber },
    });
    if (!fa.ok) return { ...unavailable, status: "failed" };

    const val = await rzp("POST", "/fund_accounts/validations", {
      fund_account: { id: fa.data.id },
      amount: 100,
      currency: "INR",
    });
    if (!val.ok) return { ...unavailable, status: "failed" };

    const results = val.data?.results || {};
    const registered = results.registered_name || null;
    const rawStatus = val.data?.status || results.account_status || null; // completed/active/invalid
    const accountActive = ["active", "completed"].includes(String(rawStatus).toLowerCase())
      || String(results.account_status).toLowerCase() === "active";

    if (!accountActive && !registered) return { status: "failed", registered_name: null, ref: val.data?.id || null, raw_status: rawStatus };

    const score = registered ? nameMatchScore(name, registered) : 0;
    return {
      status: score >= 70 ? "verified" : "mismatch",
      registered_name: registered,
      ref: val.data?.id || null,
      raw_status: rawStatus,
    };
  } catch (_e) {
    return { ...unavailable, status: "failed" };
  }
}

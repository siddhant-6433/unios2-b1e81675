// Shared Zoho Books client. India data center by default (books.zoho.in);
// override with ZOHO_ACCOUNTS_DOMAIN / ZOHO_API_DOMAIN for other regions.
//
// Secrets (set via `supabase secrets set ...`):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID
//   ZOHO_ACCOUNTS_DOMAIN (default accounts.zoho.in)
//   ZOHO_API_DOMAIN      (default www.zohoapis.in)
//   ZOHO_WEBHOOK_SECRET  (shared secret you also put in the Zoho webhook URL)

const ACCOUNTS = Deno.env.get("ZOHO_ACCOUNTS_DOMAIN") || "accounts.zoho.in";
const API = Deno.env.get("ZOHO_API_DOMAIN") || "www.zohoapis.in";

export function zohoConfigured(): boolean {
  return Boolean(
    Deno.env.get("ZOHO_CLIENT_ID") && Deno.env.get("ZOHO_CLIENT_SECRET") &&
    Deno.env.get("ZOHO_REFRESH_TOKEN") && Deno.env.get("ZOHO_ORG_ID"),
  );
}

export function zohoOrgId(): string {
  return Deno.env.get("ZOHO_ORG_ID") || "";
}

// Exchange the (non-expiring) refresh token for a 1-hour access token.
export async function zohoAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: Deno.env.get("ZOHO_REFRESH_TOKEN") || "",
    client_id: Deno.env.get("ZOHO_CLIENT_ID") || "",
    client_secret: Deno.env.get("ZOHO_CLIENT_SECRET") || "",
    grant_type: "refresh_token",
  });
  const res = await fetch(`https://${ACCOUNTS}/oauth/v2/token?${params.toString()}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

type ZohoResult = { ok: boolean; status: number; data: any };

// Books API call. `path` starts with "/" (e.g. "/contacts"); organization_id is
// appended automatically. Pass a plain object as body for JSON POST/PUT.
export async function zohoApi(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraQuery: Record<string, string> = {},
): Promise<ZohoResult> {
  const q = new URLSearchParams({ organization_id: zohoOrgId(), ...extraQuery });
  const url = `https://${API}/books/v3${path}?${q.toString()}`;
  const init: RequestInit = {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  };
  if (body !== undefined) {
    // Zoho Books expects the JSON under a `JSONString` form field.
    const form = new FormData();
    form.append("JSONString", JSON.stringify(body));
    init.body = form;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.code === 0, status: res.status, data };
}

// Multipart attachment upload (e.g. the payout slip PDF) to a bill.
export async function zohoAttach(
  token: string,
  path: string,
  fileName: string,
  bytes: Uint8Array,
  contentType = "application/pdf",
): Promise<ZohoResult> {
  const q = new URLSearchParams({ organization_id: zohoOrgId() });
  const url = `https://${API}/books/v3${path}?${q.toString()}`;
  const form = new FormData();
  form.append("attachment", new Blob([bytes], { type: contentType }), fileName);
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${token}` }, body: form });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.code === 0, status: res.status, data };
}

// Add a bank account to a vendor (India: routing_number carries the IFSC).
// Best-effort — connected-banking orgs may require the account number encrypted;
// the caller treats a failure as non-fatal and surfaces res.data for debugging.
export async function zohoAddVendorBankAccount(
  token: string,
  contactId: string,
  bank: { bank_name?: string | null; account_number?: string | null; ifsc?: string | null; account_holder?: string | null; account_type?: string | null },
): Promise<ZohoResult> {
  return zohoApi(token, "POST", `/contacts/${contactId}/bankaccount`, {
    beneficiary_name: bank.account_holder || undefined,
    bank_name: bank.bank_name || undefined,
    account_number: bank.account_number || undefined,
    re_account_number: bank.account_number || undefined,
    routing_number: bank.ifsc || undefined,
    ifsc: bank.ifsc || undefined,
    account_type: (bank.account_type || "current"),
    is_primary_account: true,
  });
}

// Resolve the expense account to book the payout against (required on bill lines).
// Prefer ZOHO_PAYOUT_ACCOUNT_ID; else match ZOHO_PAYOUT_ACCOUNT_NAME by name; else
// the first active expense account.
export async function zohoResolveExpenseAccount(token: string): Promise<string> {
  const res = await zohoApi(token, "GET", "/chartofaccounts");
  if (!res.ok) throw new Error(`chartofaccounts read failed (grant scope may lack ZohoBooks.settings.READ): ${JSON.stringify(res.data)}`);
  const accounts: any[] = res.data?.chartofaccounts || [];
  const wantName = (Deno.env.get("ZOHO_PAYOUT_ACCOUNT_NAME") || "").toLowerCase();
  const expenseTypes = new Set(["expense", "cost_of_goods_sold", "other_expense"]);
  const expenses = accounts.filter((a) => expenseTypes.has(a.account_type) && a.is_active !== false);
  if (wantName) {
    const named = (expenses.length ? expenses : accounts).find((a) => (a.account_name || "").toLowerCase().includes(wantName));
    if (named) return named.account_id;
  }
  if (expenses[0]?.account_id) return expenses[0].account_id;
  throw new Error(`no expense account among ${accounts.length} accounts; set ZOHO_PAYOUT_ACCOUNT_NAME or ZOHO_PAYOUT_ACCOUNT_ID`);
}

// Does the vendor already have a bank account? (dedupe before adding one)
export async function zohoVendorHasBank(token: string, contactId: string): Promise<boolean> {
  const res = await zohoApi(token, "GET", `/contacts/${contactId}/bankaccount`);
  const arr = res.data?.bank_accounts || res.data?.banks || [];
  return Array.isArray(arr) && arr.length > 0;
}

// Find an existing vendor by phone; returns contact_id or null.
export async function zohoFindVendorByPhone(token: string, phone: string): Promise<string | null> {
  const digits = (phone || "").replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return null;
  const res = await zohoApi(token, "GET", "/contacts", undefined, { search_text: digits, contact_type: "vendor" });
  const contacts: any[] = res.data?.contacts || [];
  const match = contacts.find((c) =>
    [c.phone, c.mobile].some((p: string) => (p || "").replace(/\D/g, "").slice(-10) === digits),
  );
  return match?.contact_id || null;
}

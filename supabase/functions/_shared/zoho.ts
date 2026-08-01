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

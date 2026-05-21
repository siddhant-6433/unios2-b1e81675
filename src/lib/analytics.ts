/**
 * Browser-side GA4 + attribution helpers for the apply portal.
 *
 * The SAME React SPA serves both the apply portal and the internal CRM.
 * The gtag + Meta Pixel snippet in index.html only initializes trackers
 * on applicant-facing surfaces:
 *   - apply.nimt.ac.in (any path)
 *   - uni.nimt.ac.in/apply/*  (the nimt.ac.in "Apply Now" buttons link here)
 * On every other host/path the trackers are not loaded, so window.gtag /
 * window.fbq are undefined and the helpers below all no-op.
 *
 * Usage:
 *   import { trackGenerateLead, captureAttribution } from "@/lib/analytics";
 *
 *   const attribution = captureAttribution();           // call once at form load
 *   await supabase.rpc("upsert_application_lead", { ...form, ...attribution });
 *   trackGenerateLead({ value: 0 });                    // browser-side `generate_lead`
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export const APPLY_MEASUREMENT_ID = "G-MKHMKH1DE9";

/**
 * Per-brand Meta Pixel IDs. Each brand has its own ad account, so the snippet
 * in index.html resolves the matching pixel from the `/apply/{brand}` path
 * segment and inits only that one. Exported for reference / docs — the
 * helpers below don't pick a pixel, they just dispatch through window.fbq.
 */
export const PORTAL_PIXEL_IDS = {
  nimt:   "2580313152286928",
  beacon: "511947283685367",
  mirai:  "1461957365199748",
} as const;

// Cookie reader. Returns undefined for missing cookies.
function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = ("; " + document.cookie).split("; " + name + "=");
  if (match.length < 2) return undefined;
  return match.pop()?.split(";").shift() || undefined;
}

// _ga cookie format: "GA1.2.<client_id>.<created_ts>". client_id = part 3+4 joined.
function parseGaClientId(): string | undefined {
  const raw = readCookie("_ga");
  if (!raw) return undefined;
  const parts = raw.split(".");
  if (parts.length < 4) return undefined;
  return parts[2] + "." + parts[3];
}

// _ga_<MID> cookie format: "GS1.1.<session_id>.<count>.<eng>.<ts>.<...>"
function parseGaSessionId(measurementId: string): string | undefined {
  const cookieName = "_ga_" + measurementId.replace(/^G-/, "");
  const raw = readCookie(cookieName);
  if (!raw) return undefined;
  const parts = raw.split(".");
  return parts[2];
}

// Meta's documented _fbc synthesis when a `fbclid` URL param is present
// but the Pixel hasn't written the _fbc cookie yet (first page load after
// the click). Format: "fb.<subdomain_idx>.<creation_ts_ms>.<fbclid>".
// subdomain_idx is 1 for a host like apply.nimt.ac.in (single subdomain
// before the eTLD); 0 for nimt.ac.in; 2 for a.b.example.com. Stays compatible
// with what the Pixel itself would write.
function readOrSynthesizeFbc(): string | undefined {
  const cookie = readCookie("_fbc");
  if (cookie) return cookie;
  const fbclid = new URLSearchParams(window.location.search).get("fbclid");
  if (!fbclid) return undefined;
  // Count subdomains: hostname split by ".", minus the eTLD+1 (last 2 parts
  // for .com/.in/etc; doesn't handle .co.uk-style ccTLDs but we don't run
  // on those).
  const parts = window.location.hostname.split(".");
  const subdomainIdx = Math.max(0, parts.length - 2);
  return `fb.${subdomainIdx}.${Date.now()}.${fbclid}`;
}

function readFbp(): string | undefined {
  return readCookie("_fbp");
}

export interface AttributionPayload {
  _ga_client_id?: string;
  _ga_session_id?: string;
  _gclid?: string;
  _utm_source?: string;
  _utm_medium?: string;
  _utm_campaign?: string;
  _utm_term?: string;
  _utm_content?: string;
  _landing_page?: string;
  _referrer?: string;
  _origin_domain?: string;
  // Meta CAPI attribution — captured for the server-side Conversions API
  // relay so events from blocked browsers still reach Meta with high
  // Match Quality. See supabase/functions/meta-capi-events/index.ts.
  _fbc?: string;
  _fbp?: string;
  _portal_brand?: string;
}

// v2 = added _fbc/_fbp/_portal_brand. Bumping the version invalidates any
// stale v1 snapshots so the new fields populate on next visit.
const STORAGE_KEY = "uni_attribution_v2";

/**
 * Captures GA client_id, gclid, UTM params, landing page, referrer, and
 * Meta CAPI fields (fbc/fbp/portal_brand).
 *
 * On first visit: reads from URL + cookies and persists to localStorage.
 * On subsequent visits: returns the stored snapshot — preserves first-touch
 * attribution across the multi-page apply flow even if the user navigates
 * back to a UTM-less URL (e.g. clicked a Google ad once, then refreshed).
 *
 * `portalBrand` should be passed by callers that know the brand (after
 * detectPortal() has run). When omitted, the stored value is kept.
 *
 * Returns the param shape the upsert_application_lead RPC expects.
 */
export function captureAttribution(portalBrand?: string): AttributionPayload {
  if (typeof window === "undefined") return {};

  // Restore prior snapshot if it exists
  let stored: AttributionPayload = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as AttributionPayload;
  } catch {
    // localStorage may be blocked (incognito, embedded webviews) — fall through
  }

  // Read fresh values from this page load
  const url = new URL(window.location.href);
  const fresh: AttributionPayload = {
    _ga_client_id:  parseGaClientId(),
    _ga_session_id: parseGaSessionId(APPLY_MEASUREMENT_ID),
    _gclid:         url.searchParams.get("gclid")        || undefined,
    _utm_source:    url.searchParams.get("utm_source")   || undefined,
    _utm_medium:    url.searchParams.get("utm_medium")   || undefined,
    _utm_campaign:  url.searchParams.get("utm_campaign") || undefined,
    _utm_term:      url.searchParams.get("utm_term")     || undefined,
    _utm_content:   url.searchParams.get("utm_content")  || undefined,
    _landing_page:  stored._landing_page || window.location.pathname + window.location.search,
    _referrer:      stored._referrer || (document.referrer || undefined),
    _origin_domain: stored._origin_domain || window.location.hostname,
    _fbc:           readOrSynthesizeFbc(),
    _fbp:           readFbp(),
    _portal_brand:  portalBrand,
  };

  // Merge: prefer fresh URL params (last-touch override) but fall back to
  // stored values when fresh ones are absent. Cookies are always fresh
  // because gtag refreshes them every page load.
  const merged: AttributionPayload = {
    _ga_client_id:  fresh._ga_client_id  || stored._ga_client_id,
    _ga_session_id: fresh._ga_session_id || stored._ga_session_id,
    _gclid:         fresh._gclid         || stored._gclid,
    _utm_source:    fresh._utm_source    || stored._utm_source,
    _utm_medium:    fresh._utm_medium    || stored._utm_medium,
    _utm_campaign:  fresh._utm_campaign  || stored._utm_campaign,
    _utm_term:      fresh._utm_term      || stored._utm_term,
    _utm_content:   fresh._utm_content   || stored._utm_content,
    _landing_page:  fresh._landing_page,
    _referrer:      fresh._referrer,
    _origin_domain: fresh._origin_domain,
    // First-touch fbc (preserve the original click attribution); always-fresh fbp
    // (the cookie is rewritten by the Pixel every page load anyway).
    _fbc:           stored._fbc || fresh._fbc,
    _fbp:           fresh._fbp || stored._fbp,
    _portal_brand:  fresh._portal_brand || stored._portal_brand,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // intentional swallow
  }

  return merged;
}

// ─── gtag helpers ──────────────────────────────────────────────────────

function gtagSafe(): ((...args: unknown[]) => void) | undefined {
  return typeof window !== "undefined" ? window.gtag : undefined;
}

export function trackEvent(eventName: string, params?: Record<string, unknown>) {
  const gtag = gtagSafe();
  if (!gtag) return;
  gtag("event", eventName, params || {});
}

export function trackGenerateLead(params?: { value?: number; program?: string; source?: string }) {
  trackEvent("generate_lead", {
    currency: "INR",
    ...(params?.value !== undefined ? { value: params.value } : {}),
    ...(params?.program ? { program: params.program } : {}),
    ...(params?.source ? { lead_source: params.source } : {}),
  });
}

/**
 * Fired browser-side when an application fee payment confirms in the same
 * session (e.g. user just returned from Easebuzz). The DB trigger ALSO fires
 * `purchase` server-side via Measurement Protocol — GA dedupes by
 * transaction_id, so passing the same id from both sides is safe and gives
 * us cross-device coverage.
 */
export function trackApplicationFeePurchase(transactionId: string, amount: number) {
  trackEvent("purchase", {
    transaction_id: transactionId,
    value: amount,
    currency: "INR",
    items: [{ item_name: "application_fee", price: amount, quantity: 1 }],
  });
}

// ─── Meta Pixel helpers ────────────────────────────────────────────────
// The Pixel base code in index.html only initializes fbq on applicant-facing
// surfaces (see the header doc-comment). Outside those, window.fbq is
// undefined and these calls are no-ops. The pixel ID is bound at init time
// based on the /apply/{brand} segment, so all events from a session flow
// into the matching brand's ad account.

function fbqSafe(): ((...args: unknown[]) => void) | undefined {
  return typeof window !== "undefined" ? window.fbq : undefined;
}

// Shared event_id factories — the SAME ids are produced by the CAPI
// trigger functions in 20260613122000_meta_capi_triggers.sql. Meta dedupes
// on (pixel_id, event_name, event_id) inside a ~7-day window so browser
// + CAPI fires of the same conversion count once. Whenever you change one
// side, change the other.
export const pixelEventId = {
  lead:                 (leadId: string)        => `lead_${leadId}`,
  completeRegistration: (applicationId: string) => `reg_${applicationId}`,
};

export function trackPixelLead(params: {
  leadId: string;
  program?: string;
  source?: string;
}) {
  const fbq = fbqSafe();
  if (!fbq) return;
  fbq("track", "Lead", {
    currency: "INR",
    ...(params.program ? { content_name: params.program, content_category: "application" } : {}),
    ...(params.source ? { lead_source: params.source } : {}),
  }, { eventID: pixelEventId.lead(params.leadId) });
}

export function trackPixelCompleteRegistration(applicationId: string, amount: number) {
  const fbq = fbqSafe();
  if (!fbq) return;
  fbq("track", "CompleteRegistration", {
    currency: "INR",
    value: amount,
    content_name: "application_fee",
    status: "paid",
  }, { eventID: pixelEventId.completeRegistration(applicationId) });
}

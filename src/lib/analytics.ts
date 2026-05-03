/**
 * Browser-side GA4 + attribution helpers for the apply portal.
 *
 * The apply portal is hosted at apply.nimt.ac.in but the SAME React SPA
 * also serves the internal CRM (uni.nimt.ac.in). The gtag snippet in
 * index.html only configures the GA4 stream when window.location.hostname
 * matches APPLY_HOST, so admin users don't get tracked.
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
  }
}

export const APPLY_HOST = "apply.nimt.ac.in";
export const APPLY_MEASUREMENT_ID = "G-MKHMKH1DE9";

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
}

const STORAGE_KEY = "uni_attribution_v1";

/**
 * Captures GA client_id, gclid, UTM params, landing page, and referrer.
 *
 * On first visit: reads from URL + cookies and persists to localStorage.
 * On subsequent visits: returns the stored snapshot — preserves first-touch
 * attribution across the multi-page apply flow even if the user navigates
 * back to a UTM-less URL (e.g. clicked a Google ad once, then refreshed).
 *
 * Returns the param shape the upsert_application_lead RPC expects.
 */
export function captureAttribution(): AttributionPayload {
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

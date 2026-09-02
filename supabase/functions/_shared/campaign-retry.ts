// Failure classification + backoff for WhatsApp bulk sends.
//
// Three classes, because they need very different treatment:
//
//   fatigue  131049 — Meta's PER-RECIPIENT marketing cap. Meta limits a user to
//                     roughly two marketing templates per 24h ACROSS ALL
//                     businesses. This is not a transient API error: retrying
//                     inside the window re-hits a fatigued user and feeds the
//                     block/report signal that caused it. Meta's guidance is to
//                     wait at least 24h, and to stop targeting repeat offenders.
//   throttle 131048/131056/130429/80007 — genuine rate limits against OUR
//                     number. Short backoff is correct; the send will succeed
//                     once the window clears.
//   infra    5xx, timeouts, network blips, 133016, 368, 131000.
//
// Everything else (invalid recipient 131026, template errors 132xxx, bad params
// 100, billing 131042) fails immediately. Kept pure and dependency-free so it
// can be unit-tested without spinning up the edge runtime.

export const MAX_SEND_RETRIES = 5;

/** Fatigue retries are nearly pointless — cap them far below the infra budget. */
export const MAX_FATIGUE_RETRIES = 2;

// Meta's per-recipient marketing frequency cap.
export const FATIGUE_META_CODES = new Set<number>([131049]);

// Rate limits against our own number — short backoff, will clear.
export const THROTTLE_META_CODES = new Set<number>([131048, 131056, 130429, 80007]);

// Transient infrastructure / temporary-state codes.
export const INFRA_META_CODES = new Set<number>([
  133016, // account being restored — retry shortly
  368,    // temporarily blocked for policy (usually clears)
  131000, // generic "something went wrong"
]);

/**
 * Account-level failures: nothing about the recipient will fix these, and every
 * subsequent send in the batch will fail identically. The worker uses this to
 * pause the campaign instead of burning the whole audience — on 2026-09-01 a
 * billing block (131042) consumed 402 sends that could never have landed.
 */
export const ACCOUNT_LEVEL_META_CODES = new Set<number>([
  131042, // business eligibility / payment issue
  133010, // phone number not registered
  190,    // access token expired
]);

export type RetryClass = "fatigue" | "throttle" | "infra" | null;

export const isFatigueCode = (code: number | null | undefined): boolean =>
  code != null && FATIGUE_META_CODES.has(code);

export const isThrottleCode = (code: number | null | undefined): boolean =>
  code != null && THROTTLE_META_CODES.has(code);

export const isAccountLevelCode = (code: number | null | undefined): boolean =>
  code != null && ACCOUNT_LEVEL_META_CODES.has(code);

/** Which retry curve applies, or null when the failure is permanent. */
export function classifyFailure(
  code: number | null | undefined,
  httpStatus: number,
  message: string,
): RetryClass {
  if (isFatigueCode(code)) return "fatigue";
  if (isThrottleCode(code)) return "throttle";
  if (code != null && INFRA_META_CODES.has(code)) return "infra";
  // An account-level code must never be rescued by the message regex below —
  // "rate limit" wording in a billing error would otherwise loop forever.
  if (isAccountLevelCode(code)) return null;
  if (httpStatus >= 500) return "infra";
  if (/timeout|abort|network|econnreset|fetch failed|throttl|rate limit/i.test(message || "")) {
    return "infra";
  }
  return null;
}

export function isTransientFailure(
  code: number | null | undefined,
  httpStatus: number,
  message: string,
): boolean {
  return classifyFailure(code, httpStatus, message) !== null;
}

/** Retry budget for a class — fatigue gets far fewer attempts. */
export function maxRetriesFor(cls: RetryClass): number {
  return cls === "fatigue" ? MAX_FATIGUE_RETRIES : MAX_SEND_RETRIES;
}

export function retryBackoffMs(priorRetries: number, cls: RetryClass): number {
  // fatigue: a full day minimum — anything shorter re-hits the same cap.
  if (cls === "fatigue") {
    const base = 24 * 60 * 60 * 1000;
    const cap = 72 * 60 * 60 * 1000;
    return Math.min(base * Math.pow(2, priorRetries), cap);
  }
  const throttle = cls === "throttle";
  const base = throttle ? 15 * 60 * 1000 : 2 * 60 * 1000;    // 15m vs 2m
  const cap = throttle ? 6 * 60 * 60 * 1000 : 30 * 60 * 1000; // 6h vs 30m
  return Math.min(base * Math.pow(2, priorRetries), cap);
}

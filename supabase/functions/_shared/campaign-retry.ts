// Failure classification + backoff for WhatsApp bulk sends.
//
// Transient failures (ecosystem throttle 131049, rate limits, 5xx, network
// blips) are requeued with backoff instead of being burned into a terminal
// `failed` bucket; everything else (invalid recipient 131026, template errors
// 132xxx, bad params 100) fails immediately. Kept pure and dependency-free so
// it can be unit-tested without spinning up the edge runtime.

export const MAX_SEND_RETRIES = 5;

// Meta error codes worth retrying.
export const TRANSIENT_META_CODES = new Set<number>([
  131049, // per-recipient ecosystem-engagement throttle
  131048, // spam rate limit hit
  131056, // business/consumer pair rate limit hit
  130429, // Cloud API rate limit hit
  133016, // account being restored — retry shortly
  80007,  // rate limit hit
  368,    // temporarily blocked for policy (usually clears)
  131000, // generic "something went wrong"
]);

// Quality/rate throttles need a long backoff floor; infra blips a short one.
export const THROTTLE_META_CODES = new Set<number>([131049, 131048, 131056, 130429, 80007]);

export const isThrottleCode = (code: number | null | undefined): boolean =>
  code != null && THROTTLE_META_CODES.has(code);

export function isTransientFailure(
  code: number | null | undefined,
  httpStatus: number,
  message: string,
): boolean {
  if (code != null && TRANSIENT_META_CODES.has(code)) return true;
  if (httpStatus >= 500) return true;
  return /timeout|abort|network|econnreset|fetch failed|throttl|rate limit/i.test(message || "");
}

export function retryBackoffMs(priorRetries: number, throttle: boolean): number {
  const base = throttle ? 15 * 60 * 1000 : 2 * 60 * 1000;    // 15m vs 2m
  const cap = throttle ? 6 * 60 * 60 * 1000 : 30 * 60 * 1000; // 6h vs 30m
  return Math.min(base * Math.pow(2, priorRetries), cap);
}

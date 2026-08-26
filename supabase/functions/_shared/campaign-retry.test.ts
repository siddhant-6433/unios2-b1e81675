// deno test supabase/functions/_shared/campaign-retry.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isTransientFailure, isThrottleCode, retryBackoffMs, MAX_SEND_RETRIES } from "./campaign-retry.ts";

Deno.test("ecosystem throttle 131049 is transient and throttle-classed", () => {
  assert(isTransientFailure(131049, 200, "throttled"));
  assert(isThrottleCode(131049));
});

Deno.test("invalid recipient / template errors are permanent", () => {
  assert(!isTransientFailure(131026, 200, "invalid recipient"));
  assert(!isTransientFailure(132000, 400, "template mismatch"));
  assert(!isTransientFailure(100, 400, "bad param"));
  assert(!isThrottleCode(131026));
});

Deno.test("5xx and network/timeout messages are transient without a code", () => {
  assert(isTransientFailure(null, 503, "service unavailable"));
  assert(isTransientFailure(null, 0, "request aborted after timeout"));
  assert(isTransientFailure(null, 0, "fetch failed"));
  assert(!isTransientFailure(null, 400, "some 4xx with no known code"));
});

Deno.test("backoff grows exponentially, is longer for throttles, and is capped", () => {
  // infra: 2m base, 30m cap
  assertEquals(retryBackoffMs(0, false), 2 * 60 * 1000);
  assertEquals(retryBackoffMs(1, false), 4 * 60 * 1000);
  assertEquals(retryBackoffMs(10, false), 30 * 60 * 1000); // capped
  // throttle: 15m base, 6h cap — and always longer than the infra path
  assertEquals(retryBackoffMs(0, true), 15 * 60 * 1000);
  assert(retryBackoffMs(3, true) > retryBackoffMs(3, false));
  assertEquals(retryBackoffMs(20, true), 6 * 60 * 60 * 1000); // capped
});

Deno.test("retry cap is a sane small number", () => {
  assert(MAX_SEND_RETRIES >= 3 && MAX_SEND_RETRIES <= 10);
});

// deno test supabase/functions/_shared/campaign-retry.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyFailure,
  isAccountLevelCode,
  isFatigueCode,
  isThrottleCode,
  isTransientFailure,
  maxRetriesFor,
  retryBackoffMs,
  MAX_FATIGUE_RETRIES,
  MAX_SEND_RETRIES,
} from "./campaign-retry.ts";

Deno.test("131049 is fatigue, not a throttle", () => {
  // Regression: 131049 used to share the 15m→6h throttle curve, so we re-hit
  // users inside Meta's per-user marketing window and fed the block signal.
  assertEquals(classifyFailure(131049, 200, "healthy ecosystem"), "fatigue");
  assert(isFatigueCode(131049));
  assert(!isThrottleCode(131049));
});

Deno.test("fatigue waits a full day minimum and gives up early", () => {
  assertEquals(retryBackoffMs(0, "fatigue"), 24 * 60 * 60 * 1000);
  assertEquals(retryBackoffMs(1, "fatigue"), 48 * 60 * 60 * 1000);
  assertEquals(retryBackoffMs(9, "fatigue"), 72 * 60 * 60 * 1000); // capped
  // Never shorter than a day, at any retry count.
  for (let i = 0; i < 6; i++) {
    assert(retryBackoffMs(i, "fatigue") >= 24 * 60 * 60 * 1000);
  }
  assertEquals(maxRetriesFor("fatigue"), MAX_FATIGUE_RETRIES);
  assert(MAX_FATIGUE_RETRIES < MAX_SEND_RETRIES);
});

Deno.test("real rate limits keep the short throttle curve", () => {
  for (const code of [131048, 131056, 130429, 80007]) {
    assertEquals(classifyFailure(code, 200, ""), "throttle");
  }
  assertEquals(retryBackoffMs(0, "throttle"), 15 * 60 * 1000);
  assertEquals(retryBackoffMs(20, "throttle"), 6 * 60 * 60 * 1000); // capped
  assert(retryBackoffMs(3, "throttle") > retryBackoffMs(3, "infra"));
});

Deno.test("account-level failures are permanent and flagged for pausing", () => {
  for (const code of [131042, 133010, 190]) {
    assert(isAccountLevelCode(code), `${code} should be account-level`);
    assertEquals(classifyFailure(code, 400, ""), null);
    assert(!isTransientFailure(code, 400, ""));
  }
  // A billing error whose message happens to contain "rate limit" must not be
  // rescued into an infinite infra retry by the message regex.
  assertEquals(classifyFailure(131042, 400, "payment rate limit"), null);
});

Deno.test("invalid recipient / template errors are permanent", () => {
  assert(!isTransientFailure(131026, 200, "invalid recipient"));
  assert(!isTransientFailure(132000, 400, "template mismatch"));
  assert(!isTransientFailure(100, 400, "bad param"));
  assert(!isThrottleCode(131026));
});

Deno.test("5xx and network/timeout messages are transient without a code", () => {
  assertEquals(classifyFailure(null, 503, "service unavailable"), "infra");
  assertEquals(classifyFailure(null, 0, "request aborted after timeout"), "infra");
  assertEquals(classifyFailure(null, 0, "fetch failed"), "infra");
  assertEquals(classifyFailure(null, 400, "some 4xx with no known code"), null);
});

Deno.test("infra backoff grows exponentially and is capped", () => {
  assertEquals(retryBackoffMs(0, "infra"), 2 * 60 * 1000);
  assertEquals(retryBackoffMs(1, "infra"), 4 * 60 * 1000);
  assertEquals(retryBackoffMs(10, "infra"), 30 * 60 * 1000); // capped
});

Deno.test("retry cap is a sane small number", () => {
  assert(MAX_SEND_RETRIES >= 3 && MAX_SEND_RETRIES <= 10);
});

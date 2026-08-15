import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTemporalContext, buildTemporalLine } from "./knowledge.ts";

Deno.test("session rolls over in April, not January", () => {
  assertStringIncludes(buildTemporalContext(new Date("2026-08-15T12:00:00Z")), "session is 2026-27");
  assertStringIncludes(buildTemporalContext(new Date("2026-02-10T12:00:00Z")), "session is 2025-26");
  assertStringIncludes(buildTemporalContext(new Date("2026-04-01T12:00:00Z")), "session is 2026-27");
});

Deno.test("date is IST, not UTC — 19:30Z on 15 Aug is already 16 Aug in India", () => {
  assertStringIncludes(buildTemporalContext(new Date("2026-08-15T19:30:00Z")), "16 August 2026");
  assertStringIncludes(buildTemporalLine(new Date("2026-08-15T19:30:00Z")), "2026-08-16");
  // ...and the UTC-day boundary must not drag the session back either.
  assertStringIncludes(buildTemporalLine(new Date("2026-03-31T19:30:00Z")), "session 2026-27");
});

Deno.test("the guardrails the model needs are actually in the block", () => {
  const block = buildTemporalContext(new Date("2026-08-15T12:00:00Z"));
  assert(block.includes("has not started yet"), "missing the counselling-not-started guardrail");
  assert(block.includes("+91 9555192192"), "missing the deflection number");
});

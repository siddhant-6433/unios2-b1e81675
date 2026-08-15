// deno test supabase/functions/_shared/razorpayx.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nameMatchScore } from "./razorpayx.ts";

Deno.test("exact match ignores case/spacing", () => {
  assertEquals(nameMatchScore("Rahul Kumar", "RAHUL   KUMAR"), 100);
});

Deno.test("salutations and punctuation are stripped", () => {
  assertEquals(nameMatchScore("Mr. Rahul Kumar", "RAHUL KUMAR"), 100);
});

Deno.test("partial overlap scores below the 70 verify threshold... or above", () => {
  // entered has 3 tokens, bank matches 1 → 33% → mismatch
  assert(nameMatchScore("Rahul Anand Kumar", "RAHUL") < 70);
  // entered has 2 tokens, bank matches both (extra bank token ignored) → 100%
  assertEquals(nameMatchScore("Rahul Kumar", "RAHUL KUMAR SINGH"), 100);
});

Deno.test("empty names never match", () => {
  assertEquals(nameMatchScore("", "RAHUL"), 0);
  assertEquals(nameMatchScore("Rahul", ""), 0);
});

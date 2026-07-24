import { assertEquals } from "jsr:@std/assert";
import { courseSearchTerms } from "./courseMatch.ts";

Deno.test("spelled initialism resolves to contiguous form", () => {
  // The bug: "L L B" was passed straight to ilike and matched nothing.
  const terms = courseSearchTerms("L L B");
  assertEquals(terms.includes("LLB"), true);
});

Deno.test("spelled initialism with filler still yields the initialism", () => {
  // "L L B three years" — cleaned + de-spaced miss, but firstWord "LLB" hits.
  const terms = courseSearchTerms("L L B three years");
  assertEquals(terms.includes("LLB"), true);
});

Deno.test("dotted form is stripped", () => {
  assertEquals(courseSearchTerms("B.Sc. Nursing")[0], "BSc Nursing");
});

Deno.test("plain full name is tried first, unchanged", () => {
  assertEquals(courseSearchTerms("Bachelor of Laws")[0], "Bachelor of Laws");
});

Deno.test("last-word fallback preserved", () => {
  assertEquals(courseSearchTerms("Diploma in Nursing").includes("Nursing"), true);
});

Deno.test("empty input yields no terms", () => {
  assertEquals(courseSearchTerms("   "), []);
});

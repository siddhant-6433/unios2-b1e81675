import { assertEquals } from "jsr:@std/assert";
import { MIRAI_INSTITUTION_ID, MIRAI_PLIVO_CALLER_ID, NIMT_PLIVO_CALLER_ID, plivoCallerIdForLead } from "./mirai-brand.ts";

// Minimal chainable fake: every query resolves to the row/rows set per table.
function fakeDb(tables: Record<string, any>) {
  return {
    from(table: string) {
      const data = tables[table];
      const q: any = {
        select: () => q, eq: () => q, in: () => q, order: () => q,
        limit: () => Promise.resolve({ data: Array.isArray(data) ? data : [], error: null }),
        maybeSingle: () => Promise.resolve({ data, error: null }),
        then: (r: any) => r({ data, error: null }),
      };
      return q;
    },
  };
}

Deno.test("no lead → NIMT number", async () => {
  assertEquals(await plivoCallerIdForLead(fakeDb({}), null), NIMT_PLIVO_CALLER_ID);
});

Deno.test("Mirai course → Mirai number", async () => {
  const db = fakeDb({
    leads: { course_id: "c1" }, applications: [],
    courses: [{ id: "c1", departments: { institution_id: MIRAI_INSTITUTION_ID } }],
  });
  assertEquals(await plivoCallerIdForLead(db, "l1"), MIRAI_PLIVO_CALLER_ID);
});

Deno.test("lookup failure → NIMT number", async () => {
  assertEquals(await plivoCallerIdForLead(fakeDb({ leads: null }), "l1"), NIMT_PLIVO_CALLER_ID);
});

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applicationReceiptBrand } from "./application-receipt-brand.ts";
import { MIRAI_INSTITUTION_ID } from "./mirai-brand.ts";
const fallback = { slug: "nimt_school_avantika2", name: "NIMT School", contact_email: "admissions@nimt.ac.in", website: "https://nimt.ac.in" };
function database(institution: string, fail = false) {
  const requested: [string, unknown][] = [];
  return { requested, from(table: string) {
    return { select() { return this; }, eq(_key: string, value: unknown) { requested.push([table,value]);return this; },
      maybeSingle() { return Promise.resolve({ data: table === "leads" ? { course_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" } : { departments: { institution_id: institution } }, error: fail ? { message: "offline" } : null }); } };
  } };
}
Deno.test("Mirai application-fee receipt uses the saved course institution despite campus branding", async () => {
  const db=database(MIRAI_INSTITUTION_ID);
  const result=await applicationReceiptBrand(db,{lead_id:"lead",course_selections:[{course_id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}]},fallback);
  assertEquals(result.slug,"mirai");assertEquals(result.name,"Mirai Experiential School");
  assertEquals(result.contact_email,null);assertEquals(db.requested,[["courses","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]]);
});
Deno.test("shared-campus B.Ed and Beacon receipts retain their institution branding even with a Mirai flag", async () => {
  for(const institution of ["nimt-institution","beacon-institution"]) {
    const db=database(institution);
    assertEquals(await applicationReceiptBrand(db,{course_selections:[{course_id:"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}],flags:{portal_brand:"mirai"},campus_id:"avantika"},fallback),fallback);
  }
});
Deno.test("legacy application without selections resolves the saved lead course", async () => {
  const db=database(MIRAI_INSTITUTION_ID);
  assertEquals((await applicationReceiptBrand(db,{lead_id:"lead"},fallback)).slug,"mirai");
  assertEquals(db.requested,[["leads","lead"],["courses","cccccccc-cccc-cccc-cccc-cccccccccccc"]]);
});
Deno.test("ownership lookup failure cannot silently issue a wrong-branded receipt", async () => {
  await assertRejects(()=>applicationReceiptBrand(database(MIRAI_INSTITUTION_ID,true),{course_selections:[{course_id:"dddddddd-dddd-dddd-dddd-dddddddddddd"}]},fallback),Error,"Could not resolve receipt institution ownership");
});

Deno.test("legacy course code falls back to the lead UUID without a malformed course query", async () => {
  const db=database(MIRAI_INSTITUTION_ID);
  assertEquals((await applicationReceiptBrand(db,{lead_id:"lead",course_selections:[{course_id:"MES-PYP"}]},fallback)).slug,"mirai");
  assertEquals(db.requested,[["leads","lead"],["courses","cccccccc-cccc-cccc-cccc-cccccccccccc"]]);
});

// Runnable check for the lead-less fee-notify receipt fix.
//   deno test supabase/functions/_shared/gateway-settlement.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveReceiptPhone, sendStudentReceipt, validPhone } from "./gateway-settlement.ts";

Deno.test("validPhone requires >=10 digits", () => {
  assertEquals(validPhone("9876543210"), "9876543210");
  assertEquals(validPhone("+91 98765 43210"), "+91 98765 43210");
  assertEquals(validPhone("12345"), null);
  assertEquals(validPhone(null), null);
});

Deno.test("resolveReceiptPhone prefers the number the invite reached", () => {
  const student = { phone: "1111111111", father_phone: "2222222222" };
  assertEquals(resolveReceiptPhone("9999999999", student), "9999999999");
});

Deno.test("resolveReceiptPhone falls through the student cascade", () => {
  // sent_to_phone invalid, student.phone/whatsapp missing -> father_phone
  const student = { phone: "short", whatsapp_no: null, father_phone: "2222222222" };
  assertEquals(resolveReceiptPhone("bad", student), "2222222222");
  // nothing usable -> null
  assertEquals(resolveReceiptPhone(null, { phone: "1", father_phone: "2" }), null);
});

// --- sendStudentReceipt routing, with fetch mocked -------------------------
function mockFetch(receiptOk: boolean, receiptUrl: string) {
  const calls: Array<{ url: string; body: any }> = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    if (url.includes("generate-payment-receipt")) {
      return Promise.resolve(
        new Response(JSON.stringify(receiptOk ? { receipt_url: receiptUrl, receipt_no: "R-1" } : {}), {
          status: receiptOk ? 200 : 500,
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 })); // whatsapp-send
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

Deno.test("sendStudentReceipt sends the PDF template when a receipt renders", async () => {
  const m = mockFetch(true, "https://x/receipt.pdf");
  try {
    await sendStudentReceipt("http://sb", "key", "lp-1", { phone: "9999999999", name: "Asha", amount: 5000 });
    const wa = m.calls.find((c) => c.url.includes("whatsapp-send"))!;
    assertEquals(wa.body.template_key, "payment_receipt_pdf");
    assertEquals(wa.body.phone, "9999999999");
    assertEquals(wa.body.header_document_url, "https://x/receipt.pdf");
    assertEquals(m.calls.filter((c) => c.url.includes("whatsapp-send")).length, 1);
  } finally { m.restore(); }
});

Deno.test("sendStudentReceipt falls back to the text template when the PDF fails", async () => {
  const m = mockFetch(false, "");
  try {
    await sendStudentReceipt("http://sb", "key", "lp-1", { phone: "9999999999", name: "Asha", amount: 5000 });
    const waCalls = m.calls.filter((c) => c.url.includes("whatsapp-send"));
    assertEquals(waCalls.length, 1);
    assertEquals(waCalls[0].body.template_key, "payment_receipt");
  } finally { m.restore(); }
});

Deno.test("sendStudentReceipt is a no-op without a phone", async () => {
  const m = mockFetch(true, "https://x/receipt.pdf");
  try {
    await sendStudentReceipt("http://sb", "key", "lp-1", { phone: null, name: "Asha", amount: 5000 });
    assertEquals(m.calls.length, 0); // never even mints the PDF
  } finally { m.restore(); }
});

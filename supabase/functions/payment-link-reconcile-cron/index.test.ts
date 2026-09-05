import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickCapturedPaymentId } from "./razorpay.ts";

// Regression: reconcile must settle under the real pay_ id, never the link id.
// Two different strings for one payment (pay_ vs plink_) don't collide on the
// transaction_ref unique index → duplicate lead_payments / double-counted revenue.

Deno.test("captured payment → pay_ id", () => {
  const link = {
    id: "plink_TCBMmPRBg1eXiC",
    status: "paid",
    payments: { items: [{ id: "pay_TCBOblXRhN42x9", status: "captured" }] },
  };
  assertEquals(pickCapturedPaymentId(link), "pay_TCBOblXRhN42x9");
});

Deno.test("authorized-only payment → its pay_ id", () => {
  const link = { payments: { items: [{ id: "pay_AUTH1", status: "authorized" }] } };
  assertEquals(pickCapturedPaymentId(link), "pay_AUTH1");
});

Deno.test("no expanded payments → null (do NOT fall back to link id)", () => {
  assertEquals(pickCapturedPaymentId({ id: "plink_x", status: "paid", payments: null }), null);
  assertEquals(pickCapturedPaymentId({ id: "plink_x", payments: { items: [] } }), null);
});

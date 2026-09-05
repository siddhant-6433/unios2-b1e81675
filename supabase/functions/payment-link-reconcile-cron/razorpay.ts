/** The captured (or authorized) Razorpay payment id from an expanded payment_links payload, else null. */
export function pickCapturedPaymentId(rpLink: any): string | null {
  const items = rpLink?.payments?.items || [];
  const captured = items.find((p: any) => p?.status === "captured") ||
    items.find((p: any) => p?.status === "authorized");
  return captured?.id ? String(captured.id) : null;
}

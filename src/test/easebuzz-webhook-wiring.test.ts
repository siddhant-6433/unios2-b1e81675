import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supabaseConfig = readFileSync("supabase/config.toml", "utf8");
const webhookSource = readFileSync("supabase/functions/easebuzz-webhook/index.ts", "utf8");

describe("Easebuzz webhook wiring", () => {
  it("keeps the server-to-server webhook public for Easebuzz callbacks", () => {
    expect(supabaseConfig).toMatch(/\[functions\.easebuzz-webhook\]\s+verify_jwt = false/s);
  });

  it("accepts the same Easebuzz secret names as the payment function", () => {
    expect(webhookSource).toContain('Deno.env.get("EASEBUZZ_KEY")');
    expect(webhookSource).toContain('Deno.env.get("EASEBUZZ_SALT")');
    expect(webhookSource).toContain('Deno.env.get("EASEBUZZ_MERCHANT_KEY")');
    expect(webhookSource).toContain('Deno.env.get("EASEBUZZ_MERCHANT_SALT")');
  });

  it("routes lead-side and student-fee callbacks before application-id fallback", () => {
    // Payment links claim first (they carry an explicit udf3 marker), then the
    // two typed paths, and only then the application-id fallback.
    const paymentLinkPath = webhookSource.indexOf("// Path 0: payment link");
    const feePaymentPath = webhookSource.indexOf("// Path 1: student fee");
    const leadPaymentPath = webhookSource.indexOf("// Path 2: lead payment");
    const applicationPath = webhookSource.indexOf("// Path 3: application fee");

    expect(paymentLinkPath).toBeGreaterThan(-1);
    expect(feePaymentPath).toBeGreaterThan(paymentLinkPath);
    expect(leadPaymentPath).toBeGreaterThan(feePaymentPath);
    expect(applicationPath).toBeGreaterThan(leadPaymentPath);
  });
});

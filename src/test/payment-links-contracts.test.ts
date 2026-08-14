import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260707120000_payment_links_and_pre_admission_token.sql", "utf8");
const payLinkFn = readFileSync("supabase/functions/pay-link/index.ts", "utf8");
// Settlement moved out of pay-link into the shared gateway module so the
// Easebuzz reconcile cron settles through exactly the same code path.
const settlementFn = readFileSync("supabase/functions/_shared/gateway-settlement.ts", "utf8");
const createLinkFn = readFileSync("supabase/functions/create-payment-link/index.ts", "utf8");
const receiptFn = readFileSync("supabase/functions/generate-payment-receipt/index.ts", "utf8");
const offerFn = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");
const offlineDialog = readFileSync("src/components/finance/OfflinePaymentDialog.tsx", "utf8");
const payLinkPage = readFileSync("src/pages/PayLink.tsx", "utf8");
const leadFeeLedger = readFileSync("src/components/finance/LeadFeeLedger.tsx", "utf8");

describe("payment_links migration", () => {
  it("creates payment_links with server-authoritative amount and token credential", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.payment_links");
    expect(migration).toContain("token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex')");
    expect(migration).toContain("amount numeric(12,2) NOT NULL CHECK (amount > 0)");
    expect(migration).toContain("CHECK (purpose IN ('pre_admission_token', 'fee_due', 'custom'))");
    expect(migration).toContain("CHECK (status IN ('active', 'paid', 'expired', 'cancelled'))");
    expect(migration).toContain("CONSTRAINT chk_payment_links_target CHECK (lead_id IS NOT NULL OR student_id IS NOT NULL)");
  });

  it("has staff + consultant RLS but NO anon policy — public resolution goes through the edge fn only", () => {
    expect(migration).toContain('CREATE POLICY "Staff can manage payment_links"');
    expect(migration).toContain('CREATE POLICY "Consultants can view own payment_links"');
    expect(migration).toContain('CREATE POLICY "Consultants can create own payment_links"');
    // Consultant INSERT is scoped to their own linked leads/students.
    expect(migration).toContain("consultant_id IN (SELECT id FROM public.consultants WHERE user_id = (SELECT auth.uid()))");
    // No anon access anywhere on payment_links.
    expect(migration).not.toMatch(/payment_links[\s\S]{0,200}TO anon/);
    expect(migration).not.toMatch(/CREATE POLICY[^;]*anon[^;]*payment_links/i);
  });

  it("widens lead_payments.type with pre_admission_token instead of reusing token_fee", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS lead_payments_type_check");
    expect(migration).toContain(
      "CHECK (type IN ('application_fee', 'token_fee', 'registration_fee', 'pre_admission_token', 'other'))",
    );
  });

  it("counts pre_admission_token toward token/course sums in lead_fee_status", () => {
    expect(migration).toContain("FILTER (WHERE type IN ('token_fee','pre_admission_token') AND status = 'confirmed')");
    expect(migration).toContain(
      "FILTER (WHERE type IN ('token_fee','pre_admission_token','other') AND status = 'confirmed')",
    );
    // Completion flags remain guarded so a pre-offer token cannot mis-fire PAN.
    expect(migration).toContain("(v_token_required > 0 AND v_paid_toward_course >= v_token_required)");
    expect(migration).toContain("(v_post_year_1 > 0 AND v_paid_toward_course >= v_an_threshold)");
  });

  it("extracts PAN/AN advancement into recompute_lead_fee_stage and delegates the trigger to it", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("PERFORM public.recompute_lead_fee_stage(NEW.lead_id);");
    // The stage gate from the original engine is preserved.
    expect(migration).toContain("v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview')");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.recompute_lead_fee_stage(uuid) TO authenticated, service_role;");
  });
});

describe("pay-link edge function", () => {
  it("settles idempotently — claims active→paid before inserting any payment row", () => {
    // The UPDATE ... eq(status,'active') guard runs first; a replayed webhook
    // that fails to claim the row returns ok without inserting.
    // Scope to settlePaymentLink — the module also holds order/lead-payment
    // helpers whose lead_payments writes come earlier in the file.
    const body = settlementFn.slice(settlementFn.indexOf("export async function settlePaymentLink"));
    const claimIdx = body.indexOf('.eq("status", "active")');
    const insertIdx = body.indexOf('.from("lead_payments")');
    expect(claimIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(claimIdx);
    expect(body).toContain('.update({ status: "paid" })');
    expect(body).toContain("if (!claimed) {");
    expect(body).toContain("already: true,");
  });

  it("always uses the DB amount — never a client-provided amount — for orders and settlement", () => {
    expect(settlementFn).toContain("const paidAmount = Number(link.amount);");
    expect(payLinkFn).toContain("const amountPaise = Math.round(Number(link.amount) * 100);");
    // No parsed.amount anywhere in the settlement path.
    expect(payLinkFn).not.toContain("parsed.amount");
    expect(settlementFn).not.toContain("parsed.amount");
  });

  it("routes purposes correctly: pre_admission_token → lead_payments, fee_due/custom → ledger allocation", () => {
    expect(settlementFn).toContain('if (link.purpose === "pre_admission_token")');
    expect(settlementFn).toContain('type: "pre_admission_token"');
    // fee_due / custom links sweep the student's oldest-due ledger rows.
    expect(settlementFn).toContain('.from("fee_ledger")');
    expect(settlementFn).toContain('.in("status", ["due", "overdue"])');
    expect(settlementFn).toContain('from("fee_ledger_payments")');
    // pay-link itself only routes; it must not re-implement settlement.
    expect(payLinkFn).toContain('import { settlePaymentLink } from "../_shared/gateway-settlement.ts";');
  });

  it("verifies signatures with constant-time comparison for both webhook and checkout callbacks", () => {
    expect(payLinkFn).toContain("hmacSha256Hex");
    expect(payLinkFn).toContain("timingSafeHexEqual");
    expect(payLinkFn).toContain('req.headers.get("x-razorpay-signature")');
    expect(payLinkFn).toContain('return json({ error: "Invalid webhook signature" }, 400);');
    expect(payLinkFn).toContain('return json({ error: "Invalid payment signature" }, 400);');
    expect(payLinkFn).toContain('if (!webhookSecret) return json({ error: "Webhook secret not configured" }, 500);');
  });

  it("rejects non-active links for payment actions and lazily expires stale ones", () => {
    expect(payLinkFn).toContain('if (link.status !== "active")');
    expect(payLinkFn).toContain("This payment link is ${link.status}");
    expect(payLinkFn).toContain('await admin.from("payment_links").update({ status: "expired" }).eq("id", link.id);');
  });
});

describe("create-payment-link edge function", () => {
  it("authorizes staff roles or a consultant linked to the target — everyone else is rejected", () => {
    expect(createLinkFn).toContain('"super_admin", "campus_admin", "admission_head", "accountant", "counsellor",');
    expect(createLinkFn).toContain('return json({ error: "Not authorised to send payment links" }, 403);');
    expect(createLinkFn).toContain('return json({ error: "This candidate is not linked to your consultant account" }, 403);');
    // Consultant linkage is verified against leads.consultant_id server-side.
    expect(createLinkFn).toContain('from("leads").select("consultant_id").eq("id", leadId)');
  });

  it("authorizes academic partners for their own attributed leads/students only", () => {
    // Partner identity is resolved and included in the auth gate.
    expect(createLinkFn).toContain('from("academic_partners")');
    expect(createLinkFn).toContain("if (!isStaff && !consultantId && !academicPartnerId)");
    // Scope is verified against leads.academic_partner_id server-side.
    expect(createLinkFn).toContain('from("leads").select("academic_partner_id").eq("id", leadId)');
    expect(createLinkFn).toContain('return json({ error: "This candidate is not attributed to your academic partner account" }, 403);');
  });

  it("requires auth and validates purpose/amount at the boundary", () => {
    expect(createLinkFn).toContain('if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);');
    expect(createLinkFn).toContain('if (!["pre_admission_token", "fee_due", "custom"].includes(purpose))');
    expect(createLinkFn).toContain('if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amount must be > 0" }, 400);');
    expect(createLinkFn).toContain('if (!leadId && !studentId) return json({ error: "lead_id or student_id is required" }, 400);');
  });

  it("mints a Razorpay hosted Payment Link when configured and falls back to /pay/<token>", () => {
    expect(createLinkFn).toContain("https://api.razorpay.com/v1/payment_links");
    expect(createLinkFn).toContain("notes: { payment_link_id: linkRow.id, purpose }");
    expect(createLinkFn).toContain("/pay/${linkRow.token}");
  });
});

describe("receipt + offer letter wording", () => {
  it("pre_admission_token receipts carry the TOKEN FEE RECEIPT title and adjustable note", () => {
    expect(receiptFn).toContain('pre_admission_token: "Token Fee (prior to admission)"');
    expect(receiptFn).toContain('isPreAdmissionToken ? "TOKEN FEE RECEIPT" : "PAYMENT RECEIPT"');
    expect(receiptFn).toContain("Token fee prior to admission — adjustable against admission fee");
  });

  it("offer letter shows Less: token fee already paid from confirmed token payments", () => {
    expect(offerFn).toContain('.in("type", ["token_fee", "pre_admission_token"])');
    expect(offerFn).toContain('"Less: Token Fee Already Paid"');
    expect(offerFn).toContain('"Net Token Fee Due"');
  });
});

describe("offline recording restriction (owner decision)", () => {
  it("OfflinePaymentDialog only renders for accountant + super_admin and offers the pre-admission token type", () => {
    expect(offlineDialog).toContain('const allowedRole = ["super_admin", "accountant", "office_admin"].includes(role || "");');
    expect(offlineDialog).not.toContain('"campus_admin", "accountant"].includes(role');
    expect(offlineDialog).toContain('{ value: "pre_admission_token", label: "Token Fee (prior to admission)" }');
  });
});

describe("PayLink public page", () => {
  it("renders only the server-resolved amount — no client-side amount inputs or params", () => {
    // All display amounts come from the resolved link object.
    expect(payLinkPage).toContain("Number(link.amount).toLocaleString");
    // The page never reads an amount from the URL or lets the payer type one.
    expect(payLinkPage).not.toMatch(/searchParams.*amount|amount.*searchParams/i);
    expect(payLinkPage).not.toContain("<Input");
    expect(payLinkPage).not.toContain('type="number"');
  });

  it("blocks non-active links and short-circuits already-paid links to the done state", () => {
    expect(payLinkPage).toContain('if (data.status === "paid") { setStep("done"); return; }');
    expect(payLinkPage).toContain("This link is ${data.status}");
  });

  // The page used to bounce straight to the gateway's hosted short_url on LOAD,
  // so nobody — not even the WhatsApp recipients whose button pointed here —
  // ever saw a UniOs-branded page. It now renders first and forwards only when
  // the payer clicks Pay, so Razorpay's reminders and payment-link webhook
  // still settle against the one hosted artifact.
  it("renders the branded page first and forwards to the gateway only on Pay", () => {
    expect(payLinkPage).not.toContain("if (data.short_url && (data.gateway ===");
    expect(payLinkPage).toContain("const handlePay = () => {");
    expect(payLinkPage).toMatch(/handlePay = \(\) => \{[\s\S]{0,600}?window\.location\.href = link\.short_url;/);
  });
});

describe("LeadFeeLedger pre-admission token rows", () => {
  it("labels pre_admission_token rows and annotates adjustment once a structure exists", () => {
    expect(leadFeeLedger).toContain('pre_admission_token: "Token Fee (pre-admission)"');
    expect(leadFeeLedger).toContain('p.type === "pre_admission_token" && preview.length > 0');
    expect(leadFeeLedger).toContain("Adjusted against admission fee");
    // Token allocation now includes the pre-admission type.
    expect(leadFeeLedger).toContain('p.type === "token_fee" || p.type === "pre_admission_token"');
  });
});

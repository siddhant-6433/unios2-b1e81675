// Critical regression guard for consultant-managed fee hiding: flagged
// students must see due + Pay + receipts but never the fee structure; the
// mechanism must fail OPEN to visible; and only the ONE student fee_ledger
// SELECT policy may be tightened.

import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260707140000_consultant_fee_management.sql", "utf8");
const studentPortal = readFileSync("src/pages/StudentPortal.tsx", "utf8");
const paymentPortal = readFileSync("src/pages/PaymentPortal.tsx", "utf8");
const studentFeePanel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");
const feeCollections = readFileSync("src/pages/FeeCollections.tsx", "utf8");
const txnHistory = readFileSync("src/components/admin/TransactionHistoryPanel.tsx", "utf8");
const consultantPortal = readFileSync("src/pages/ConsultantPortal.tsx", "utf8");
const feesPanel = readFileSync("src/components/finance/ConsultantFeesPanel.tsx", "utf8");
const adminPanel = readFileSync("src/pages/AdminPanel.tsx", "utf8");

describe("consultant_fee_management migration", () => {
  it("scopes enablement to consultant + course + session with a UNIQUE constraint", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.consultant_fee_management");
    expect(migration).toContain("UNIQUE (consultant_id, course_id, session_id)");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.student_fee_visibility");
    expect(migration).toContain("student_id uuid UNIQUE NOT NULL REFERENCES public.students(id)");
  });

  it("is_fee_hidden_for_student FAILS OPEN to visible when config is missing or disabled", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.is_fee_hidden_for_student(_student_id uuid)");
    // COALESCE(..., false): no row / disabled config / inactive consultant → visible.
    expect(migration).toContain("SELECT COALESCE((");
    expect(migration).toContain("), false);");
    expect(migration).toContain("AND cfm.enabled");
    expect(migration).toContain("AND c.stage <> 'inactive'");
  });

  it("consultant_set_fee_visibility rejects unlinked students and non-enabled course/session", () => {
    expect(migration).toContain("RAISE EXCEPTION 'Student is not linked to your consultant account';");
    expect(migration).toContain("RAISE EXCEPTION 'Fee management is not enabled for this course/session';");
    // Linkage is via leads.consultant_id, never client-asserted.
    expect(migration).toContain("JOIN public.leads l ON l.consultant_id = c.id");
    expect(migration).toContain("ON CONFLICT (student_id) DO UPDATE");
  });

  it("tightens ONLY the student SELECT policy on fee_ledger — nothing else", () => {
    // The only policy replaced on a PRE-EXISTING table is the student fee_ledger
    // SELECT (drops on the two brand-new tables are idempotency guards).
    const dropPolicies = migration.match(/DROP POLICY IF EXISTS "[^"]+" ON public\.\w+;/g) || [];
    const dropsOnExistingTables = dropPolicies.filter(
      (stmt) => !stmt.includes("public.consultant_fee_management") && !stmt.includes("public.student_fee_visibility"),
    );
    expect(dropsOnExistingTables).toHaveLength(1);
    expect(dropsOnExistingTables[0]).toContain('"Students can view own ledger" ON public.fee_ledger');
    // The recreated policy keeps ownership AND adds the hide gate.
    expect(migration).toContain("s.id = fee_ledger.student_id AND s.user_id = auth.uid()");
    expect(migration).toContain("AND NOT public.is_fee_hidden_for_student(fee_ledger.student_id)");
    // Receipts stay visible: no policy changes on lead_payments/payments.
    expect(migration).not.toMatch(/CREATE POLICY[^;]*ON public\.lead_payments/);
    expect(migration).not.toMatch(/CREATE POLICY[^;]*ON public\.payments\b/);
  });

  it("student_fee_due_summary returns only due total + receipts and is self-scoped", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.student_fee_due_summary(_student_id uuid)");
    expect(migration).toContain("RAISE EXCEPTION 'Not authorised';");
    expect(migration).toContain("RETURN jsonb_build_object('due_total', v_due, 'receipts', v_receipts);");
    // It must not leak structure fields.
    const dueSummaryBody = migration.split("student_fee_due_summary")[2] || "";
    expect(dueSummaryBody).not.toContain("'ledger'");
  });
});

describe("hidden-mode student views (due + Pay + receipts, no structure)", () => {
  it("StudentPortal falls back to the due-summary RPC when the ledger is empty", () => {
    expect(studentPortal).toContain('supabase.rpc("student_fee_due_summary" as any');
    expect(studentPortal).toContain("setHiddenFee({ due_total: dueTotal, receipts });");
    // Hidden card: due + Pay Now + receipts, and it replaces the structure list.
    expect(studentPortal).toContain('activeTab === "fees" && fees.length === 0 && hiddenFee');
    expect(studentPortal).toContain('activeTab === "fees" && !(fees.length === 0 && hiddenFee)');
    expect(studentPortal).toContain("hiddenFee.receipts.map");
  });

  it("unflagged students keep the full structure view (fallback only fires on zero rows)", () => {
    expect(studentPortal).toContain("if (feeRes.data.length === 0) {");
    expect(studentPortal).toContain("setHiddenFee(null);");
  });

  it("PaymentPortal supports hidden-mode payment end to end", () => {
    expect(paymentPortal).toContain("const [hiddenDueMode, setHiddenDueMode] = useState(false);");
    expect(paymentPortal).toContain('supabase.rpc("student_fee_due_summary" as any');
    // Synthetic display row never reaches the gateways as a fee id.
    expect(paymentPortal).toContain("const realFeeIds = fees.map((fee) => fee.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));");
    expect(paymentPortal).not.toContain("fee_ids: paymentScope === \"all\" ? [] : fees.map((fee) => fee.id)");
    // Paid-state polling uses the RPC (student can't read fee_ledger when hidden).
    expect(paymentPortal).toContain("if (hiddenDueMode) {");
    expect(paymentPortal).toContain("const stillDue = Number((summary as any)?.due_total || 0);");
  });
});

describe("consultant surfaces", () => {
  it("ConsultantPortal gains the Fees tab backed by ConsultantFeesPanel", () => {
    expect(consultantPortal).toContain('"Leads", "Payments", "Fees", "Commissions", "Requests"');
    expect(consultantPortal).toContain("<ConsultantFeesPanel />");
  });

  it("ConsultantFeesPanel toggles through the scoped RPC and reuses Phase 1 payment links", () => {
    expect(feesPanel).toContain('supabase.rpc("consultant_fee_students" as any)');
    expect(feesPanel).toContain('supabase.rpc("consultant_set_fee_visibility" as any');
    expect(feesPanel).toContain("_hidden: !s.hidden");
    expect(feesPanel).toContain('context: "student_fee"');
    expect(feesPanel).toContain('defaultPurpose="fee_due"');
  });

  it("AdminPanel exposes the lazy Consultant Fees tab", () => {
    expect(adminPanel).toContain('const ConsultantFeeManagementPanel = lazy(() => import("@/components/admin/ConsultantFeeManagementPanel"));');
    expect(adminPanel).toContain('<TabsContent value="consultant-fees"');
  });
});

describe("cashier notes", () => {
  it("staff StudentFeePanel shows the consultant-managed banner from v_student_fee_visibility", () => {
    expect(studentFeePanel).toContain('from("v_student_fee_visibility")');
    expect(studentFeePanel).toContain("effective_hidden");
    expect(studentFeePanel).toContain("Fee for this candidate is managed via consultant login / consultant-sent payment links");
  });

  it("FeeCollections and TransactionHistoryPanel badge consultant-managed candidates", () => {
    expect(feeCollections).toContain('from("v_student_fee_visibility")');
    expect(feeCollections).toContain("Consultant-managed fee");
    expect(txnHistory).toContain('from("v_student_fee_visibility")');
    expect(txnHistory).toContain("Consultant-managed fee");
  });
});

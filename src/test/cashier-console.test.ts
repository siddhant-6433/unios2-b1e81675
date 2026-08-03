import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { matchesCampus } from "@/lib/campusFilter";
import { defaultFeeTermLabel } from "@/lib/feeTermLabels";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Migrations are matched by name suffix, not full filename: the repo's
// pre-commit hook re-stamps every new migration with the actual commit time,
// so any hardcoded timestamp here breaks the moment the work is committed.
const readMigration = (suffix: string) => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`No migration found ending in _${suffix}.sql`);
  return readFileSync(join(dir, file), "utf8");
};

const concessionDialog = read("src/components/finance/ConcessionDialog.tsx");
const concessionPanel = read("src/components/finance/ConcessionApprovalPanel.tsx");
const offlineDialog = read("src/components/finance/OfflinePaymentDialog.tsx");
const cashierConsole = read("src/components/finance/CashierConsole.tsx");
const addCharge = read("src/components/finance/AddChargeDialog.tsx");
const feeCollections = read("src/pages/FeeCollections.tsx");
const createLinkFn = read("supabase/functions/create-payment-link/index.ts");
const chargesMigration = readMigration("cashier_fee_charges_and_concessions");
const rlsMigration = readMigration("accountant_lead_visibility");
const guardMigration = readMigration("protect_leads_with_financial_records");
const admissionsPage = read("src/pages/Admissions.tsx");
const leadDetailPage = read("src/pages/LeadDetail.tsx");
const financeOverview = read("src/components/finance/FinanceOverview.tsx");
const txnHistoryPanel = read("src/components/admin/TransactionHistoryPanel.tsx");
const sendLinkDialog = read("src/components/finance/SendPaymentLinkDialog.tsx");
const allocationField = read("src/components/finance/FeeHeadAllocationField.tsx");
const receiptFn = read("supabase/functions/generate-payment-receipt/index.ts");

describe("campus filtering", () => {
  it("keeps rows whose campus could not be resolved", () => {
    // The bug: v_all_payments is security_invoker, so lead-sourced rows came
    // back with campus_id = null for accountants and were filtered out —
    // rendering the whole Collections page empty.
    expect(matchesCampus(null, "campus-a")).toBe(true);
    expect(matchesCampus(undefined, "campus-a")).toBe(true);
  });

  it("still scopes rows that do declare a campus", () => {
    expect(matchesCampus("campus-a", "campus-a")).toBe(true);
    expect(matchesCampus("campus-b", "campus-a")).toBe(false);
    expect(matchesCampus("campus-b", "all")).toBe(true);
  });

  it("is what the collections list actually uses", () => {
    expect(feeCollections).toContain("matchesCampus(p.students?.campus_id, selectedCampusId)");
    expect(feeCollections).not.toContain('p.students?.campus_id === selectedCampusId');
  });
});

describe("concessions never write the ledger from the client", () => {
  // The old code did `fee_ledger.update({ concession: amount })`, which ASSIGNED
  // rather than summed — silently wiping any approved offer waiver mapped onto
  // the same ledger row. All writes now go through the recompute-from-source
  // sync_fee_ledger_concessions().
  it("the request dialog only calls the RPC", () => {
    expect(concessionDialog).toContain('"request_fee_concession"');
    expect(concessionDialog).not.toContain('.from("fee_ledger")');
  });

  it("the approval panel decides through the RPC", () => {
    expect(concessionPanel).toContain('"decide_fee_concession"');
    expect(concessionPanel).not.toContain('.from("fee_ledger")');
  });

  it("approval re-runs the canonical sync rather than assigning a value", () => {
    expect(chargesMigration).toContain("PERFORM public.sync_fee_ledger_concessions(v_student)");
    expect(chargesMigration).toContain("has_role(auth.uid(), 'super_admin')");
  });

  it("requests land as pending and require a reason", () => {
    expect(chargesMigration).toContain("'pending_super_admin'");
    expect(chargesMigration).toContain("A reason is required");
  });
});

describe("ad-hoc fee heads", () => {
  it("takes the amount from the catalog row, never from the caller", () => {
    expect(chargesMigration).toContain("v_head.amount");
    // The signature has no amount parameter at all — the client cannot name a price.
    const signature = chargesMigration.slice(
      chargesMigration.indexOf("FUNCTION public.levy_fee_charge("),
    ).split(")")[0];
    expect(signature).toContain("_student_id uuid");
    expect(signature).toContain("_head_id");
    expect(signature).not.toContain("_amount");
  });

  it("re-checks scope server-side and blocks stacking an unpaid duplicate", () => {
    expect(chargesMigration).toContain("This fee head is not enabled for this student");
    expect(chargesMigration).toContain("already exists for this student");
  });

  it("is gated to the cashier roles", () => {
    expect(chargesMigration).toContain("NOT public.can_collect_fee(auth.uid())");
  });

  it("labels the adhoc ledger term readably", () => {
    expect(defaultFeeTermLabel("adhoc")).toBe("Other Charges");
    expect(defaultFeeTermLabel("year_2")).toBe("Year 2");
  });

  it("tags the receipt with the head instead of stuffing it into notes", () => {
    expect(offlineDialog).toContain("fee_code_id:     selectedChargeHead?.fee_code_id || null");
    expect(chargesMigration).toContain("ADD COLUMN IF NOT EXISTS fee_code_id uuid REFERENCES public.fee_codes(id)");
  });

  it("shows the amount read-only in the charge dialog", () => {
    expect(addCharge).toContain("readOnly");
    expect(addCharge).toContain("Fixed by the super admin who enabled this head.");
  });
});

describe("cashier console", () => {
  it("keeps the accountant-only gate on offline recording", () => {
    expect(offlineDialog).toContain('["super_admin", "accountant"].includes(role || "")');
  });

  it("reuses the existing ledger panels rather than re-implementing them", () => {
    expect(cashierConsole).toContain("StudentFeePanel");
    expect(cashierConsole).toContain("LeadFeeLedger");
  });

  it("offers a payment link for the payer who isn't at the counter", () => {
    expect(cashierConsole).toContain("SendPaymentLinkDialog");
  });

  it("unblocks accountants on leads at the RLS layer", () => {
    expect(rlsMigration).toContain("has_role(_user_id, 'accountant')");
    expect(rlsMigration).toContain("can_academic_partner_view_mapped_lead");
  });
});

describe("payment links stay branded", () => {
  it("hands out /pay/<token> to every channel", () => {
    expect(createLinkFn).toContain("pay_url: ourUrl");
    expect(createLinkFn).not.toContain("pay_url: payUrl");
  });

  // We still mint the hosted Razorpay link — it drives Razorpay's own SMS/email
  // reminders and the payment-link webhook that settles the receipt. Only its
  // rzp.io short_url stops being handed out.
  it("still mints the hosted gateway link that carries reminders + settlement", () => {
    expect(createLinkFn).toContain('gatewayPref === "razorpay" || gatewayPref === "auto"');
    expect(createLinkFn).toContain("https://api.razorpay.com/v1/payment_links");
    expect(createLinkFn).toContain("reminder_enable: true");
  });
});

describe("leads that took money cannot be deleted", () => {
  // lead_payments.lead_id is ON DELETE CASCADE, and FK cascades run as the
  // system without evaluating RLS — so deleting a lead used to silently vacuum
  // its receipts, bypassing both the super_admin-only DELETE policy on
  // lead_payments and the audited delete_lead_payment() path.
  it("guards at the trigger layer, not RLS — purges run straight through psql", () => {
    expect(guardMigration).toContain("BEFORE DELETE ON public.leads");
    expect(guardMigration).toContain("FOR EACH ROW EXECUTE FUNCTION public.fn_block_delete_lead_with_financials()");
  });

  it("blocks only on money that actually landed, so pending attempts don't wedge a purge", () => {
    expect(guardMigration).toContain("(receipt_no IS NOT NULL OR status = 'confirmed')");
    expect(guardMigration).not.toMatch(/FROM public\.lead_payments\s+WHERE lead_id = OLD\.id;/);
  });

  it("also retains anything carrying a PAN or AN", () => {
    expect(guardMigration).toContain("OLD.pre_admission_no IS NOT NULL OR OLD.admission_no IS NOT NULL");
  });

  it("raises restrict_violation and points at the audited removal path", () => {
    expect(guardMigration).toContain("ERRCODE = 'restrict_violation'");
    expect(guardMigration).toContain("delete_lead_payment(<payment_id>, <reason>)");
  });

  it("has no override flag — removal goes through the audited RPC instead", () => {
    expect(guardMigration).not.toMatch(/current_setting\(\s*'app\./);
  });

  it("both delete call sites check payments before deleting", () => {
    expect(admissionsPage).toContain('.or("receipt_no.not.is.null,status.eq.confirmed")');
    expect(leadDetailPage).toContain('.or("receipt_no.not.is.null,status.eq.confirmed")');
    // Bulk delete skips protected leads rather than aborting the whole batch.
    expect(admissionsPage).toContain("const deletableIds = ids.filter((id) => !protectedIds.has(id));");
  });
});

describe("the dead `payments` table is no longer read", () => {
  // public.payments has zero rows and never had any; all 634 receipts live in
  // lead_payments. The collections trend chart therefore rendered flat zero.
  it("the collections trend reads v_all_payments, not the empty table", () => {
    expect(financeOverview).toContain('from("v_all_payments"');
    expect(financeOverview).not.toContain('from("payments")');
    expect(financeOverview).toContain("matchesCampus(p.campus_id, selectedCampusId)");
  });

  it("the transaction history panel drops its empty-table query", () => {
    expect(txnHistoryPanel).not.toContain('from("payments")');
    expect(txnHistoryPanel).toContain('from("lead_payments")');
  });
});

describe("payment link: Collect Fee vs Token Fee", () => {
  it("offers exactly two modes — the free-form 'custom' purpose is gone from the UI", () => {
    expect(sendLinkDialog).toContain('label: "Collect Fee (from the fee structure)"');
    expect(sendLinkDialog).toContain('label: "Token Fee (prior to admission)"');
    expect(sendLinkDialog).not.toContain('label: "Custom amount"');
    // Still accepted server-side so older callers/links keep working.
    expect(createLinkFn).toContain('["pre_admission_token", "fee_due", "custom"].includes(purpose)');
  });

  it("collapses a legacy custom purpose onto the free-amount mode", () => {
    expect(sendLinkDialog).toContain('defaultPurpose === "custom" ? "pre_admission_token"');
  });

  it("shows the fee structure only for Collect Fee, and clears it on switch", () => {
    expect(sendLinkDialog).toContain('variant="all"');
    expect(sendLinkDialog).toContain("{collectingFee && (");
    expect(sendLinkDialog).toContain('if (v !== "fee_due") setAllocations([]);');
  });

  it("pre-ticks every outstanding head at its due, once per open", () => {
    expect(allocationField).toContain('if (variant !== "all" || prefilled.current || heads.length === 0) return;');
    expect(allocationField).toContain("heads.filter((h) => h.due > 0)");
    // The cashier's edits must survive a re-render.
    expect(allocationField).toContain("if (value.length > 0) return;");
  });

  it("lets a head be switched off, which drops it from the wire format", () => {
    expect(allocationField).toContain("const toggleHead = (h: HeadOption, on: boolean) =>");
    expect(allocationField).toContain("value.filter((r) => r.fee_code_id !== h.fee_code_id)");
  });

  it("itemises the breakup on the receipt instead of one opaque total", () => {
    expect(receiptFn).toContain("allocations,");
    expect(receiptFn).toContain("see breakup below");
    expect(receiptFn).toContain('rows.push([`  ${a?.label || "Fee"}`, `${RUP}${fmtINR(amt)}`]);');
  });
});

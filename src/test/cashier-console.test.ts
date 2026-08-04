import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { matchesCampus } from "@/lib/campusFilter";
import { defaultFeeTermLabel, oneTimeRank } from "@/lib/feeTermLabels";

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

// ConcessionDialog was retired: the waiver now lives in the Concession column
// of the fee table, on the row it applies to.
const concessionPopover = read("src/components/finance/RowConcessionPopover.tsx");
const claimFn = read("supabase/functions/student-portal-claim/index.ts");
const allocRowMigration = readMigration("payment_allocations_by_ledger_row");
const authLookupMigration = readMigration("auth_user_lookup_for_student_claim");
const loginLinkMigration = readMigration("issue_student_login_link");
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
const studentFeePanel = read("src/components/finance/StudentFeePanel.tsx");
const ledgerMigration = readMigration("ledger_status_and_multi_term_charges");
const removeMigration = readMigration("relax_remove_fee_charge_to_cashier");
const searchMigration = readMigration("cashier_search_course");

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
  it("the row popover only calls the RPC", () => {
    expect(concessionPopover).toContain('"request_fee_concession"');
    expect(concessionPopover).not.toContain('.from("fee_ledger")');
  });

  it("a super admin's own waiver is decided immediately, everyone else's waits", () => {
    expect(concessionPopover).toContain('"decide_fee_concession"');
    expect(concessionPopover).toContain("isSuperAdmin && id");
  });

  it("the waiver sits on the row rather than behind a header button", () => {
    expect(studentFeePanel).toContain("RowConcessionPopover");
    expect(studentFeePanel).not.toContain("Request Waiver / Concession");
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

describe("ledger reads the way the cashier thinks", () => {
  it("never shows a settled row as overdue", () => {
    // A security deposit fully covered by an offer waiver — total 20,000,
    // concession 20,000, balance 0 — sat flagged Overdue because
    // fn_mark_overdue_fees only ever SETS overdue and nothing clears it.
    expect(ledgerMigration).toContain("BEFORE INSERT OR UPDATE OF total_amount, concession, paid_amount, status ON public.fee_ledger");
    expect(ledgerMigration).toContain("IF v_outstanding <= 0 THEN");
    expect(ledgerMigration).toContain("NEW.status := 'paid';");
    // balance is a STORED generated column, computed after before-triggers.
    expect(ledgerMigration).toContain("v_outstanding := COALESCE(NEW.total_amount, 0)");
  });

  it("re-opens a row if a waiver or payment is reversed", () => {
    expect(ledgerMigration).toContain("ELSIF NEW.status = 'paid' THEN");
    expect(ledgerMigration).toContain("NEW.status := 'due';");
  });

  it("groups the one-time charges first, application fee at the top", () => {
    expect(studentFeePanel).toContain("ONE_TIME_GROUP");
    expect(studentFeePanel).toContain('"One-time Fees"');
    expect(defaultFeeTermLabel("registration")).toBe("Application Fee");
    expect(oneTimeRank("NB-REG", "Application Fee")).toBeLessThan(oneTimeRank("NB-ADM", "Beacon Admission Fee"));
    expect(oneTimeRank("NB-ADM", "Beacon Admission Fee")).toBeLessThan(oneTimeRank("NB-SEC", "Security Deposit"));
  });
});

describe("a recurring add-on rides the existing collection terms", () => {
  it("posts one row per term at that term's own due date", () => {
    expect(ledgerMigration).toContain("FOREACH v_term IN ARRAY v_terms LOOP");
    expect(ledgerMigration).toContain("SELECT MIN(fl.due_date) INTO v_due");
    expect(ledgerMigration).toContain("COALESCE(v_due, _due_date, CURRENT_DATE)");
  });

  it("still takes the amount from the catalog, per term", () => {
    expect(ledgerMigration).toContain("v_head.amount");
    expect(ledgerMigration).toContain("NOT public.can_collect_fee(auth.uid())");
  });

  it("keeps the duplicate guard per term, not just per head", () => {
    expect(ledgerMigration).toContain("AND fl.term = v_term");
    expect(ledgerMigration).toContain("already exists on %");
  });

  it("offers the student's real terms in the charge dialog", () => {
    expect(addCharge).toContain('"student_fee_terms"');
    expect(addCharge).toContain("_terms: selectedTerms.length ? selectedTerms : null");
    // The free-date field only makes sense for a genuine one-off.
    expect(addCharge).toContain("{selectedTerms.length === 0 && (");
  });
});

describe("removing a fee row", () => {
  // The Remove button raised "permission denied for table fee_ledger" for EVERY
  // role: fee_ledger has a super_admin DELETE policy but `authenticated` was
  // never granted DELETE, so the privilege check fails before RLS is consulted.
  it("goes through an RPC rather than a direct delete", () => {
    expect(studentFeePanel).toContain('"remove_fee_charge"');
    expect(studentFeePanel).not.toContain('.from("fee_ledger")\n      .delete()');
  });

  it("never removes a row that has money against it", () => {
    expect(removeMigration).toContain("IF COALESCE(v_row.paid_amount, 0) > 0 THEN");
    expect(removeMigration).toContain("Reallocate or refund it instead");
  });

  // Removing a row edits ONE candidate's ledger; the fee structure template is
  // untouched and every other student on it is unaffected. So a cashier may
  // correct any unpaid row — a day scholar mis-provisioned with a boarding
  // head, a term that does not apply to this candidate.
  it("lets a cashier correct any unpaid row on this candidate's ledger", () => {
    expect(removeMigration).toContain("public.can_collect_fee(auth.uid())");
    expect(removeMigration).toContain("public.can_manage_fee_structure(auth.uid())");
    expect(removeMigration).not.toContain("A cashier can only remove ad-hoc charges");
  });

  it("hides the button instead of failing on click", () => {
    expect(studentFeePanel).toContain("const canRemoveRow = (f: any) =>");
    expect(studentFeePanel).toContain("{canRemoveRow(f) && (");
  });

  it("confirms before dropping a row, naming the amount", () => {
    expect(studentFeePanel).toContain("window.confirm(");
    expect(studentFeePanel).toContain("This affects only this candidate. The fee structure is unchanged.");
  });
});

describe("counter search disambiguates same-name candidates", () => {
  // "anjali kumari" returned seven visually identical rows separated only by a
  // phone number. The cashier has the candidate in front of them and knows the
  // course — that is the field that actually tells them apart.
  it("returns the course and campus", () => {
    expect(searchMigration).toContain("co.name AS course");
    expect(searchMigration).toContain("ca.name AS campus");
    expect(searchMigration).toContain("LEFT JOIN public.courses  co ON co.id = st.course_id");
    expect(searchMigration).toContain("LEFT JOIN public.courses  co ON co.id = ld.course_id");
  });

  it("shows the course above the phone line", () => {
    expect(cashierConsole).toContain("{h.course && (");
    expect(cashierConsole).toContain("course: r.course");
  });

  it("still matches on mobile number", () => {
    // Typing a bare 10-digit number matches a stored +91… via the ilike.
    expect(searchMigration).toContain("st.phone ilike v_like");
    expect(searchMigration).toContain("ld.phone ilike v_like");
    expect(cashierConsole).toContain("Search by name, mobile no., admission no., PAN or application ID");
  });
});

describe("counter collection: many heads, one receipt", () => {
  // A cashier taking admission + Q1 tuition + boarding used to produce three
  // receipts, because Collect was per-row and the dialog took a single amount.
  it("the fee table carries the selection and hands down a settled breakup", () => {
    expect(studentFeePanel).toContain("openCollect");
    expect(studentFeePanel).toContain("defaultAllocations={collectAllocations}");
    // Every entry names the exact ledger row the cashier ticked.
    expect(studentFeePanel).toContain("fee_ledger_id: f.id");
  });

  it("part payments are allowed but never exceed the row balance", () => {
    expect(studentFeePanel).toContain("Math.min(Math.max(0, raw), rowBalance(f))");
  });

  it("the per-row Collect shortcut goes through the same path, not a second one", () => {
    expect(studentFeePanel).toContain("openCollect([f], one)");
    // The old single-target prop is gone.
    expect(studentFeePanel).not.toContain("collectTarget");
  });

  it("a seeded breakup locks the amount so the table and the receipt agree", () => {
    expect(offlineDialog).toContain("defaultAllocations");
    expect(offlineDialog).toContain("readOnly={!!selectedChargeHead || seeded}");
    expect(offlineDialog).toContain("setAllocations(defaultAllocations!)");
  });

  it("selection is cleared once the receipt is recorded", () => {
    expect(studentFeePanel).toContain("setPicked({});");
  });
});

describe("row-targeted allocations", () => {
  it("apply to exactly the named ledger row, never spilling to a sibling term", () => {
    expect(allocRowMigration).toContain("v_fl := NULLIF(v_alloc->>'fee_ledger_id','')::uuid");
    expect(allocRowMigration).toContain("IF v_fl IS NOT NULL THEN");
    // Bounded by that row's own balance and the payment budget.
    expect(allocRowMigration).toContain("LEAST(v_balance, v_remaining_alloc, v_budget)");
  });

  it("stay idempotent per row, so a re-run cannot double-credit", () => {
    expect(allocRowMigration).toContain("flp.fee_ledger_id = v_fl");
  });

  it("keep the earliest-due spillover when no row is named", () => {
    // The legacy per-fee_code loop must still be present for existing payments.
    expect(allocRowMigration).toContain("ORDER BY fl.due_date NULLS LAST, fl.term, fl.id");
  });
});

describe("direct student login link", () => {
  it("is minted by a gated SECURITY DEFINER RPC, since the table blocks clients", () => {
    expect(loginLinkMigration).toContain("public.can_collect_fee(auth.uid())");
    expect(loginLinkMigration).toContain("SECURITY DEFINER");
    expect(loginLinkMigration).toContain("insufficient_privilege");
  });

  it("leaves only one live link per student", () => {
    expect(loginLinkMigration).toContain("SET expires_at = now()");
    expect(loginLinkMigration).toContain("claimed_at IS NULL");
  });

  it("refuses to mint a link that could never be delivered", () => {
    expect(loginLinkMigration).toContain("has no phone number on file");
  });

  // The claim path had never once succeeded in production: 31 tokens issued,
  // zero claimed. Two independent bugs, both silent.
  it("resolves the auth user by index instead of a truncated page scan", () => {
    expect(claimFn).toContain("find_auth_user_by_email_or_phone");
    // The capped scan is gone from the code (it survives only in a comment
    // explaining why), so assert on the call itself.
    expect(claimFn).not.toContain("db.auth.admin.listUsers(");
  });

  it("does not leak the user lookup to browser sessions", () => {
    expect(authLookupMigration).toContain("REVOKE ALL ON FUNCTION public.find_auth_user_by_email_or_phone(text, text) FROM authenticated");
    expect(authLookupMigration).toContain("GRANT EXECUTE ON FUNCTION public.find_auth_user_by_email_or_phone(text, text) TO service_role");
  });

  it("verifies the OTP on a throwaway client so the admin client keeps its role", () => {
    // verifyOtp replaces the calling client's session; doing it on `db` demoted
    // it to the student, so the claimed_at write silently matched zero rows and
    // the token stayed reusable forever.
    expect(claimFn).toContain("const authClient = createClient(");
    expect(claimFn).toContain("authClient.auth.verifyOtp(");
    expect(claimFn).not.toContain("await db.auth.verifyOtp(");
  });

  it("treats a zero-row token burn as an error, not a success", () => {
    expect(claimFn).toContain('.select("id")');
    expect(claimFn).toContain("Could not mark the claim link as used");
  });
});

describe("ledger header stays a counter, not a control panel", () => {
  it("keeps the cashier's four actions in reach", () => {
    for (const label of ["Collect Payment", "Add Charge", "Send Payment Link", "Send Login Link"]) {
      expect(studentFeePanel).toContain(label);
    }
  });

  it("moves the rare admin operations behind Manage", () => {
    expect(studentFeePanel).toContain("DropdownMenuTrigger");
    for (const label of ["Auto-Assign Fees", "Re-provision (clear unpaid)", "Transfer", "Reallocation History"]) {
      expect(studentFeePanel).toContain(label);
    }
  });
});

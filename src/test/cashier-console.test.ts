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
const accountantPermsMigration = readMigration("accountant_drop_attendance_exams");
const studentPortal = read("src/pages/StudentPortal.tsx");
const sendOnDemandMigration = readMigration("login_link_send_on_demand");
const gatewaySettlement = read("supabase/functions/_shared/gateway-settlement.ts");
const counsellorMigration = readMigration("counsellor_fee_ledger_and_login_link");
const searchScopeMigration = readMigration("cashier_search_scope_and_active");
const adhocWaiverMigration = readMigration("offer_waiver_skips_adhoc_heads");
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
    // The picker is now the not-seeded branch: a breakup handed down from the
    // fee table is rendered read-only instead.
    expect(sendLinkDialog).toContain("{collectingFee && !seeded && (");
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
    // The placeholder is now scope-dependent; both variants still advertise
    // that a mobile number works.
    expect(cashierConsole).toContain("Search students by name, mobile no., admission no. or PAN");
    expect(cashierConsole).toContain("Search students, leads and applications — name, mobile,");
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

  it("generates without sending — delivery is a separate, deliberate call", () => {
    // Minting used to fire WhatsApp from the insert trigger, so a cashier who
    // only wanted to read the URL out had already messaged the parent.
    expect(sendOnDemandMigration).toContain("auto_send boolean NOT NULL DEFAULT true");
    expect(sendOnDemandMigration).toContain("IF NEW.auto_send IS FALSE THEN");
    expect(sendOnDemandMigration).toContain("now() + interval '7 days', false)");
    expect(studentFeePanel).toContain("Generate Login Link");
    expect(studentFeePanel).toContain("Send on WhatsApp to");
  });

  it("defaults auto_send true so every existing insert site is untouched", () => {
    expect(sendOnDemandMigration).toContain("DEFAULT true");
  });

  it("keeps one delivery implementation shared by the trigger and the RPC", () => {
    expect(sendOnDemandMigration).toContain("PERFORM public.send_student_claim_link(NEW.id)");
    expect(sendOnDemandMigration).toContain("RETURN public.send_student_claim_link(_token_id)");
  });

  it("refuses to send a used, expired or undeliverable link", () => {
    expect(sendOnDemandMigration).toContain("has already been used");
    expect(sendOnDemandMigration).toContain("has expired");
    expect(sendOnDemandMigration).toContain("has no phone number on file");
  });

  it("keeps the internal sender off browser sessions", () => {
    expect(sendOnDemandMigration).toContain("REVOKE ALL ON FUNCTION public.send_student_claim_link(uuid) FROM PUBLIC, anon, authenticated");
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
    for (const label of ["Collect Payment", "Add Charge", "Send Payment Link", "Generate Login Link"]) {
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

describe("the accountant sidebar is a cash counter", () => {
  it("drops attendance and exams from the role rather than hiding them in the nav", () => {
    // The sidebar gates those two items on exactly these permissions, so the
    // grants also let the role open /attendance and /exams directly — hiding
    // the links would have left the pages reachable.
    expect(accountantPermsMigration).toContain("rp.role = 'accountant'");
    expect(accountantPermsMigration).toContain("p.module IN ('attendance', 'exams')");
    expect(accountantPermsMigration).toContain("DELETE FROM public.role_permissions");
  });

  it("leaves the nav itself permission-driven", () => {
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain('permission: "attendance:view"');
    expect(sidebar).toContain('permission: "exams:view"');
  });
});

describe("student portal fee ledger", () => {
  it("groups by term with the same helpers as the staff ledger", () => {
    // A flat due-date sort put the security deposit above the application fee
    // and scattered a quarter's heads across the list.
    expect(studentPortal).toContain("ONE_TIME_TERMS");
    expect(studentPortal).toContain("ONE_TIME_GROUP");
    expect(studentPortal).toContain("oneTimeRank");
    expect(studentPortal).toContain("One-time Fees");
  });

  it("shows the waiver on the head it was applied to", () => {
    expect(studentPortal).toContain("concession");
    expect(studentPortal).toContain("waiver applied");
    // And what the head cost before it, so a waived row doesn't just read as a
    // smaller bill.
    expect(studentPortal).toContain("before waiver");
  });

  it("selects concession from the ledger, since the row can't show what it never fetched", () => {
    expect(studentPortal).toContain("balance, concession, status");
  });

  it("makes every outstanding head individually payable", () => {
    // Was upcoming-only, which left a one-off charge like a meal add-on with no
    // way to settle on its own — only the whole due total or the whole year.
    expect(studentPortal).toContain("{!paid && fee.balance > 0 && (");
    expect(studentPortal).toContain('openPayment("fee", fee.id)');
  });

  it("can settle a whole term in one go, upcoming heads included", () => {
    expect(studentPortal).toContain('openPayment("set", undefined, gPayable.map((r) => r.id))');
    expect(studentPortal).toContain("Pay ₹{gOutstanding.toLocaleString");
  });

  it("charges exactly what the term button says", () => {
    // Header total and the paid set must select on the same predicate.
    expect(studentPortal).toContain("const gPayable = g.rows.filter((r) => r.balance > 0);");
    expect(studentPortal).toContain("const gOutstanding = gPayable.reduce((s, r) => s + r.balance, 0);");
  });

  it("never names a price — the gateway resolves it from the ids", () => {
    // feeSelectionFromBody honours a non-empty fee_ids over the scope, and
    // expectedStudentFeeAmount sums those rows' balances server-side.
    const rzp = read("supabase/functions/razorpay-payment/index.ts");
    expect(rzp).toContain("if (ids.length > 0) return ids.join(\",\");");
    expect(rzp).toContain("const expected = await expectedStudentFeeAmount(");
  });

  it("lists every paid receipt with its PDF", () => {
    expect(studentPortal).toContain("Paid Fee Receipts");
    expect(studentPortal).toContain("Download PDF");
  });

  it("fetches receipts for every student, not just consultant-managed ones", () => {
    // student_fee_due_summary is SECURITY DEFINER and self-scoped, and it is the
    // only path to lead_payments for a student login — so it must not stay
    // behind the zero-ledger-rows branch it used to sit in.
    const call = studentPortal.indexOf('"student_fee_due_summary"');
    const hiddenBranch = studentPortal.indexOf("feeRes.data.length === 0 &&");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(hiddenBranch);
  });
});

describe("shareable link for specific fee rows", () => {
  it("keeps fee_ledger_id on the link instead of flattening it to the head", () => {
    // Dropping it turned "pay this quarter's meal charge" into "pay the
    // earliest unpaid meal charge".
    expect(createLinkFn).toContain("isUuid(a.fee_ledger_id)");
    expect(createLinkFn).toContain("fee_ledger_id: String(a.fee_ledger_id)");
  });

  it("refuses a row that isn't this student's, or is filed under the wrong head", () => {
    expect(createLinkFn).toContain("does not belong to this student");
    expect(createLinkFn).toContain("does not match its fee head");
    expect(createLinkFn).toContain('.eq("student_id", ownerId).in("id", ledgerIds)');
  });

  it("carries the breakup through settlement onto the receipt", () => {
    expect(gatewaySettlement).toContain("fee_ledger_id?: string");
    expect(gatewaySettlement).toContain("allocations: hasAllocations ? link.allocations : null");
  });

  it("lets staff raise the link from the ticked rows", () => {
    expect(studentFeePanel).toContain("openLinkForSelection");
    expect(studentFeePanel).toContain("defaultAllocations={linkAllocations}");
    expect(studentFeePanel).toContain("Send Link");
  });

  it("shows a seeded breakup read-only rather than a second editor", () => {
    expect(sendLinkDialog).toContain("defaultAllocations");
    expect(sendLinkDialog).toContain("{collectingFee && seeded && (");
    expect(sendLinkDialog).toContain("{collectingFee && !seeded && (");
  });

  it("still validates that the breakup equals the amount", () => {
    expect(createLinkFn).toContain("must equal the amount");
  });
});

describe("counsellors: ask for payment, never take it", () => {
  it("can see the ledger of their own students only", () => {
    // The tab was already reachable but empty — fee_ledger's finance policy
    // covers super_admin/campus_admin/accountant/principal, not counsellors.
    expect(counsellorMigration).toContain('CREATE POLICY "Counsellors can view assigned student ledger"');
    expect(counsellorMigration).toContain("FOR SELECT");
    // Reuses the exact predicate behind the students policy they already have,
    // rather than inventing a second notion of "assigned".
    expect(counsellorMigration).toContain("public.can_view_student_via_lead(auth.uid(), student_id)");
  });

  it("checks the cheap role test first so finance scans never pay for can_view_lead", () => {
    const policy = counsellorMigration.slice(counsellorMigration.indexOf("USING ("));
    expect(policy.indexOf("has_role")).toBeLessThan(policy.indexOf("can_view_student_via_lead"));
  });

  it("gets read access only — no insert, update or delete policy", () => {
    expect(counsellorMigration).not.toContain("FOR INSERT");
    expect(counsellorMigration).not.toContain("FOR UPDATE");
    expect(counsellorMigration).not.toContain("FOR DELETE");
    expect(counsellorMigration).not.toContain("FOR ALL");
  });

  it("can issue and send a login link, scoped to their own candidate", () => {
    expect(counsellorMigration).toContain("OR public.can_view_student_via_lead(auth.uid(), _student_id)");
    // The send path authorises against the token's student, not a caller-supplied one.
    expect(counsellorMigration).toContain("public.can_view_student_via_lead(auth.uid(), v_tok.student_id)");
  });

  it("can select rows and raise a link, but the Collect button stays cashier-only", () => {
    expect(studentFeePanel).toContain('const canSendLink = isFinanceRole || ["counsellor", "admission_head"].includes(role || "");');
    expect(studentFeePanel).toContain("const canPick = canCollect || canSendLink;");
    expect(studentFeePanel).toContain("const isPickable = (f: any) => canPick && rowBalance(f) > 0;");
    expect(studentFeePanel).toContain("{canCollect && (\n              <Button size=\"sm\" className=\"gap-1.5\" disabled={pickedTotal <= 0} onClick={() => openCollect(fees)}>");
  });

  it("keeps provisioning, transfers and row deletion out of their reach", () => {
    // Manage and the row-actions column remain isFinanceRole, which excludes them.
    expect(studentFeePanel).toContain("{(canProvision || canReallocate || isFinanceRole) && (");
    expect(studentFeePanel).toContain('const canRemoveRow = (f: any) =>');
    expect(studentFeePanel).toContain('["super_admin", "accountant"].includes(role || "") || hasPermission("fee_structure:manage")');
  });

  it("is already accepted by the payment-link edge function", () => {
    expect(createLinkFn).toContain('"counsellor"');
  });
});

describe("counter search scope", () => {
  it("defaults to students only, with leads behind a switch", () => {
    expect(searchScopeMigration).toContain("_include_leads boolean DEFAULT true");
    expect(searchScopeMigration).toContain("WHERE _include_leads");
    // The counter opens on students; enquiries are opt-in.
    expect(cashierConsole).toContain("useState(false);");
    expect(cashierConsole).toContain("_include_leads: includeLeads");
  });

  it("hides inactive students by default but keeps pre_admitted", () => {
    expect(searchScopeMigration).toContain("NOT _active_only OR st.status IS DISTINCT FROM 'inactive'");
    // A pre_admitted candidate is exactly who pays at a counter, so the filter
    // must be "not inactive", never "= active".
    expect(searchScopeMigration).not.toContain("st.status = 'active'");
    expect(cashierConsole).toContain("_active_only: activeOnly");
    expect(cashierConsole).toContain("Active students only");
  });

  it("re-runs the search when a switch flips, not on the next keystroke", () => {
    expect(cashierConsole).toContain("}, [query, includeLeads, activeOnly]);");
  });

  it("replaces the old signature instead of overloading it", () => {
    // Two signatures would make cashier_search(_q) ambiguous to PostgREST.
    expect(searchScopeMigration).toContain("DROP FUNCTION IF EXISTS public.cashier_search(text);");
  });

  it("badges a surfaced inactive student instead of calling it just 'Student'", () => {
    expect(cashierConsole).toContain('h.stage !== "active"');
  });
});

describe("offer waivers stay on the structure they were granted against", () => {
  it("skips ad-hoc heads when spreading a term waiver", () => {
    // A Q4 offer waiver was landing 5,767 on a meal add-on nobody discounted,
    // and diluting the tuition heads it was actually granted against.
    const marker = "NOT EXISTS (SELECT 1 FROM optional_fee_heads o WHERE o.fee_code_id = fl.fee_code_id)";
    // Both the cap-sum and the distribution loop must exclude them, or the
    // shares stop summing to the waiver.
    expect(adhocWaiverMigration.split(marker).length - 1).toBe(2);
  });

  it("still honours a waiver requested ON an ad-hoc row", () => {
    // The per-row concessions block is untouched: asking for a waiver on the
    // meal charge means the meal charge.
    const perRow = adhocWaiverMigration.slice(
      adhocWaiverMigration.indexOf("UPDATE fee_ledger fl"),
      adhocWaiverMigration.indexOf("SELECT id INTO v_offer"),
    );
    expect(perRow).toContain("WHERE c.fee_ledger_id = fl.id");
    expect(perRow).not.toContain("optional_fee_heads");
  });

  it("recomputes the students already carrying a leaked share", () => {
    expect(adhocWaiverMigration).toContain("PERFORM public.sync_fee_ledger_concessions(r.student_id);");
  });
});

describe("a created payment link stays on screen", () => {
  it("is handed back to the caller instead of dying with the dialog", () => {
    expect(sendLinkDialog).toContain("onCreated?: (payUrl?: string) => void;");
    expect(sendLinkDialog).toContain("onCreated?.(data.pay_url);");
  });

  it("is shown with a copy control on both the counter and the student page", () => {
    expect(studentFeePanel).toContain("setPayLink(payUrl)");
    expect(studentFeePanel).toContain("Payment link copied");
    expect(cashierConsole).toContain("setPayLink(payUrl)");
    expect(cashierConsole).toContain("Payment link copied");
  });
});

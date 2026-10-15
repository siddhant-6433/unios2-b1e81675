import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  applyReceiptQueryFilters,
  buildReceiptCursorFilter,
  buildReceiptExactReferenceFilter,
  buildReceiptReviewPath,
  buildReceiptSearchFilter,
} from "@/lib/financeReceiptSearch";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const readMigration = (suffix: string) => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`No migration found ending in _${suffix}.sql`);
  return readFileSync(join(dir, file), "utf8");
};

const financePage = read("src/pages/Finance.tsx");
const feeCollections = read("src/pages/FeeCollections.tsx");
const summaryMigration = readMigration("finance_summary_match_receipts");

describe("Finance header and receipts collection cards stay aligned", () => {
  it("searches partial receipt numbers, names, and admission numbers", () => {
    expect(buildReceiptSearchFilter(" N269 ", "all")).toBe(
      'person_name.ilike."%N269%",admission_no.ilike."%N269%",receipt_no.ilike."%N269%",transaction_ref.ilike."%N269%",bank_ref_num.ilike."%N269%"',
    );
  });

  it("also searches transaction references and bank references for duplicate-review links", () => {
    expect(buildReceiptSearchFilter("950497896988", "all")).toBe(
      'person_name.ilike."%950497896988%",admission_no.ilike."%950497896988%",receipt_no.ilike."%950497896988%",transaction_ref.ilike."%950497896988%",bank_ref_num.ilike."%950497896988%"',
    );
  });

  it("builds an exact reference filter across both reference columns", () => {
    expect(buildReceiptExactReferenceFilter(" 095049789698 ")).toBe(
      'transaction_ref.eq."095049789698",bank_ref_num.eq."095049789698"',
    );
    expect(buildReceiptExactReferenceFilter("  ")).toBeNull();
  });

  it("routes duplicate reviews to an encoded exact reference search", () => {
    expect(buildReceiptReviewPath(" 9504 9789/698 ")).toBe("/finance?tab=receipts&receipt_ref=9504%209789%2F698");
  });

  it("builds a dated cursor that includes equal-date ties and transitions to null dates", () => {
    expect(buildReceiptCursorFilter({
      paidAt: "2026-08-01T07:05:00.000Z",
      id: "00000000-0000-0000-0000-000000000123",
      source: "lead",
    })).toBe(
      "paid_at.lt.2026-08-01T07:05:00.000Z,and(paid_at.eq.2026-08-01T07:05:00.000Z,id.lt.00000000-0000-0000-0000-000000000123),and(paid_at.eq.2026-08-01T07:05:00.000Z,id.eq.00000000-0000-0000-0000-000000000123,source.lt.lead),paid_at.is.null",
    );
  });

  it("continues through null-dated rows using the id and source tie-breakers", () => {
    expect(buildReceiptCursorFilter({
      paidAt: null,
      id: "00000000-0000-0000-0000-000000000123",
      source: "lead",
    })).toBe(
      "and(paid_at.is.null,id.lt.00000000-0000-0000-0000-000000000123),and(paid_at.is.null,id.eq.00000000-0000-0000-0000-000000000123,source.lt.lead)",
    );
  });

  it("keeps campus scope and unresolved-campus rows when searching", () => {
    expect(buildReceiptSearchFilter("N269", "campus-a")).toBe(
      'and(or(person_name.ilike."%N269%",admission_no.ilike."%N269%",receipt_no.ilike."%N269%",transaction_ref.ilike."%N269%",bank_ref_num.ilike."%N269%"),or(campus_id.eq.campus-a,campus_id.is.null))',
    );
    expect(buildReceiptSearchFilter("", "campus-a")).toBe("campus_id.eq.campus-a,campus_id.is.null");
  });

  it("omits the search filter when there is no query or campus scope", () => {
    expect(buildReceiptSearchFilter("  ", "all")).toBeNull();
  });

  it("escapes PostgREST quoted search values", () => {
    expect(buildReceiptSearchFilter('R\\"-1', "all")).toBe(
      'person_name.ilike."%R\\\\\\"-1%",admission_no.ilike."%R\\\\\\"-1%",receipt_no.ilike."%R\\\\\\"-1%",transaction_ref.ilike."%R\\\\\\"-1%",bank_ref_num.ilike."%R\\\\\\"-1%"',
    );
  });

  it("applies matching search and mode filters before limiting the receipts query", () => {
    const calls: string[] = [];
    const query = {
      or(filter: string) { calls.push(`or:${filter}`); return this; },
      eq(column: "payment_mode", value: string) { calls.push(`eq:${column}:${value}`); return this; },
    };

    expect(applyReceiptQueryFilters(query, "N269", "campus-a", "cash")).toBe(query);
    expect(calls).toEqual([
      'or:and(or(person_name.ilike."%N269%",admission_no.ilike."%N269%",receipt_no.ilike."%N269%",transaction_ref.ilike."%N269%",bank_ref_num.ilike."%N269%"),or(campus_id.eq.campus-a,campus_id.is.null))',
      "eq:payment_mode:cash",
    ]);
    expect(applyReceiptQueryFilters(query, "", "all", "all")).toBe(query);
    expect(calls).toHaveLength(2);
  });

  it("combines search, campus, and cursor predicates into one OR parameter", () => {
    const calls: string[] = [];
    const query = {
      or(filter: string) { calls.push(`or:${filter}`); return this; },
      eq(column: "payment_mode", value: string) { calls.push(`eq:${column}:${value}`); return this; },
    };
    const cursor = {
      paidAt: null,
      id: "00000000-0000-0000-0000-000000000123",
      source: "lead" as const,
    };

    applyReceiptQueryFilters(query, "N565", "campus-a", "upi", cursor);

    expect(calls).toEqual([
      'or:and(or(person_name.ilike."%N565%",admission_no.ilike."%N565%",receipt_no.ilike."%N565%",transaction_ref.ilike."%N565%",bank_ref_num.ilike."%N565%"),or(campus_id.eq.campus-a,campus_id.is.null),or(and(paid_at.is.null,id.lt.00000000-0000-0000-0000-000000000123),and(paid_at.is.null,id.eq.00000000-0000-0000-0000-000000000123,source.lt.lead)))',
      "eq:payment_mode:upi",
    ]);
  });

  it("keeps exact reference, campus, and cursor filters in one PostgREST OR", () => {
    const calls: string[] = [];
    const query = {
      or(filter: string) { calls.push(`or:${filter}`); return this; },
      eq(column: "payment_mode", value: string) { calls.push(`eq:${column}:${value}`); return this; },
    };
    const cursor = {
      paidAt: "2026-08-01T07:05:00.000Z",
      id: "00000000-0000-0000-0000-000000000123",
      source: "lead" as const,
    };

    applyReceiptQueryFilters(query, "095049789698", "campus-a", "all", cursor, "095049789698");

    expect(calls).toEqual([
      'or:and(or(transaction_ref.eq."095049789698",bank_ref_num.eq."095049789698"),or(campus_id.eq.campus-a,campus_id.is.null),or(paid_at.lt.2026-08-01T07:05:00.000Z,and(paid_at.eq.2026-08-01T07:05:00.000Z,id.lt.00000000-0000-0000-0000-000000000123),and(paid_at.eq.2026-08-01T07:05:00.000Z,id.eq.00000000-0000-0000-0000-000000000123,source.lt.lead),paid_at.is.null))',
    ]);
  });

  it("uses the same IST half-open window in the RPC and the receipts query", () => {
    expect(summaryMigration).toContain("_from::timestamp AT TIME ZONE 'Asia/Kolkata'");
    expect(summaryMigration).toContain("(_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'");
    expect(feeCollections).toContain("indiaDayStartIso(rangeFrom)");
    expect(feeCollections).toContain("indiaDayEndExclusiveIso(rangeTo)");
    expect(feeCollections).not.toContain("T00:00:00`");
    expect(feeCollections).not.toContain("T23:59:59");
    expect(feeCollections).not.toContain("toISOString().slice(0, 10)");
  });

  it("drops consultant credit notes from both the RPC total and the receipts count", () => {
    expect(summaryMigration).toContain("payment_mode IS DISTINCT FROM 'consultant_credit_note'");
    expect(feeCollections).toContain("collectedRows.length");
  });

  it("keeps unresolved campus rows in a campus-scoped summary, matching the list", () => {
    expect(summaryMigration).toContain("vp.campus_id IS NULL");
    expect(feeCollections).toContain("matchesCampus(p.students?.campus_id, selectedCampusId)");
  });

  it("lets office_admin read the header card they already see receipts for", () => {
    expect(summaryMigration).toContain("has_role(auth.uid(),'office_admin')");
  });

  it("reloads PostgREST so _from/_to actually bind", () => {
    expect(summaryMigration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it("feeds the header date range into the embedded receipts list", () => {
    expect(financePage).toContain("<FeeCollections embedded fromDate={fromDate} toDate={toDate} />");
    expect(feeCollections).toContain("formatCompactINR(todayTotal)");
  });

  it("filters receipt searches in the payments query before applying the row limit", () => {
    expect(feeCollections).toContain("[rangeFrom, rangeTo, search, exactReference, modeFilter, selectedCampusId]");
    expect(feeCollections).toContain("applyReceiptQueryFilters(query, search, selectedCampusId, modeFilter, currentCursor, exactReference)");
    const filterApply = feeCollections.indexOf("applyReceiptQueryFilters(query, search, selectedCampusId, modeFilter, currentCursor, exactReference)");
    const rowLimit = feeCollections.indexOf("query = query.limit(PAGE_SIZE + 1)");
    expect(filterApply).toBeGreaterThan(-1);
    expect(filterApply).toBeLessThan(rowLimit);
  });

  it("ignores stale search responses", () => {
    expect(feeCollections).toContain("const requestId = ++fetchRequestId.current");
    expect(feeCollections).toContain("if (requestId !== fetchRequestId.current) return");
  });

  it("does not repeat Total Collected in the Finance header row", () => {
    expect(financePage).not.toContain('label: "Total Collected"');
    expect(feeCollections).toContain("Today's Collections");
  });

  it("shows retryable errors and uses keyset paging for complete receipt history", () => {
    expect(feeCollections).toContain("setLoadError");
    expect(feeCollections).toContain("Retry receipts");
    expect(feeCollections).toContain("PAGE_SIZE + 1");
    expect(feeCollections).toContain('nullsFirst: false');
    expect(feeCollections).toContain("currentCursor");
  });

  it("opens exact reference searches across all time from Finance", () => {
    expect(financePage).toContain('searchParams.get("receipt_ref")');
    expect(financePage).toContain('useState<DatePreset>(() => searchParams.get("receipt_ref") ? "all" : "today")');
    expect(feeCollections).toContain('searchParams.get("receipt_ref")');
    expect(feeCollections).toContain("exactReference = receiptRef && search.trim() === receiptRef");
  });

  it("repairs only through an authorized, reasoned database RPC", () => {
    const migration = readMigration("finance_receipt_link_repair");
    const offlineDialog = read("src/components/finance/OfflinePaymentDialog.tsx");
    const repairDialog = read("src/components/finance/RepairReceiptLinkDialog.tsx");
    expect(migration).toContain("repair_confirmed_lead_payment_student_link");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("FOR SHARE");
    expect(migration).toContain("app.audit_reason");
    expect(migration).toContain("REVOKE UPDATE ON public.lead_payments FROM authenticated");
    expect(migration).toContain("user_can_access_assigned_campus");
    expect(migration).toContain("finance:create");
    expect(offlineDialog).toContain("Review existing receipt");
    expect(offlineDialog).toContain('supabase.from("v_all_payments" as never)');
    expect(offlineDialog).toContain("candidate_name: exact.person_name");
    expect(offlineDialog).toContain("disabled={submitting || cashBlocked || checkingReference || !!duplicatePayment || !!referenceCheckError || !!receiptGenerationIssue}");
    expect(offlineDialog).toContain("Could not verify payment reference");
    expect(offlineDialog).toContain("Retry reference check");
    expect(offlineDialog).toContain("await verifyDuplicateReference(ref) !== \"clear\"");
    expect(offlineDialog).toContain("lead_payments_confirmed_bank_ref_uidx");
    expect(repairDialog).toContain("Identity mismatch");
    expect(repairDialog).toContain("I verified the receipt reference and the student identity above.");
    expect(repairDialog).toContain('label="Reason for correction"');
    expect(repairDialog).toContain('setStudentSearchRetryKey((value) => value + 1)');
  });

  it("provides the same confirmed receipt columns to Finance and the student panel", () => {
    const studentPanel = read("src/components/finance/StudentFeePanel.tsx");
    const migration = readMigration("finance_receipt_link_repair");
    expect(studentPanel).toContain('.from("v_all_payments" as any)');
    expect(studentPanel).toContain("student_id.eq.${student.id}");
    expect(studentPanel).toContain("receipt_url");
    expect(migration).toContain("lp.receipt_url");
    expect(migration).toContain("lp.application_id");
    expect(migration).toContain("lp.bank_ref_num");
  });
});

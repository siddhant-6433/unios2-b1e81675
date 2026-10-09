import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { applyReceiptQueryFilters, buildReceiptSearchFilter } from "@/lib/financeReceiptSearch";

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
      'person_name.ilike."%N269%",admission_no.ilike."%N269%",receipt_no.ilike."%N269%"',
    );
  });

  it("keeps campus scope and unresolved-campus rows when searching", () => {
    expect(buildReceiptSearchFilter("N269", "campus-a")).toBe(
      'and(or(person_name.ilike."%N269%",admission_no.ilike."%N269%",receipt_no.ilike."%N269%"),or(campus_id.eq.campus-a,campus_id.is.null))',
    );
    expect(buildReceiptSearchFilter("", "campus-a")).toBe("campus_id.eq.campus-a,campus_id.is.null");
  });

  it("omits the search filter when there is no query or campus scope", () => {
    expect(buildReceiptSearchFilter("  ", "all")).toBeNull();
  });

  it("escapes PostgREST quoted search values", () => {
    expect(buildReceiptSearchFilter('R\\"-1', "all")).toBe(
      'person_name.ilike."%R\\\\\\"-1%",admission_no.ilike."%R\\\\\\"-1%",receipt_no.ilike."%R\\\\\\"-1%"',
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
      'or:and(or(person_name.ilike."%N269%",admission_no.ilike."%N269%",receipt_no.ilike."%N269%"),or(campus_id.eq.campus-a,campus_id.is.null))',
      "eq:payment_mode:cash",
    ]);
    expect(applyReceiptQueryFilters(query, "", "all", "all")).toBe(query);
    expect(calls).toHaveLength(2);
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
    expect(feeCollections).toContain("[rangeFrom, rangeTo, search, modeFilter, selectedCampusId]");
    expect(feeCollections).toContain("applyReceiptQueryFilters(query, search, selectedCampusId, modeFilter)");
    const filterApply = feeCollections.indexOf("applyReceiptQueryFilters(query, search, selectedCampusId, modeFilter)");
    const rowLimit = feeCollections.indexOf("query = query.limit(500)");
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
});

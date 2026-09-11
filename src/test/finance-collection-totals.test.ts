import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

  it("does not repeat Total Collected in the Finance header row", () => {
    expect(financePage).not.toContain('label: "Total Collected"');
    expect(feeCollections).toContain("Today's Collections");
  });
});

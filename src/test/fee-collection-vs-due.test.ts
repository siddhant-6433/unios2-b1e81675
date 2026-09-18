import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateKpis,
  buildDetailedExportRows,
  buildSummaryExportRows,
  feeHeadKey,
  feeHeadsForLines,
  filterLinesForPdfSelection,
  groupByProgrammeBatch,
  pdfFeeHeadOptionsForLines,
  pdfPeriodGroupsForLines,
  planCollectionVsDuePdfParts,
  pivotStudents,
  type CollectionVsDueLine,
} from "@/lib/feeCollectionVsDue";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const readMigration = (suffix: string) => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`No migration found ending in _${suffix}.sql`);
  return readFileSync(join(dir, file), "utf8");
};

const line = (over: Partial<CollectionVsDueLine>): CollectionVsDueLine => ({
  student_id: "s1",
  name: "Asha Verma",
  admission_no: "AN-1",
  campus_name: "Greater Noida",
  course_id: "c1",
  course_name: "B.Sc Nursing",
  batch_name: "2025-26",
  session_name: "2025-26",
  fee_ledger_id: "l1",
  fee_code: "TUITION",
  fee_name: "Tuition",
  term: "year_1",
  due_amount: 40000,
  collected_amount: 10000,
  balance: 30000,
  due_date: "2026-04-01",
  collected_date: "2026-04-10",
  late_fine_due: 500,
  late_fine_collected: 0,
  is_overdue: true,
  ...over,
});

describe("fee collection vs due grouping", () => {
  it("sections lines by campus, programme and batch", () => {
    const sections = groupByProgrammeBatch([
      line({ student_id: "s1" }),
      line({ student_id: "s2", name: "Bina", admission_no: "AN-2", fee_ledger_id: "l2" }),
      line({
        student_id: "s3",
        name: "Chetna",
        course_name: "GNM",
        batch_name: "2024-25",
        fee_ledger_id: "l3",
      }),
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[0].course_name).toBe("B.Sc Nursing");
    expect(sections[0].lines).toHaveLength(2);
    expect(sections[1].course_name).toBe("GNM");
  });

  it("sorts school grade sections from lowest grade to highest", () => {
    const sections = groupByProgrammeBatch([
      line({ student_id: "s9", course_name: "Grade IX", batch_name: "A", fee_ledger_id: "l9" }),
      line({ student_id: "s2", course_name: "Grade II", batch_name: "A", fee_ledger_id: "l2" }),
      line({ student_id: "s5", course_name: "Grade V", batch_name: "A", fee_ledger_id: "l5" }),
      line({ student_id: "sn", course_name: "Nur", batch_name: "A", fee_ledger_id: "ln" }),
      line({ student_id: "s1", course_name: "LKG", batch_name: "A", fee_ledger_id: "l1" }),
      line({ student_id: "su", course_name: "UKG", batch_name: "A", fee_ledger_id: "lu" }),
      line({ student_id: "sg1", course_name: "Grade 1", batch_name: "A", fee_ledger_id: "lg1" }),
      line({ student_id: "s12", course_name: "Grade XII", batch_name: "A", fee_ledger_id: "l12" }),
    ]);
    expect(sections.map((section) => section.course_name)).toEqual([
      "Nur",
      "LKG",
      "UKG",
      "Grade 1",
      "Grade II",
      "Grade V",
      "Grade IX",
      "Grade XII",
    ]);
  });

  it("pivots each fee head into due and collected columns per student", () => {
    const rows = pivotStudents([
      line({ fee_ledger_id: "a", fee_code: "TUITION", term: "year_1", due_amount: 40000, collected_amount: 10000 }),
      line({
        fee_ledger_id: "b",
        fee_code: "HOSTEL",
        fee_name: "Hostel",
        term: "year_1",
        due_amount: 20000,
        collected_amount: 20000,
        balance: 0,
        is_overdue: false,
        late_fine_due: 0,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].amounts[feeHeadKey({ fee_code: "TUITION", term: "year_1" })]).toMatchObject({
      due: 40000,
      collected: 10000,
      balance: 30000,
      overdue: true,
    });
    expect(rows[0].totalDue).toBe(60000);
    expect(rows[0].totalCollected).toBe(30000);
  });

  it("orders fee-head columns by earliest due date", () => {
    const heads = feeHeadsForLines([
      line({ fee_code: "HOSTEL", fee_name: "Hostel", due_date: "2026-06-01" }),
      line({ fee_code: "TUITION", fee_name: "Tuition", due_date: "2026-04-01", fee_ledger_id: "l2" }),
    ]);
    expect(heads.map((h) => h.fee_code)).toEqual(["TUITION", "HOSTEL"]);
  });

  it("builds a summary export with one due/collected pair per head", () => {
    const rows = buildSummaryExportRows([
      line({}),
      line({
        student_id: "s2",
        name: "Bina",
        admission_no: "AN-2",
        fee_ledger_id: "l2",
        due_amount: 40000,
        collected_amount: 0,
        balance: 40000,
      }),
    ], {});
    expect(rows).toHaveLength(2);
    expect(rows[0]["Tuition · Year 1 Due"]).toBe(40000);
    expect(rows[0]["Tuition · Year 1 Collected"]).toBe(10000);
    expect(rows[0]["Total Due"]).toBe(40000);
  });

  it("includes due date, collected date and late fine on the detailed export", () => {
    const rows = buildDetailedExportRows([line({
      receipt_no: "NIMT-001",
      payment_mode: "bank_transfer",
      transaction_ref: "UTR-1",
      payment_type: "other",
    })], {});
    expect(rows[0]["Due Date"]).toBe("2026-04-01");
    expect(rows[0]["Collected Date"]).toBe("2026-04-10");
    expect(rows[0]["Receipt No"]).toBe("NIMT-001");
    expect(rows[0]["Payment Mode"]).toBe("bank transfer");
    expect(rows[0]["Transaction Ref"]).toBe("UTR-1");
    expect(rows[0]["Late Fine Due"]).toBe(500);
    expect(rows[0]["Late Fine Paid"]).toBe(0);
  });

  it("aggregates late fines separately from parent due/collected", () => {
    const kpis = aggregateKpis([line({}), line({ student_id: "s2", fee_ledger_id: "l2", late_fine_due: 0 })]);
    expect(kpis.students).toBe(2);
    expect(kpis.due).toBe(80000);
    expect(kpis.lateDue).toBe(500);
  });

  it("does not double-count a student+term late fine across two fee heads", () => {
    const kpis = aggregateKpis([
      line({ fee_ledger_id: "a", fee_code: "TUITION", late_fine_due: 500, late_fine_collected: 100 }),
      line({
        fee_ledger_id: "b",
        fee_code: "HOSTEL",
        fee_name: "Hostel",
        late_fine_due: 500,
        late_fine_collected: 100,
      }),
    ]);
    expect(kpis.lateDue).toBe(500);
    expect(kpis.lateCollected).toBe(100);
    expect(kpis.due).toBe(80000);
  });

  it("groups PDF columns by due month and term, including missing due dates", () => {
    const groups = pdfPeriodGroupsForLines([
      line({ due_date: "2026-04-01", term: "year_1" }),
      line({ fee_ledger_id: "l2", due_date: null, term: "one_time" }),
      line({ fee_ledger_id: "l3", due_date: "2026-05-01", term: "year_1" }),
    ], {});
    expect(groups.map((g) => g.label)).toEqual([
      "No due date · One Time",
      "Apr 2026 · Year 1",
      "May 2026 · Year 1",
    ]);
  });

  it("auto-packs summary PDF fee heads into readable parts", () => {
    const lines = ["A", "B", "C", "D", "E"].map((code, i) => line({
      fee_ledger_id: `l-${code}`,
      fee_code: code,
      fee_name: `Head ${code}`,
      due_date: "2026-04-01",
      due_amount: 1000 + i,
    }));
    const parts = planCollectionVsDuePdfParts(lines, {}, {}, 4);
    expect(parts).toHaveLength(2);
    expect(parts[0].heads).toHaveLength(4);
    expect(parts[1].heads).toHaveLength(1);
    expect(parts[0].periodLabel).toBe("Apr 2026 · Year 1");
    expect(parts[1].periodLabel).toBe("Apr 2026 · Year 1");
    expect(parts.map((part) => part.periodPartNo)).toEqual([1, 2]);
    expect(parts.map((part) => part.periodPartCount)).toEqual([2, 2]);
  });

  it("filters PDF rows by selected month and selected fee head intersection", () => {
    const lines = [
      line({ fee_ledger_id: "apr-tuition", fee_code: "TUITION", fee_name: "Tuition", due_date: "2026-04-01" }),
      line({ fee_ledger_id: "may-tuition", fee_code: "TUITION", fee_name: "Tuition", due_date: "2026-05-01" }),
      line({ fee_ledger_id: "apr-hostel", fee_code: "HOSTEL", fee_name: "Hostel", due_date: "2026-04-01" }),
    ];
    const periods = pdfPeriodGroupsForLines(lines, {});
    const heads = pdfFeeHeadOptionsForLines(lines, {});
    const apr = periods.find((p) => p.label.startsWith("Apr"));
    const aprHostel = heads.find((h) => h.periodKey === apr?.key && h.fee_code === "HOSTEL");
    const filtered = filterLinesForPdfSelection(lines, {
      periodKeys: apr ? [apr.key] : [],
      headKeys: aprHostel ? [aprHostel.key] : [],
    }, {});
    expect(filtered.map((l) => l.fee_ledger_id)).toEqual(["apr-hostel"]);
  });
});

describe("fee collection vs due wiring", () => {
  const sql = readMigration("fee_collection_vs_due_report");
  const finance = read("src/pages/Finance.tsx");
  const report = read("src/components/finance/FeeCollectionVsDueReport.tsx");

  it("RPC is gated like the fee dues report and supports the report scopes", () => {
    const collectedSql = readMigration("fee_collection_collected_scope");
    expect(collectedSql).toContain("fee_collection_vs_due_report");
    expect(sql).toContain("has_permission(auth.uid(), 'finance:view')");
    expect(sql).toContain("'till_date'");
    expect(sql).toContain("'entire_batch'");
    expect(sql).toContain("'overdue'");
    expect(collectedSql).toContain("'collected'");
    expect(collectedSql).toContain("lp.receipt_no");
    expect(collectedSql).toContain("lp.payment_mode");
    expect(sql).toContain("fl.due_date IS NULL OR fl.due_date <= v_as_of");
    expect(sql).toContain("fl.due_date < v_as_of AND fl.balance > 0");
  });

  it("does not list LATE-FEE as its own head and hangs the fine off the parent term once", () => {
    expect(sql).toContain("fc.code IS DISTINCT FROM 'LATE-FEE'");
    expect(sql).toContain("late.term = ('late_' || fl.term)");
    expect(sql).toContain("late_fine_due");
    expect(sql).toContain("PARTITION BY fl.student_id, fl.term");
    expect(sql).toContain("CASE WHEN term_rn = 1 THEN late_due_raw ELSE 0 END");
    expect(sql).toContain("MAX((lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date)");
  });

  it("mounts as a Finance Reports sub-tab next to Fee Dues", () => {
    const lib = read("src/lib/feeCollectionVsDue.ts");
    expect(finance).toContain('value: "collection", label: "Collection vs Due"');
    expect(finance).toContain("<FeeCollectionVsDueReport />");
    expect(lib).toContain('value: "till_date", label: "Due till date"');
    expect(lib).toContain('value: "entire_batch", label: "Entire batch"');
    expect(lib).toContain('value: "overdue", label: "Overdue only"');
    expect(lib).toContain('value: "collected", label: "Collected only"');
    expect(report).toContain("COLLECTION_VS_DUE_SCOPES");
    expect(report).toContain("Detailed");
    expect(report).toContain("exportCollectedReceiptsPdf");
    expect(report).toContain("Late Fine Due");
  });
});

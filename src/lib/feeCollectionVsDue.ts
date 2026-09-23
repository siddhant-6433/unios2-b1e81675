import type { ExportRow } from "@/lib/xlsxExport";
import type { FeeStructureMetadata } from "@/lib/feeTermLabels";
import { feeTermLabel } from "@/lib/feeTermLabels";

export type CollectionVsDueScope = "till_date" | "entire_batch" | "overdue" | "collected";
export type CollectionVsDueView = "summary" | "detailed" | "monthly";

export type CollectionVsDueLine = {
  student_id: string;
  student_status?: "active" | "archived" | "unknown";
  name: string | null;
  admission_no: string | null;
  campus_name: string | null;
  course_id: string | null;
  course_name: string | null;
  batch_name: string | null;
  session_name: string | null;
  fee_ledger_id: string;
  fee_code: string | null;
  fee_name: string | null;
  term: string | null;
  due_amount: number;
  collected_amount: number;
  balance: number;
  due_date: string | null;
  collected_date: string | null;
  late_fine_due: number;
  late_fine_collected: number;
  is_overdue: boolean;
  payment_id?: string | null;
  receipt_no?: string | null;
  payment_mode?: string | null;
  transaction_ref?: string | null;
  payment_type?: string | null;
  payment_date?: string | null;
  fee_ledger_payment_id?: string | null;
};

export type CollectionVsDueDims = {
  campus_name: string | null;
  course_name: string | null;
  batch_name: string | null;
  session_name: string | null;
};

export const COLLECTION_VS_DUE_SCOPES: { value: CollectionVsDueScope; label: string }[] = [
  { value: "till_date", label: "Due till date" },
  { value: "entire_batch", label: "Entire batch" },
  { value: "overdue", label: "Overdue only" },
  { value: "collected", label: "Collected only" },
];

export const displayVal = (v: string | null | undefined) => v || "—";

export function feeHeadKey(line: Pick<CollectionVsDueLine, "fee_code" | "term">) {
  return `${line.fee_code || ""}::${line.term || ""}`;
}

export function feeHeadLabel(
  line: Pick<CollectionVsDueLine, "fee_name" | "fee_code" | "term" | "course_id">,
  metaByCourse: Record<string, FeeStructureMetadata>,
) {
  const name = line.fee_name || line.fee_code || "Fee";
  const term = feeTermLabel(line.term || "", metaByCourse[line.course_id || ""]);
  const normalized = String(line.term || "").trim().toLowerCase();
  if (!normalized || ["one_time", "onetime", "na", "n/a"].includes(normalized)) return name;
  return `${name} · ${term}`;
}

export type FeeHeadColumn = {
  key: string;
  fee_code: string;
  fee_name: string;
  term: string;
  course_id: string | null;
};

export type PdfPeriodGroup = {
  key: string;
  label: string;
  sortKey: string;
};

export type PdfFeeHeadOption = FeeHeadColumn & {
  label: string;
  amountKey: string;
  periodKey: string;
  periodLabel: string;
  sortKey: string;
};

export type PdfPart = {
  partNo: number;
  title: string;
  periodKey: string;
  periodLabel: string;
  periodPartNo: number;
  periodPartCount: number;
  heads: PdfFeeHeadOption[];
};

export type PdfSelection = {
  periodKeys?: string[];
  headKeys?: string[];
};

export type ProgrammeBatchSection = {
  key: string;
  campus_name: string;
  course_name: string;
  batch_name: string;
  lines: CollectionVsDueLine[];
};

export function sectionKey(line: CollectionVsDueDims) {
  return [displayVal(line.campus_name), displayVal(line.course_name), displayVal(line.batch_name)].join("||");
}

const romanGradeValues: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
};

export function programmeGradeRank(name: string | null | undefined) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return 1000;
  if (/\b(pre\s*primary|nur|nursery)\b/.test(normalized)) return 0;
  if (/\b(lkg|lower\s*kg|lower\s*kindergarten)\b/.test(normalized)) return 1;
  if (/\b(ukg|upper\s*kg|upper\s*kindergarten|kg)\b/.test(normalized)) return 2;

  const gradeMatch = normalized.match(/\b(?:grade|class|standard|std)\s*([ivx]+|\d{1,2})\b/);
  const looseRomanMatch = normalized.match(/\b([ivx]{1,4})\b/);
  const looseNumberMatch = normalized.match(/\b(\d{1,2})\b/);
  const raw = gradeMatch?.[1] || looseRomanMatch?.[1] || looseNumberMatch?.[1];
  if (!raw) return 1000;
  const grade = /^\d+$/.test(raw) ? Number(raw) : romanGradeValues[raw];
  return grade >= 1 && grade <= 12 ? 2 + grade : 1000;
}

export function groupByProgrammeBatch(lines: CollectionVsDueLine[]): ProgrammeBatchSection[] {
  const map = new Map<string, ProgrammeBatchSection>();
  for (const line of lines) {
    const key = sectionKey(line);
    let section = map.get(key);
    if (!section) {
      section = {
        key,
        campus_name: displayVal(line.campus_name),
        course_name: displayVal(line.course_name),
        batch_name: displayVal(line.batch_name),
        lines: [],
      };
      map.set(key, section);
    }
    section.lines.push(line);
  }
  return [...map.values()].sort((a, b) =>
    a.campus_name.localeCompare(b.campus_name)
    || programmeGradeRank(a.course_name) - programmeGradeRank(b.course_name)
    || a.course_name.localeCompare(b.course_name)
    || a.batch_name.localeCompare(b.batch_name),
  );
}

export function feeHeadsForLines(lines: CollectionVsDueLine[]): FeeHeadColumn[] {
  const byKey = new Map<string, { col: FeeHeadColumn; due: string | null }>();
  for (const line of lines) {
    const key = feeHeadKey(line);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        col: {
          key,
          fee_code: line.fee_code || "",
          fee_name: line.fee_name || line.fee_code || "Fee",
          term: line.term || "",
          course_id: line.course_id,
        },
        due: line.due_date,
      });
      continue;
    }
    if (line.due_date && (!existing.due || line.due_date < existing.due)) existing.due = line.due_date;
  }
  return [...byKey.values()]
    .sort((a, b) =>
      (a.due || "").localeCompare(b.due || "")
      || a.col.fee_name.localeCompare(b.col.fee_name)
      || a.col.term.localeCompare(b.col.term),
    )
    .map((x) => x.col);
}

function periodFromLine(line: Pick<CollectionVsDueLine, "due_date" | "term" | "course_id">, metaByCourse: Record<string, FeeStructureMetadata>): PdfPeriodGroup {
  const term = feeTermLabel(line.term || "", metaByCourse[line.course_id || ""]);
  const hasTerm = term && term !== "—";
  if (!line.due_date) {
    return {
      key: `no_due_date::${line.term || ""}`,
      label: hasTerm ? `No due date · ${term}` : "No due date",
      sortKey: `0000-00::${line.term || ""}`,
    };
  }
  const [year, month] = line.due_date.split("-");
  const monthIndex = Math.max(0, Math.min(11, Number(month || "1") - 1));
  const monthLabel = `${new Date(Number(year), monthIndex, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  })}`;
  const label = hasTerm && term !== monthLabel ? `${monthLabel} · ${term}` : monthLabel;
  return {
    key: `${year}-${month}::${line.term || ""}`,
    label,
    sortKey: `${year}-${month}::${line.term || ""}`,
  };
}

export function pdfPeriodGroupsForLines(
  lines: CollectionVsDueLine[],
  metaByCourse: Record<string, FeeStructureMetadata>,
): PdfPeriodGroup[] {
  const byKey = new Map<string, PdfPeriodGroup>();
  for (const line of lines) {
    const group = periodFromLine(line, metaByCourse);
    if (!byKey.has(group.key)) byKey.set(group.key, group);
  }
  return [...byKey.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.label.localeCompare(b.label));
}

export function pdfFeeHeadOptionsForLines(
  lines: CollectionVsDueLine[],
  metaByCourse: Record<string, FeeStructureMetadata>,
): PdfFeeHeadOption[] {
  const byKey = new Map<string, { option: PdfFeeHeadOption; due: string | null }>();
  for (const line of lines) {
    const period = periodFromLine(line, metaByCourse);
    const key = `${period.key}::${feeHeadKey(line)}`;
    const existing = byKey.get(key);
    if (!existing) {
      const col: FeeHeadColumn = {
        key: feeHeadKey(line),
        fee_code: line.fee_code || "",
        fee_name: line.fee_name || line.fee_code || "Fee",
        term: line.term || "",
        course_id: line.course_id,
      };
      byKey.set(key, {
        option: {
          ...col,
          key,
          amountKey: col.key,
          label: col.fee_name || col.fee_code || "Fee",
          periodKey: period.key,
          periodLabel: period.label,
          sortKey: period.sortKey,
        },
        due: line.due_date,
      });
      continue;
    }
    if (line.due_date && (!existing.due || line.due_date < existing.due)) existing.due = line.due_date;
  }
  return [...byKey.values()]
    .sort((a, b) =>
      a.option.sortKey.localeCompare(b.option.sortKey)
      || (a.due || "").localeCompare(b.due || "")
      || a.option.fee_name.localeCompare(b.option.fee_name)
      || a.option.term.localeCompare(b.option.term),
    )
    .map((x) => x.option);
}

export function filterLinesForPdfSelection(
  lines: CollectionVsDueLine[],
  selection: PdfSelection,
  metaByCourse: Record<string, FeeStructureMetadata>,
): CollectionVsDueLine[] {
  const periodKeys = new Set(selection.periodKeys || []);
  const headKeys = new Set(selection.headKeys || []);
  if (periodKeys.size === 0 && headKeys.size === 0) return lines;
  return lines.filter((line) => {
    const period = periodFromLine(line, metaByCourse);
    const headKey = `${period.key}::${feeHeadKey(line)}`;
    return (periodKeys.size === 0 || periodKeys.has(period.key)) &&
      (headKeys.size === 0 || headKeys.has(headKey));
  });
}

export function planCollectionVsDuePdfParts(
  lines: CollectionVsDueLine[],
  metaByCourse: Record<string, FeeStructureMetadata>,
  selection: PdfSelection = {},
  maxHeadsPerPart = 3,
): PdfPart[] {
  const selectedLines = filterLinesForPdfSelection(lines, selection, metaByCourse);
  const heads = pdfFeeHeadOptionsForLines(selectedLines, metaByCourse);
  const byPeriod = new Map<string, PdfFeeHeadOption[]>();
  for (const head of heads) {
    const group = byPeriod.get(head.periodKey) || [];
    group.push(head);
    byPeriod.set(head.periodKey, group);
  }
  const parts: PdfPart[] = [];
  const periodOrder = pdfPeriodGroupsForLines(selectedLines, metaByCourse)
    .filter((period) => byPeriod.has(period.key));
  for (const period of periodOrder) {
    const periodHeads = byPeriod.get(period.key) || [];
    const periodPartCount = Math.max(1, Math.ceil(periodHeads.length / maxHeadsPerPart));
    for (let i = 0; i < periodHeads.length; i += maxHeadsPerPart) {
      const chunk = periodHeads.slice(i, i + maxHeadsPerPart);
      const periodPartNo = Math.floor(i / maxHeadsPerPart) + 1;
      parts.push({
        partNo: parts.length + 1,
        title: `Part ${parts.length + 1}`,
        periodKey: period.key,
        periodLabel: period.label,
        periodPartNo,
        periodPartCount,
        heads: chunk,
      });
    }
  }
  return parts;
}

export type HeadAmounts = {
  due: number;
  collected: number;
  balance: number;
  overdue: boolean;
  upcoming: boolean;
};

export type SummaryStudentRow = {
  student_id: string;
  student_status: CollectionVsDueLine["student_status"];
  name: string;
  admission_no: string;
  campus_name: string;
  course_name: string;
  batch_name: string;
  session_name: string;
  amounts: Record<string, HeadAmounts>;
  totalDue: number;
  totalCollected: number;
  totalBalance: number;
  overdueAmount: number;
};

export function pivotStudents(lines: CollectionVsDueLine[]): SummaryStudentRow[] {
  const byStudent = new Map<string, SummaryStudentRow>();
  for (const line of lines) {
    let row = byStudent.get(line.student_id);
    if (!row) {
      row = {
        student_id: line.student_id,
        student_status: line.student_status,
        name: displayVal(line.name),
        admission_no: displayVal(line.admission_no),
        campus_name: displayVal(line.campus_name),
        course_name: displayVal(line.course_name),
        batch_name: displayVal(line.batch_name),
        session_name: displayVal(line.session_name),
        amounts: {},
        totalDue: 0,
        totalCollected: 0,
        totalBalance: 0,
        overdueAmount: 0,
      };
      byStudent.set(line.student_id, row);
    }
    const key = feeHeadKey(line);
    const due = Number(line.due_amount || 0);
    const collected = Number(line.collected_amount || 0);
    const balance = Number(line.balance || 0);
    const prev = row.amounts[key] || { due: 0, collected: 0, balance: 0, overdue: false, upcoming: false };
    row.amounts[key] = {
      due: prev.due + due,
      collected: prev.collected + collected,
      balance: prev.balance + balance,
      overdue: prev.overdue || !!line.is_overdue,
      upcoming: prev.upcoming || (!line.is_overdue && balance > 0),
    };
    row.totalDue += due;
    row.totalCollected += collected;
    row.totalBalance += balance;
    if (line.is_overdue) row.overdueAmount += balance;
  }
  return [...byStudent.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.admission_no.localeCompare(b.admission_no),
  );
}

export type CollectionVsDueKpis = {
  due: number;
  collected: number;
  balance: number;
  overdue: number;
  lateDue: number;
  lateCollected: number;
  students: number;
};

export function aggregateKpis(lines: CollectionVsDueLine[]): CollectionVsDueKpis {
  const students = new Set<string>();
  // Late fines are student+term, not per head. Take the max on each term so a
  // Tuition + Hostel pair for the same year does not double the fine in KPIs.
  const lateByTerm = new Map<string, { due: number; collected: number }>();
  const acc: CollectionVsDueKpis = {
    due: 0,
    collected: 0,
    balance: 0,
    overdue: 0,
    lateDue: 0,
    lateCollected: 0,
    students: 0,
  };
  for (const line of lines) {
    students.add(line.student_id);
    acc.due += Number(line.due_amount || 0);
    acc.collected += Number(line.collected_amount || 0);
    acc.balance += Number(line.balance || 0);
    if (line.is_overdue) acc.overdue += Number(line.balance || 0);
    const lateKey = `${line.student_id}::${line.term || ""}`;
    const prev = lateByTerm.get(lateKey) || { due: 0, collected: 0 };
    lateByTerm.set(lateKey, {
      due: Math.max(prev.due, Number(line.late_fine_due || 0)),
      collected: Math.max(prev.collected, Number(line.late_fine_collected || 0)),
    });
  }
  for (const late of lateByTerm.values()) {
    acc.lateDue += late.due;
    acc.lateCollected += late.collected;
  }
  acc.students = students.size;
  return acc;
}

const withSerial = (rows: ExportRow[]): ExportRow[] =>
  rows.map((row, i) => ({ "S. No.": i + 1, ...row }));

export function buildSummaryExportRows(
  lines: CollectionVsDueLine[],
  metaByCourse: Record<string, FeeStructureMetadata>,
): ExportRow[] {
  const heads = feeHeadsForLines(lines);
  const students = pivotStudents(lines);
  return withSerial(students.map((s) => {
    const row: ExportRow = {
      Student: s.name,
      "Admission No": s.admission_no === "—" ? "" : s.admission_no,
      Course: s.course_name === "—" ? "" : s.course_name,
      Batch: s.batch_name === "—" ? "" : s.batch_name,
      Session: s.session_name === "—" ? "" : s.session_name,
      Campus: s.campus_name === "—" ? "" : s.campus_name,
      "Student Status": s.student_status || "Unknown",
    };
    for (const head of heads) {
      const label = feeHeadLabel(head, metaByCourse);
      const amt = s.amounts[head.key];
      row[`${label} Due`] = Number(amt?.due || 0);
      row[`${label} Collected`] = Number(amt?.collected || 0);
    }
    row["Total Due"] = s.totalDue;
    row["Total Collected"] = s.totalCollected;
    row.Balance = s.totalBalance;
    return row;
  }));
}

export function buildDetailedExportRows(
  lines: CollectionVsDueLine[],
  metaByCourse: Record<string, FeeStructureMetadata>,
): ExportRow[] {
  return withSerial(lines.map((l) => ({
    Student: l.name || "",
    "Admission No": l.admission_no || "",
    Course: l.course_name || "",
    Batch: l.batch_name || "",
    Session: l.session_name || "",
    Campus: l.campus_name || "",
    "Student Status": l.student_status || "Unknown",
    "Fee Head": l.fee_name || l.fee_code || "",
    Term: feeTermLabel(l.term || "", metaByCourse[l.course_id || ""]),
    Due: Number(l.due_amount || 0),
    Collected: Number(l.collected_amount || 0),
    Balance: Number(l.balance || 0),
    "Due Date": l.due_date || "",
    "Collected Date": l.collected_date || "",
    "Receipt No": l.receipt_no || "",
    "Payment Mode": l.payment_mode ? l.payment_mode.replace(/_/g, " ") : "",
    "Transaction Ref": l.transaction_ref || "",
    "Payment Type": l.payment_type ? l.payment_type.replace(/_/g, " ") : "",
    "Late Fine Due": Number(l.late_fine_due || 0),
    "Late Fine Paid": Number(l.late_fine_collected || 0),
    Status: l.is_overdue ? "Overdue" : Number(l.balance) <= 0 ? "Paid" : "Due",
  })));
}

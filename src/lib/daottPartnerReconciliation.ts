import type { ExportRow } from "@/lib/xlsxExport";

/**
 * Reconciliation reference from the supplied NIMT report (10 Sep 2026) and
 * Finance export (6 Oct 2026). These amounts are historical and unverified;
 * they must never be included in UniOS fee totals.
 */
export const DAOTT_RECONCILIATION_SOURCE = {
  partnerReportDate: "2026-09-10",
  financeExportDate: "2026-10-06",
  financeExportCandidateCount: 19,
  partnerCandidateCount: 23,
  partnerLedgerTotalReported: 573_975,
  partnerLedgerTotalCalculated: 573_974,
  partnerSummaryTotal: 580_975,
} as const;

export type DaottUnverifiedCandidate = {
  name: string;
  partnerAdmissionNo: string | null;
  referenceAmount: number;
  note?: string;
};

/** Partner-reported candidates absent from the 6 Oct Finance spreadsheet. */
export const DAOTT_UNVERIFIED_CANDIDATES: DaottUnverifiedCandidate[] = [
  { name: "Anamika", partnerAdmissionNo: null, referenceAmount: 56_000, note: "Admission number not yet issued in partner report" },
  { name: "Muskan", partnerAdmissionNo: "APP-26-3EKN", referenceAmount: 28_100 },
  { name: "Swati Kumari", partnerAdmissionNo: "PAN-6601AD44", referenceAmount: 11_000 },
  { name: "Rajesh Saini", partnerAdmissionNo: "APP-26-7WJT", referenceAmount: 27_500 },
  { name: "Gagan Bedi", partnerAdmissionNo: "APP-26-H58A", referenceAmount: 12_000, note: "Partner report reuses this admission number for cancelled candidate Aman Patel" },
];

export function isDaottCourseName(name: string | null | undefined) {
  const normalized = String(name || "").toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  return normalized.includes("daott") || (normalized.includes("anesthesia") && normalized.includes("ot technology"));
}

export function buildDaottReconciliationExportRows(): ExportRow[] {
  return DAOTT_UNVERIFIED_CANDIDATES.map((candidate, index) => ({
    "S. No.": index + 1,
    Student: candidate.name,
    "Admission No": candidate.partnerAdmissionNo || "",
    Course: "Diploma of Anesthesia & OT Technology (D.AOTT)",
    "Verification Status": "Unverified — partner reference only",
    Source: `NIMT reconciliation report · ${DAOTT_RECONCILIATION_SOURCE.partnerReportDate}`,
    "Reference Amount (Unverified)": candidate.referenceAmount,
    "Total Due": 0,
    "Total Collected": 0,
    Balance: 0,
    Notes: candidate.note || "Not present in the 6 Oct Finance export",
  }));
}

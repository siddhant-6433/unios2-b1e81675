// Deno copy of src/lib/feeTermLabels.ts — edge functions cannot import from
// src/. Keep the two in sync; src/test/fee-term-labels.test.ts asserts both
// produce identical output for the same inputs.
//
// Why this exists at all: a fee term is stored as a free-text string
// (year_1, q1, m_2026_07, registration). "year_2" does NOT reliably mean a
// year — D.AOTT bills 5 semesters and stores them as year_1..year_5, like
// every other programme. Only the fee structure's own metadata
// (period_label / year_N.label) knows which word is right.

export type FeeStructureMetadata = Record<string, unknown> | null | undefined;

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthTermLabel = (normalized: string): string | null => {
  const m = normalized.match(/^m_(\d{4})_(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${MONTH_ABBR[month - 1]} ${m[1]}`;
};

const TERM_PATTERNS = [
  { regex: /^year[_\s-]?(\d+)$/i, label: (n: string) => `Year ${n}` },
  { regex: /^sem(?:ester)?[_\s-]?(\d+)$/i, label: (n: string) => `Sem ${n}` },
  { regex: /^q(?:uarter)?[_\s-]?(\d+)$/i, label: (n: string) => `Q${n}` },
  { regex: /^term[_\s-]?(\d+)$/i, label: (n: string) => `Term ${n}` },
  { regex: /^installment[_\s-]?(\d+)$/i, label: (n: string) => `Installment ${n}` },
];

const EXPLICIT_TERM_LABELS: Record<string, string> = {
  adhoc: "Other Charges",
  admission: "Admission",
  security_deposit: "Security Deposit",
  registration: "Application Fee",
};

export const ONE_TIME_TERMS = ["registration", "admission", "security_deposit"];

export const defaultFeeTermLabel = (term: string, periodLabel?: string): string => {
  const normalized = String(term || "").trim().toLowerCase();
  if (EXPLICIT_TERM_LABELS[normalized]) return EXPLICIT_TERM_LABELS[normalized];
  const monthLabel = monthTermLabel(normalized);
  if (monthLabel) return monthLabel;
  for (const { regex, label } of TERM_PATTERNS) {
    const match = normalized.match(regex);
    if (match) {
      if (periodLabel) return `${periodLabel} ${match[1]}`;
      return label(match[1]);
    }
  }
  return titleCase(normalized || "Term");
};

const LATE_PREFIX = /^late[_\s-]/;

const withoutLatePrefix = (normalized: string) =>
  LATE_PREFIX.test(normalized) ? normalized.replace(LATE_PREFIX, "") : null;

/** Compact label — dense tables and PDF line items ("Sem 1"). */
export const feeTermLabel = (term: string, metadata?: FeeStructureMetadata): string => {
  const meta = asRecord(metadata);
  const normalized = String(term || "").trim().toLowerCase();

  const base = withoutLatePrefix(normalized);
  if (base) return `Late Fee — ${feeTermLabel(base, metadata)}`;

  const termMeta = asRecord(meta?.[term]) || asRecord(meta?.[normalized]);
  const explicitLabel = termMeta?.label;
  if (typeof explicitLabel === "string" && explicitLabel.trim()) {
    return explicitLabel.trim();
  }

  const monthLabel = monthTermLabel(normalized);
  if (monthLabel) return monthLabel;
  if (normalized === "security_deposit") return "Security Deposit (Refundable)";
  const periodLabel = meta?.period_label;

  for (const { regex, label } of TERM_PATTERNS) {
    const match = normalized.match(regex);
    if (match) {
      if (typeof periodLabel === "string" && periodLabel.trim()) {
        return `${periodLabel.trim()} ${match[1]}`;
      }
      return label(match[1]);
    }
  }

  return defaultFeeTermLabel(term);
};

/** Prose label — anything a candidate reads as a sentence ("Semester 1"). */
export const feeTermLabelLong = (term: string, metadata?: FeeStructureMetadata): string => {
  const meta = asRecord(metadata);
  const normalized = String(term || "").trim().toLowerCase();

  const base = withoutLatePrefix(normalized);
  if (base) return `Late Fee — ${feeTermLabelLong(base, metadata)}`;

  const periodLabel = meta?.period_label;
  if (typeof periodLabel === "string" && periodLabel.trim()) {
    for (const { regex } of TERM_PATTERNS) {
      const match = normalized.match(regex);
      if (match) return `${periodLabel.trim()} ${match[1]}`;
    }
  }
  return feeTermLabel(term, metadata);
};

// Singular/plural period noun for copy that talks about the unit rather than a
// numbered term. Mirror of src/lib/feeTermLabels.ts — keep in sync.
export const feePeriodNoun = (
  metadata?: FeeStructureMetadata,
  opts?: { plural?: boolean },
): string => {
  const raw = asRecord(metadata)?.period_label;
  const singular = typeof raw === "string" && raw.trim() ? raw.trim() : "Year";
  if (!opts?.plural) return singular;
  return /s$/i.test(singular) ? singular : `${singular}s`;
};

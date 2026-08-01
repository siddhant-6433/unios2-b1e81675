export type FeeStructureMetadata = Record<string, unknown> | null | undefined;

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Month-anchored ad-hoc fee heads, e.g. m_2026_07 → "Jul 2026". Returns null
// when the term isn't a month term so callers fall through to their normal path.
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

export const defaultFeeTermLabel = (term: string, periodLabel?: string) => {
  const normalized = String(term || "").trim().toLowerCase();
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

export const feeTermLabel = (term: string, metadata?: FeeStructureMetadata) => {
  const meta = asRecord(metadata);
  const termMeta = asRecord(meta?.[term]);
  const explicitLabel = termMeta?.label;

  if (typeof explicitLabel === "string" && explicitLabel.trim()) {
    return explicitLabel.trim();
  }

  const normalized = String(term || "").trim().toLowerCase();
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

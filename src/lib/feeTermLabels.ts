export type FeeStructureMetadata = Record<string, unknown> | null | undefined;

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const TERM_PATTERNS = [
  { regex: /^year[_\s-]?(\d+)$/i, label: (n: string) => `Year ${n}` },
  { regex: /^sem(?:ester)?[_\s-]?(\d+)$/i, label: (n: string) => `Sem ${n}` },
  { regex: /^q(?:uarter)?[_\s-]?(\d+)$/i, label: (n: string) => `Q${n}` },
  { regex: /^term[_\s-]?(\d+)$/i, label: (n: string) => `Term ${n}` },
  { regex: /^installment[_\s-]?(\d+)$/i, label: (n: string) => `Installment ${n}` },
];

export const defaultFeeTermLabel = (term: string, periodLabel?: string) => {
  const normalized = String(term || "").trim().toLowerCase();
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

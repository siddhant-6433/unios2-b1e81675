export type FeeStructureMetadata = Record<string, unknown> | null | undefined;

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const defaultFeeTermLabel = (term: string) => titleCase(term || "Term");

export const feeTermLabel = (term: string, metadata?: FeeStructureMetadata) => {
  const meta = asRecord(metadata);
  const termMeta = asRecord(meta?.[term]);
  const explicitLabel = termMeta?.label;

  if (typeof explicitLabel === "string" && explicitLabel.trim()) {
    return explicitLabel.trim();
  }

  const match = term.match(/^year_(\d+)$/);
  const periodLabel = meta?.period_label;
  if (match && typeof periodLabel === "string" && periodLabel.trim()) {
    return `${periodLabel.trim()} ${match[1]}`;
  }

  return defaultFeeTermLabel(term);
};

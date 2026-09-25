export interface MetricRow {
  metric: string;
  value: number;
}

export interface FunnelRow {
  status: string;
  source: string | null;
  applicants: number;
}

/** Human labels for the metric keys returned by hr_recruitment_metrics(). */
export const METRIC_LABELS: Record<string, string> = {
  applicants: "Applicants",
  new: "New",
  in_pipeline: "In pipeline",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  offers_generated: "Offers generated",
  offers_accepted: "Offers accepted",
  offers_declined: "Offers declined",
  offers_pending: "Offers pending",
  offer_acceptance_pct: "Offer acceptance",
  interviews_scheduled: "Interviews scheduled",
  interviews_completed: "Interviews completed",
  interviews_no_show: "Interview no-shows",
  avg_days_to_offer: "Avg days to offer",
  avg_days_to_hire: "Avg days to hire",
};

/** Headline metrics shown as cards (in order). */
export const HEADLINE_METRICS = [
  "applicants",
  "in_pipeline",
  "hired",
  "offers_generated",
  "offers_accepted",
  "offer_acceptance_pct",
  "interviews_scheduled",
  "interviews_completed",
  "avg_days_to_offer",
  "avg_days_to_hire",
] as const;

export const metricValue = (rows: MetricRow[] | null | undefined, key: string): number =>
  Number(rows?.find((r) => r.metric === key)?.value ?? 0);

export const metricLabel = (key: string): string =>
  METRIC_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Is this metric a percentage / days figure (affects formatting)? */
export function metricFormat(key: string): "int" | "pct" | "days" {
  if (key.endsWith("_pct")) return "pct";
  if (key.startsWith("avg_days")) return "days";
  return "int";
}

export function formatMetric(key: string, value: number): string {
  const f = metricFormat(key);
  if (f === "pct") return `${Math.round(value * 10) / 10}%`;
  if (f === "days") return `${Math.round(value * 10) / 10}d`;
  return new Intl.NumberFormat("en-IN").format(value);
}

/** Distinct statuses present in the funnel, in a stable pipeline order. */
const STATUS_ORDER = ["new", "reviewing", "shortlisted", "interview", "offered", "hired", "rejected", "withdrawn"];

export function funnelStatuses(rows: FunnelRow[]): string[] {
  const present = new Set(rows.map((r) => r.status));
  const ordered = STATUS_ORDER.filter((s) => present.has(s));
  const extra = [...present].filter((s) => !STATUS_ORDER.includes(s)).sort();
  return [...ordered, ...extra];
}

export function funnelSources(rows: FunnelRow[]): string[] {
  return [...new Set(rows.map((r) => r.source || "unknown"))].sort();
}

/** status → source → count, for the funnel table. */
export function funnelMatrix(rows: FunnelRow[]) {
  const statuses = funnelStatuses(rows);
  const sources = funnelSources(rows);
  const cell = (status: string, source: string) =>
    rows
      .filter((r) => r.status === status && (r.source || "unknown") === source)
      .reduce((n, r) => n + Number(r.applicants || 0), 0);
  return { statuses, sources, cell };
}

export function acceptanceTone(pct: number): string {
  if (pct >= 70) return "bg-pastel-green text-foreground/80";
  if (pct >= 40) return "bg-pastel-yellow text-foreground/80";
  return "bg-pastel-red text-foreground/80";
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Default analytics window: last 90 days. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - 90);
  return { from: iso(from), to: iso(now) };
}

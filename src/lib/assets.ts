// HR Assets — pure types and helpers.
//
// Nothing here touches Supabase. The register panel owns the I/O; the rules
// that decide what an asset means (how we colour a status, whether it is out on
// loan, what the summary cards add up to) live here so they can be unit-tested
// without a database.
//
// Money convention: purchase_cost arrives as numeric(14,2) from Postgres, which
// the supabase client hands back as a number-or-string. Every helper coerces
// with Number() before doing arithmetic so a string cost cannot silently
// concatenate.

export type AssetStatus =
  | "available"
  | "assigned"
  | "maintenance"
  | "retired"
  | "lost";

/** Every status the DB CHECK constraint allows, in lifecycle order. */
export const ASSET_STATUSES: readonly AssetStatus[] = [
  "available",
  "assigned",
  "maintenance",
  "retired",
  "lost",
] as const;

/** The statuses a register filter bar offers, with "all" in front. */
export const ASSET_FILTERS = ["all", ...ASSET_STATUSES] as const;
export type AssetFilter = (typeof ASSET_FILTERS)[number];

export interface AssetCategory {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  display_order: number;
}

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category_id: string | null;
  serial_number: string | null;
  model: string | null;
  purchase_date: string | null;
  purchase_cost: number | string | null;
  warranty_until: string | null;
  condition: string | null;
  status: AssetStatus;
  location: string | null;
  notes: string | null;
}

export interface AssetAssignment {
  id: string;
  asset_id: string;
  employee_profile_id: string;
  assigned_at: string;
  assigned_by: string | null;
  returned_at: string | null;
  returned_by: string | null;
  condition_on_return: string | null;
  notes: string | null;
}

/** A row of the asset_assignments_inbox view — an assignment with joins flattened. */
export interface AssetAssignmentInboxRow {
  id: string;
  asset_id: string;
  employee_profile_id: string;
  assigned_at: string;
  returned_at: string | null;
  condition_on_return: string | null;
  notes: string | null;
  asset_tag: string;
  asset_name: string;
  asset_status: AssetStatus;
  category_name: string | null;
  employee_name: string | null;
  employee_number: string | null;
}

/** A row of the hr_asset_summary() RPC: one (status, category) bucket. */
export interface AssetSummaryRow {
  status: AssetStatus;
  category: string | null;
  assets: number | string;
  total_cost: number | string;
}

export interface AssetStatusBucket {
  count: number;
  cost: number;
}

export interface AssetSummary {
  /** Total number of assets, regardless of status. */
  total: number;
  /** Sum of every asset's purchase cost, regardless of status. */
  totalCost: number;
  /** Counts and cost split by status; every known status is always present. */
  byStatus: Record<AssetStatus, AssetStatusBucket>;
}

const STATUS_CLASS: Record<AssetStatus, string> = {
  available: "bg-pastel-blue text-foreground/80 border-0 text-[10px]",
  assigned: "bg-pastel-green text-foreground/80 border-0 text-[10px]",
  maintenance: "bg-pastel-yellow text-foreground/80 border-0 text-[10px]",
  retired: "bg-muted text-muted-foreground border-0 text-[10px]",
  lost: "bg-pastel-red text-foreground/80 border-0 text-[10px]",
};

/**
 * Tailwind classes for a status pill. Pastel tokens only — the app reads them as
 * a family, so a status never invents its own colour.
 */
export function assetStatusBadge(status: AssetStatus | string): string {
  return STATUS_CLASS[status as AssetStatus] ?? STATUS_CLASS.retired;
}

/** Human label ("maintenance" → "Maintenance"). */
export function assetStatusLabel(status: string): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** True when the asset is currently out on loan to an employee. */
export function isAssigned(asset: Pick<Asset, "status"> | null | undefined): boolean {
  return !!asset && asset.status === "assigned";
}

/** True while an assignment row has not been returned yet. */
export function isActiveAssignment(
  row: Pick<AssetAssignmentInboxRow, "returned_at"> | null | undefined,
): boolean {
  return !!row && !row.returned_at;
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Indian-grouped rupees, e.g. 1234567.5 → "12,34,567.5". */
export function formatInr(n: number | string | null | undefined): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  return INR.format(value);
}

/**
 * Count and cost totals by status, for the register's summary cards.
 * `total`/`totalCost` cover every asset; the per-status buckets are disjoint.
 */
export function summarizeAssets(
  rows: ReadonlyArray<Pick<Asset, "status" | "purchase_cost">>,
): AssetSummary {
  const byStatus: Record<string, AssetStatusBucket> = {};
  for (const status of ASSET_STATUSES) byStatus[status] = { count: 0, cost: 0 };

  let totalCost = 0;
  for (const row of rows) {
    const cost = Number(row.purchase_cost ?? 0);
    const safeCost = Number.isFinite(cost) ? cost : 0;
    totalCost += safeCost;

    const key = row.status || "available";
    if (!byStatus[key]) byStatus[key] = { count: 0, cost: 0 };
    byStatus[key].count += 1;
    byStatus[key].cost += safeCost;
  }

  return {
    total: rows.length,
    totalCost,
    byStatus: byStatus as Record<AssetStatus, AssetStatusBucket>,
  };
}

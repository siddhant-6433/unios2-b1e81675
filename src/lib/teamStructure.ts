// HR team structure primitives.
//
// Deliberately free of React and Supabase so the cycle pre-check, grouping and
// sorting can be unit-tested without a browser or a database.
//
// `TeamRow` mirrors the `hr_team_structure()` RETURNS TABLE shape declared in
// supabase/migrations/20260924064035_hr_reporting_structure.sql. The RPC does
// not return the employee's own auth user id, so the panel enriches rows from
// the verified-employee lookup (see the optional `user_id` field) before the
// cycle pre-check can recognise a loop back to the employee.

export interface TeamRow {
  employee_profile_id: string;
  employee_name: string | null;
  employee_number: string | null;
  designation: string | null;
  department: string | null;
  campus: string | null;
  employment_status: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  /**
   * The employee's own auth user id. hr_team_structure() does not return it,
   * so the panel merges it in from the verified-employee lookup. Without it
   * the client cannot tell whether the manager chain loops back to the
   * employee; the check then stays silent and the server remains authoritative.
   */
  user_id?: string | null;
}

/** Group key for employees who have no reporting manager. */
export const NO_MANAGER_KEY = "__no_manager__";

/** Shown when a row has no reporting manager. */
export const UNASSIGNED_MANAGER = "Unassigned";

export interface ManagerOption {
  user_id: string;
  name: string;
  reports: number;
}

/** Trim and collapse whitespace; never returns null. */
function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/** Display label for an employee: name, falling back to the employee number. */
export function formatEmployeeName(row: TeamRow): string {
  const name = normalizeName(row.employee_name);
  if (name) return name;
  const number = normalizeName(row.employee_number);
  return number || "Unnamed employee";
}

/** Display label for a row's reporting manager. */
export function formatManagerName(row: Pick<TeamRow, "manager_name"> | null | undefined): string {
  const name = normalizeName(row?.manager_name);
  return name || UNASSIGNED_MANAGER;
}

/**
 * Sort rows the way hr_team_structure() returns them: employees with no
 * manager first (`NULLS FIRST` on the manager name), then manager name
 * A→Z, then employee name. Ties fall back to the profile id so the order is
 * stable regardless of the input order.
 */
export function sortByManager(rows: TeamRow[]): TeamRow[] {
  return [...rows].sort((a, b) => {
    const am = normalizeName(a.manager_name).toLowerCase();
    const bm = normalizeName(b.manager_name).toLowerCase();
    if (am !== bm) {
      if (!am) return -1;
      if (!bm) return 1;
      return am < bm ? -1 : 1;
    }

    const an = normalizeName(a.employee_name).toLowerCase();
    const bn = normalizeName(b.employee_name).toLowerCase();
    if (an !== bn) {
      // Postgres ORDER BY ... ASC puts NULLs last, so unnamed employees do too.
      if (!an) return 1;
      if (!bn) return -1;
      return an < bn ? -1 : 1;
    }

    return a.employee_profile_id.localeCompare(b.employee_profile_id);
  });
}

/**
 * Group rows by their reporting manager. Employees with no manager land under
 * the {@link NO_MANAGER_KEY} bucket so the caller can count them without a
 * separate pass.
 */
export function groupByManager(rows: TeamRow[]): Map<string, TeamRow[]> {
  const groups = new Map<string, TeamRow[]>();
  for (const row of rows) {
    const key = row.manager_user_id ?? NO_MANAGER_KEY;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/**
 * The distinct managers that actually have direct reports, sorted by name,
 * with their direct-report counts. Useful for a managers filter or summary.
 */
export function managersFromRows(rows: TeamRow[]): ManagerOption[] {
  const byId = new Map<string, ManagerOption>();
  for (const row of rows) {
    if (!row.manager_user_id) continue;
    const name = normalizeName(row.manager_name);
    const existing = byId.get(row.manager_user_id);
    if (existing) {
      existing.reports += 1;
      if (!existing.name && name) existing.name = name;
    } else {
      byId.set(row.manager_user_id, { user_id: row.manager_user_id, name, reports: 1 });
    }
  }
  return [...byId.values()].sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.user_id.localeCompare(b.user_id);
  });
}

/**
 * Client-side pre-check mirroring the server's `set_reporting_manager` walk:
 * setting `employeeProfileId`'s manager to `managerUserId` is a cycle if the
 * prospective manager's own chain of managers reaches the employee.
 *
 * Returns `false` when the employee's own user id is unknown (rows not
 * enriched) — the RPC still rejects the write, so the UI never silently
 * commits a cycle; it just cannot warn before the round trip.
 */
export function wouldCreateCycle(
  rows: TeamRow[],
  employeeProfileId: string,
  managerUserId: string | null | undefined,
): boolean {
  if (!managerUserId) return false;

  const employee = rows.find((row) => row.employee_profile_id === employeeProfileId);
  const employeeUserId = employee?.user_id ?? null;

  // user id → that employee's own manager. Built only from enriched rows; a
  // row without a user_id cannot participate in the chain walk.
  const nextManager = new Map<string, string>();
  for (const row of rows) {
    if (row.user_id) nextManager.set(row.user_id, row.manager_user_id ?? "");
  }

  const seen = new Set<string>();
  let current: string | null | undefined = managerUserId;
  while (current && !seen.has(current)) {
    if (current === employeeUserId) return true;
    seen.add(current);
    current = nextManager.get(current) || null;
  }
  return false;
}

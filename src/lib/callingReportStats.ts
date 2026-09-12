/**
 * Calling Report counsellor chips must use the same rows as the per-lead table:
 * the latest list assignment per lead. Older history rows are previous CRM
 * owners or earlier Assign splits, not this list's current allocation.
 */

export type CallingReportCounsellorStat = {
  counsellor_id: string;
  counsellor_name: string;
  total: number;
  worked: number;
  pending: number;
};

export type CallingReportAssignmentRow = {
  lead_id?: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at?: string | null;
  latest_call_at: string | null;
  latest_call_disposition?: string | null;
};

const calledOnRow = (row: CallingReportAssignmentRow) =>
  Boolean(row.latest_call_at || row.latest_call_disposition);

/**
 * One row per lead: the newest list assignment. Re-running Assign writes a
 * new history row each time, so grouping every row counts original CRM
 * owners and previous splits as if they were this list's allocation.
 */
export function callingReportLatestPerLead<T extends {
  lead_id?: string | null;
  assigned_at?: string | null;
}>(rows: T[]): T[] {
  const best = new Map<string, T>();
  const extras: T[] = [];
  for (const row of rows) {
    const id = row.lead_id;
    if (!id) {
      extras.push(row);
      continue;
    }
    const cur = best.get(id);
    const at = row.assigned_at ? new Date(row.assigned_at).getTime() : 0;
    const ct = cur?.assigned_at ? new Date(cur.assigned_at).getTime() : 0;
    if (!cur || at > ct) best.set(id, row);
  }
  return [...best.values(), ...extras];
}

export function callingReportByCounsellor(
  rows: CallingReportAssignmentRow[],
): CallingReportCounsellorStat[] {
  const map = new Map<string, CallingReportCounsellorStat>();
  for (const row of rows) {
    const id = row.assigned_to || "unassigned";
    const cur = map.get(id) ?? {
      counsellor_id: id,
      counsellor_name: row.assigned_to_name || "Unknown",
      total: 0,
      worked: 0,
      pending: 0,
    };
    cur.total += 1;
    if (calledOnRow(row)) cur.worked += 1;
    else cur.pending += 1;
    map.set(id, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.pending - a.pending || a.counsellor_name.localeCompare(b.counsellor_name),
  );
}

export function callingReportCalledCount(rows: CallingReportAssignmentRow[]) {
  const leads = new Set<string>();
  let fallback = 0;
  for (const row of rows) {
    if (!calledOnRow(row)) continue;
    if (row.lead_id) leads.add(row.lead_id);
    else fallback += 1;
  }
  return leads.size || fallback;
}

export function callingReportLastCallAt(rows: CallingReportAssignmentRow[]) {
  let max = 0;
  for (const row of rows) {
    if (!row.latest_call_at) continue;
    const t = new Date(row.latest_call_at).getTime();
    if (t > max) max = t;
  }
  return max ? new Date(max).toISOString() : null;
}

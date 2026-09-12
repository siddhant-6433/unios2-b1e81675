/**
 * Calling Report counsellor chips must use the same rows as the per-lead table.
 *
 * call_list_progress.by_counsellor groups lead_list_members.assigned_to. The
 * table is lead_assignment_history (who actually received each lead on this
 * list). Those diverge when leads are later moved, or when a round-robin
 * writes history but leaves members.assigned_to on the previous owner — which
 * is how a three-counsellor list shows only one name in the header.
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
  latest_call_at: string | null;
  latest_call_disposition?: string | null;
};

const calledOnRow = (row: CallingReportAssignmentRow) =>
  Boolean(row.latest_call_at || row.latest_call_disposition);

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

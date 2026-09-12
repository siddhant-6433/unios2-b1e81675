import { supabase } from "@/integrations/supabase/client";

export type ListAssignmentOwner = {
  counsellor_id: string;
  counsellor_name: string;
  count: number;
};

export type ListAssignmentOwners = {
  holders: ListAssignmentOwner[];
  unassigned: number;
  crmOwners: ListAssignmentOwner[];
};

const PAGE = 1000;

const toOwners = (counts: Map<string, number>, names: Map<string, string>): ListAssignmentOwner[] =>
  [...counts.entries()]
    .map(([id, count]) => ({
      counsellor_id: id,
      counsellor_name: names.get(id) || "Unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count || a.counsellor_name.localeCompare(b.counsellor_name));

/**
 * Who currently holds a list. Pages member rows so it does not depend on the
 * preview RPC growing extra JSON fields (those only appear after db push).
 */
export async function fetchListAssignmentOwners(listId: string): Promise<ListAssignmentOwners> {
  const assigned = new Map<string, number>();
  const leadIds: string[] = [];
  let unassigned = 0;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("lead_list_members" as any)
      .select("assigned_to, lead_id")
      .eq("list_id", listId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as { assigned_to: string | null; lead_id: string | null }[];
    for (const row of rows) {
      if (row.assigned_to) assigned.set(row.assigned_to, (assigned.get(row.assigned_to) || 0) + 1);
      else unassigned += 1;
      if (row.lead_id) leadIds.push(row.lead_id);
    }
    if (rows.length < PAGE) break;
  }

  const crm = new Map<string, number>();
  for (let i = 0; i < leadIds.length; i += PAGE) {
    const chunk = leadIds.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from("leads" as any)
      .select("counsellor_id")
      .in("id", chunk);
    if (error) throw error;
    for (const row of (data || []) as { counsellor_id: string | null }[]) {
      if (row.counsellor_id) crm.set(row.counsellor_id, (crm.get(row.counsellor_id) || 0) + 1);
    }
  }

  const ids = [...new Set([...assigned.keys(), ...crm.keys()])];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase
      .from("profiles" as any)
      .select("id, display_name")
      .in("id", ids);
    for (const p of (data || []) as { id: string; display_name: string | null }[]) {
      names.set(p.id, p.display_name || "Unknown");
    }
  }

  return {
    holders: toOwners(assigned, names),
    unassigned,
    crmOwners: toOwners(crm, names),
  };
}

export type ListAssignee = {
  counsellor_id: string;
  counsellor_name: string;
};

export function pickLatestBatchAssignees(
  rows: { list_id: string; counsellor_ids: string[] | null; created_at: string }[],
): Map<string, string[]> {
  const best = new Map<string, { at: number; ids: string[] }>();
  for (const row of rows) {
    const at = new Date(row.created_at).getTime();
    const cur = best.get(row.list_id);
    if (cur && cur.at >= at) continue;
    best.set(row.list_id, {
      at,
      ids: (row.counsellor_ids || []).filter(Boolean),
    });
  }
  return new Map([...best.entries()].map(([id, v]) => [id, v.ids]));
}

/** Latest list assignment per lead, then the unique counsellors on that split. */
export function uniqueLatestAssigneesByList(
  rows: { list_id: string; lead_id: string | null; assigned_to: string | null; created_at: string }[],
): Map<string, string[]> {
  const latest = new Map<string, { at: number; assigned_to: string }>();
  for (const row of rows) {
    if (!row.list_id || !row.lead_id || !row.assigned_to) continue;
    const key = `${row.list_id}\0${row.lead_id}`;
    const at = new Date(row.created_at).getTime();
    const cur = latest.get(key);
    if (cur && cur.at >= at) continue;
    latest.set(key, { at, assigned_to: row.assigned_to });
  }
  const byList = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  for (const [key, v] of latest) {
    const listId = key.slice(0, key.indexOf("\0"));
    const set = seen.get(listId) ?? new Set<string>();
    set.add(v.assigned_to);
    seen.set(listId, set);
  }
  for (const [listId, set] of seen) byList.set(listId, [...set]);
  return byList;
}

/** Every counsellor who appears as Assigned to on the Calling Report. */
export function uniqueAssigneesFromReport(
  rows: { assigned_to?: string | null; assigned_to_name?: string | null }[],
): ListAssignee[] {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = row.assigned_to;
    if (!id) continue;
    if (!map.has(id)) map.set(id, row.assigned_to_name?.trim() || "Unknown");
  }
  return [...map.entries()]
    .map(([counsellor_id, counsellor_name]) => ({ counsellor_id, counsellor_name }))
    .sort((a, b) => a.counsellor_name.localeCompare(b.counsellor_name));
}

export async function fetchListReportAssignees(listId: string): Promise<ListAssignee[]> {
  const all: { assigned_to: string | null; assigned_to_name: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("get_lead_list_assignment_report" as any, {
      _list_id: listId,
      _batch_id: null,
      _limit: PAGE,
      _offset: offset,
    });
    if (error) throw error;
    const page = ((data || []) as typeof all);
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return uniqueAssigneesFromReport(all);
}

/**
 * Who each list was Assigned to. Same RPC as the Calling Report, including
 * names, so we do not depend on batch RLS or a second profiles lookup.
 */
export async function fetchLatestListAssignees(
  listIds: string[],
): Promise<Record<string, ListAssignee[]>> {
  const out: Record<string, ListAssignee[]> = {};
  for (let i = 0; i < listIds.length; i += 4) {
    const slice = listIds.slice(i, i + 4);
    await Promise.all(slice.map(async (id) => {
      try {
        const assignees = await fetchListReportAssignees(id);
        if (assignees.length) out[id] = assignees;
      } catch (e) {
        console.error("Fetch list assignees failed:", id, e);
      }
    }));
  }
  return out;
}

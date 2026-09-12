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

export function callingReportPreviousCounsellors(
  rows: { previous_counsellor_name?: string | null }[],
) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const name = row.previous_counsellor_name?.trim();
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

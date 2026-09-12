/**
 * Helpers for building a lead_lists row from a bag of ids (WhatsApp inbox,
 * admissions multi-select, etc.).
 *
 * lead_list_members has a PARTIAL unique index on (list_id, lead_id)
 * WHERE lead_id IS NOT NULL. PostgREST cannot target that index for upsert,
 * and a plain insert of a 500-row chunk is all-or-nothing: one duplicate or
 * one orphaned id (FK to leads) rolls back the whole chunk, leaving the list
 * with zero members. The engaged inbox is especially prone to this because
 * it expands 91-prefix phone variants into separate conversations that often
 * share a lead_id, and campaign threads may carry a contact id in lead_id.
 */

const PROBE_CHUNK = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListMemberInsertResult = {
  added: number;
  failed: number;
  leadCount: number;
  contactCount: number;
  error?: string;
};

export function uniqueLeadIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(
    ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id.trim())).map((id) => id.trim()),
  )];
}

async function existingIdsIn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
  table: string,
  ids: string[],
): Promise<string[]> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += PROBE_CHUNK) {
    const probe = ids.slice(i, i + PROBE_CHUNK);
    if (probe.length === 0) continue;
    const { data, error } = await client.from(table).select("id").in("id", probe);
    if (error) throw error;
    for (const row of (data || []) as Array<{ id?: string | null }>) {
      if (row.id) found.add(row.id);
    }
  }
  return ids.filter((id) => found.has(id));
}

export async function filterExistingLeadIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
  ids: string[],
): Promise<string[]> {
  return existingIdsIn(client, "leads", uniqueLeadIds(ids));
}

export async function resolveListMemberTargets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
  ids: string[],
): Promise<{ leadIds: string[]; contactIds: string[] }> {
  const unique = uniqueLeadIds(ids);
  const leadIds = await existingIdsIn(client, "leads", unique);
  const leadSet = new Set(leadIds);
  const leftover = unique.filter((id) => !leadSet.has(id));
  const contactIds = leftover.length === 0
    ? []
    : await existingIdsIn(client, "marketing_contacts", leftover);
  return { leadIds, contactIds };
}

async function insertRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
  rows: Array<Record<string, string>>,
): Promise<{ added: number; failed: number; error?: string }> {
  if (rows.length === 0) return { added: 0, failed: 0 };
  let added = 0;
  let failed = 0;
  let error: string | undefined;
  for (let i = 0; i < rows.length; i += PROBE_CHUNK) {
    const chunk = rows.slice(i, i + PROBE_CHUNK);
    const { error: chunkErr } = await client.from("lead_list_members" as any).insert(chunk);
    if (!chunkErr) {
      added += chunk.length;
      continue;
    }
    error = chunkErr.message;
    for (const row of chunk) {
      const { error: rowErr } = await client.from("lead_list_members" as any).insert(row);
      if (rowErr) {
        failed++;
        error = rowErr.message;
      } else {
        added++;
      }
    }
  }
  return { added, failed, error };
}

/**
 * Adds unique, existing leads (and leftover marketing contacts) to a list.
 * Falls back to per-row inserts so one bad id cannot zero the whole list.
 */
export async function insertLeadListMembers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
  listId: string,
  ids: string[],
): Promise<ListMemberInsertResult> {
  const { leadIds, contactIds } = await resolveListMemberTargets(client, ids);
  const leads = await insertRows(client, leadIds.map((lead_id) => ({ list_id: listId, lead_id })));
  const contacts = await insertRows(client, contactIds.map((contact_id) => ({ list_id: listId, contact_id })));
  return {
    added: leads.added + contacts.added,
    failed: leads.failed + contacts.failed,
    leadCount: leads.added,
    contactCount: contacts.added,
    error: contacts.error || leads.error,
  };
}

import { supabase } from "@/integrations/supabase/client";

export type StaffQueueStudentFlags = {
  login_disabled?: boolean | null;
  archived_at?: string | null;
  deleted_at?: string | null;
};

export function isHiddenFromStaffQueues(
  row: StaffQueueStudentFlags | null | undefined,
): boolean {
  if (!row) return false;
  return !!row.login_disabled || row.archived_at != null || row.deleted_at != null;
}

export function nestedOfferLeadId(row: {
  offer_letters?: { lead_id?: string | null } | { lead_id?: string | null }[] | null;
} | null | undefined): string | null {
  const ol = row?.offer_letters;
  const obj = Array.isArray(ol) ? ol[0] : ol;
  return obj?.lead_id ?? null;
}

export function nestedStudent(row: {
  students?: StaffQueueStudentFlags | StaffQueueStudentFlags[] | null;
} | StaffQueueStudentFlags | StaffQueueStudentFlags[] | null | undefined): StaffQueueStudentFlags | null {
  const value = row && typeof row === "object" && "students" in row ? row.students : row;
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return Array.isArray(value) ? value[0] : value;
}

export async function fetchHiddenLeadIds(leadIds: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(leadIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("students")
    .select("lead_id, login_disabled, archived_at, deleted_at")
    .in("lead_id", ids);
  if (error) throw error;
  const hidden = new Set<string>();
  for (const row of (data || []) as Array<{ lead_id: string | null } & StaffQueueStudentFlags>) {
    if (row.lead_id && isHiddenFromStaffQueues(row)) hidden.add(row.lead_id);
  }
  return hidden;
}

export async function fetchHiddenStudentIds(studentIds: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(studentIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("students")
    .select("id, login_disabled, archived_at, deleted_at")
    .in("id", ids);
  if (error) throw error;
  const hidden = new Set<string>();
  for (const row of (data || []) as Array<{ id: string } & StaffQueueStudentFlags>) {
    if (isHiddenFromStaffQueues(row)) hidden.add(row.id);
  }
  return hidden;
}

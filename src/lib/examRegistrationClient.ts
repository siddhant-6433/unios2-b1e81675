/**
 * Supabase-facing helpers for the generalized exam_registrations table.
 * Kept separate from examRegistration.ts (pure mapping logic, unit-tested)
 * so that module stays free of a supabase import.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ExamCode, ExamRegistrationStatus } from "@/lib/examRegistration";

export interface ExamRegistrationRow {
  id: string;
  lead_id: string;
  exam_code: ExamCode;
  status: ExamRegistrationStatus;
  registration_no: string | null;
  document_url: string | null;
  notes: string | null;
  registered_at: string | null;
  created_at: string;
}

const COLUMNS =
  "id, lead_id, exam_code, status, registration_no, document_url, notes, registered_at, created_at";

/** All registration rows for a single lead, keyed by exam_code. */
export async function fetchExamRegistrationsForLead(
  leadId: string | null | undefined,
): Promise<Partial<Record<ExamCode, ExamRegistrationRow>>> {
  if (!leadId) return {};
  const { data, error } = await supabase
    .from("exam_registrations" as any)
    .select(COLUMNS)
    .eq("lead_id", leadId);
  if (error) {
    console.error("exam_registrations fetch failed:", error.message);
    return {};
  }
  const out: Partial<Record<ExamCode, ExamRegistrationRow>> = {};
  for (const row of (data || []) as ExamRegistrationRow[]) out[row.exam_code] = row;
  return out;
}

/** Batch fetch for a set of leads → lead_id → exam_code → row. */
export async function fetchExamRegistrationsForLeads(
  leadIds: string[],
): Promise<Record<string, Partial<Record<ExamCode, ExamRegistrationRow>>>> {
  const ids = Array.from(new Set(leadIds.filter(Boolean)));
  const out: Record<string, Partial<Record<ExamCode, ExamRegistrationRow>>> = {};
  if (!ids.length) return out;
  const { data, error } = await supabase
    .from("exam_registrations" as any)
    .select(COLUMNS)
    .in("lead_id", ids);
  if (error) {
    console.error("exam_registrations batch fetch failed:", error.message);
    return out;
  }
  for (const row of (data || []) as ExamRegistrationRow[]) {
    (out[row.lead_id] ||= {})[row.exam_code] = row;
  }
  return out;
}

/** Signed URL for a registration document (private bucket). */
export async function signExamRegistrationDoc(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from("exam-registrations")
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl || null;
}

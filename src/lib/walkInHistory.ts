import { supabase } from "@/integrations/supabase/client";

export interface WalkInHistoryRow {
  id: string;
  visit_date: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  purpose: string | null;
  feedback: string | null;
  campus_name: string;
  campus_code: string;
  status: string;
}

/** Calendar day in IST so "same day" matches the date picker. */
export function visitDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function formatWalkInWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export async function fetchWalkInHistory(leadId: string): Promise<WalkInHistoryRow[]> {
  const { data, error } = await supabase
    .from("campus_visits")
    .select(`
      id, visit_date, checked_in_at, checked_out_at, purpose, feedback, status,
      campuses(name, code)
    `)
    .eq("lead_id", leadId)
    .eq("visit_type", "walk_in")
    .order("visit_date", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    visit_date: r.visit_date,
    checked_in_at: r.checked_in_at,
    checked_out_at: r.checked_out_at,
    purpose: r.purpose,
    feedback: r.feedback,
    campus_name: r.campuses?.name ?? "—",
    campus_code: r.campuses?.code ?? "",
    status: r.status,
  }));
}

export function walkInOnDay(rows: WalkInHistoryRow[], ymd: string): WalkInHistoryRow | undefined {
  if (!ymd) return undefined;
  return rows.find((r) => visitDayKey(r.visit_date) === ymd);
}

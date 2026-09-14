import { supabase } from "@/integrations/supabase/client";

export interface LiveWalkIn {
  id: string;
  lead_id: string;
  checked_in_at: string;
  purpose: string | null;
  lead_name: string;
  lead_phone: string;
  campus_name: string;
  campus_code: string;
}

export function walkInElapsed(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function startOfLocalDayIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export async function fetchLiveWalkIns(): Promise<LiveWalkIn[]> {
  const { data, error } = await supabase
    .from("campus_visits")
    .select(`
      id, lead_id, checked_in_at, purpose,
      leads!inner(name, phone),
      campuses(name, code)
    `)
    .eq("visit_type", "walk_in")
    .gte("checked_in_at", startOfLocalDayIso())
    .is("checked_out_at" as any, null)
    .order("checked_in_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    lead_id: r.lead_id,
    checked_in_at: r.checked_in_at,
    purpose: r.purpose,
    lead_name: r.leads?.name ?? "—",
    lead_phone: r.leads?.phone ?? "",
    campus_name: r.campuses?.name ?? "—",
    campus_code: r.campuses?.code ?? "",
  }));
}

export async function completeWalkIn(visitId: string): Promise<void> {
  const { error } = await supabase.rpc("visit_check_out" as any, { _visit_id: visitId });
  if (error) throw error;
}

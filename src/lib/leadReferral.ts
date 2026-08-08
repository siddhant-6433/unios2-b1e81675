import { supabase } from "@/integrations/supabase/client";
import { isBptOrBmritCourseName } from "@/lib/cahet";

// Referring a BPT/BMRIT lead to the partner (Stetho) who calls it on our behalf.
// The partner is resolved server-side inside refer_lead_to_partner — most staff
// roles cannot SELECT academic_partners, so we never look it up from the client.
export const REFERRAL_PARTNER_LABEL = "Stetho";

export const REFERRAL_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  contacted: "Contacted",
  not_reachable: "Not reachable",
  admitted: "Admitted",
  not_admitted: "Not admitted",
};

export const REFERRAL_STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning-foreground",
  contacted: "bg-info/10 text-info-foreground",
  not_reachable: "bg-muted text-muted-foreground",
  admitted: "bg-success/10 text-success",
  not_admitted: "bg-destructive/10 text-destructive",
};

export interface LeadReferralRow {
  id: string;
  lead_id: string;
  status: string;
  referred_at: string;
  referred_by_name: string | null;
  partner_notes: string | null;
}

export function isReferrableCourse(courseName: string | null | undefined): boolean {
  return isBptOrBmritCourseName(courseName);
}

export interface ReferResult {
  referred: number;
  failed: { leadId: string; message: string }[];
}

/**
 * Refer one or more leads to the referral partner. Idempotent per lead — the RPC
 * returns the existing referral id if the lead was already referred. The DB also
 * re-checks the BPT/BMRIT gate, so a bad leadId fails loudly instead of silently.
 */
export async function referLeadsToPartner(leadIds: string[], note?: string): Promise<ReferResult> {
  const result: ReferResult = { referred: 0, failed: [] };
  // ponytail: sequential loop — referrals are handfuls of leads at a time.
  // Batch into a single set-returning RPC if someone starts referring hundreds.
  for (const leadId of leadIds) {
    const { error } = await supabase.rpc("refer_lead_to_partner" as never, {
      _lead_id: leadId,
      _note: note || null,
    } as never);
    if (error) result.failed.push({ leadId, message: error.message });
    else result.referred += 1;
  }
  return result;
}

/** Referral rows for a set of leads, keyed by lead_id. Empty map on error. */
export async function fetchReferralsByLead(leadIds: string[]): Promise<Map<string, LeadReferralRow>> {
  const map = new Map<string, LeadReferralRow>();
  if (leadIds.length === 0) return map;
  const { data, error } = await supabase
    .from("lead_referrals" as never)
    .select("id, lead_id, status, referred_at, referred_by_name, partner_notes")
    .in("lead_id", leadIds);
  if (error || !data) return map;
  (data as unknown as LeadReferralRow[]).forEach((row) => map.set(row.lead_id, row));
  return map;
}

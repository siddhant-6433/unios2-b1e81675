import { supabase } from "@/integrations/supabase/client";

// Applications fans out lead_fee_status per offer/payment lead (~5k calls,
// 121ms mean). A short TTL plus inflight coalescing collapses remounts and
// the 8-wide worker colliding on the same id. Portal payment UI should
// invalidate after a write so PAN/AN amounts stay live.

export const LEAD_FEE_STATUS_TTL_MS = 2 * 60_000;

type RpcResult = { data: any; error: any };

const inflight = new Map<string, Promise<RpcResult>>();
const cache = new Map<string, { at: number; res: RpcResult }>();

export function invalidateLeadFeeStatus(leadId?: string): void {
  if (!leadId) {
    cache.clear();
    return;
  }
  cache.delete(leadId);
}

export async function fetchLeadFeeStatus(leadId: string): Promise<RpcResult> {
  const hit = cache.get(leadId);
  if (hit && Date.now() - hit.at < LEAD_FEE_STATUS_TTL_MS) return hit.res;

  const existing = inflight.get(leadId);
  if (existing) return existing;

  const p = (supabase as any)
    .rpc("lead_fee_status", { _lead_id: leadId })
    .then((res: RpcResult) => {
      inflight.delete(leadId);
      if (!res.error) cache.set(leadId, { at: Date.now(), res });
      return res;
    })
    .catch((err: any) => {
      inflight.delete(leadId);
      throw err;
    });

  inflight.set(leadId, p);
  return p;
}

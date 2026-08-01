import { supabase } from "@/integrations/supabase/client";

// action_badge_counts is an expensive RLS-scoped aggregate. Three layout
// components (AppSidebar, GlobalActionBar, WhatsAppPanel) each call it on mount
// and on realtime bursts, so the same query fires 2-3x simultaneously and,
// under load, blows past the 8s statement timeout (500 + 57014 in the DB logs).
//
// This wrapper collapses those bursts: identical concurrent calls share one
// in-flight request, and a short TTL absorbs the mount-time triple-fire and
// back-to-back realtime refetches. It does NOT change the RLS boundary or the
// SQL — same params still hit the same function.
//
// ponytail: in-memory single-tab dedup. Cross-tab load is inherent (each open
// CRM tab polls independently); upgrade to a shared worker only if that bites.

type BadgeArgs = { p_scope_counsellor_id: string | null; p_include_unassigned: boolean };
type RpcResult = { data: any; error: any };

const TTL_MS = 3000;
const inflight = new Map<string, Promise<RpcResult>>();
const cache = new Map<string, { at: number; res: RpcResult }>();

export async function fetchActionBadgeCounts(args: BadgeArgs): Promise<RpcResult> {
  const key = `${args.p_scope_counsellor_id ?? "all"}|${args.p_include_unassigned}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.res;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (supabase as any)
    .rpc("action_badge_counts", args)
    .then((res: RpcResult) => {
      inflight.delete(key);
      if (!res.error) cache.set(key, { at: Date.now(), res }); // never cache failures
      return res;
    })
    .catch((err: any) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, p);
  return p;
}

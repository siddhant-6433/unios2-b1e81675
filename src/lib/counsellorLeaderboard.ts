import { supabase } from "@/integrations/supabase/client";

// Header chip, Admissions badge, Action Center widget, and Counsellor
// Dashboard all called get_counsellor_leaderboard independently. One 5-minute
// cache collapses that to a single RPC per session.

export const COUNSELLOR_LEADERBOARD_TTL_MS = 5 * 60_000;

type RpcResult = { data: any; error: any };

const inflight = new Map<string, Promise<RpcResult>>();
const cache = new Map<string, { at: number; res: RpcResult }>();

async function sessionUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? "anon";
}

export async function fetchCounsellorLeaderboard(): Promise<RpcResult> {
  const uid = await sessionUserId();
  const key = uid;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < COUNSELLOR_LEADERBOARD_TTL_MS) return hit.res;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (supabase as any)
    .rpc("get_counsellor_leaderboard")
    .then((res: RpcResult) => {
      inflight.delete(key);
      if (!res.error) cache.set(key, { at: Date.now(), res });
      return res;
    })
    .catch((err: any) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, p);
  return p;
}

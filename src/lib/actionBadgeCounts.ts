import { supabase } from "@/integrations/supabase/client";

// action_badge_counts is an expensive RLS-scoped aggregate. Sidebar and the
// action bar share this helper so concurrent mounts collapse to one RPC.
// Counts are directional (overdue follow-ups, fresh leads), not live ops, so
// a 10-minute TTL is enough — visibilitychange must not bypass it.

type BadgeArgs = { p_scope_counsellor_id: string | null; p_include_unassigned: boolean };
type RpcResult = { data: any; error: any };

export const ACTION_BADGE_TTL_MS = 10 * 60_000;
export const ACTION_BADGE_POLL_MS = ACTION_BADGE_TTL_MS;
const TTL_MS = ACTION_BADGE_TTL_MS;
const inflight = new Map<string, Promise<RpcResult>>();
const cache = new Map<string, { at: number; res: RpcResult }>();

async function sessionUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? "anon";
}

export async function fetchActionBadgeCounts(args: BadgeArgs): Promise<RpcResult> {
  const uid = await sessionUserId();
  const key = `${uid}|${args.p_scope_counsellor_id ?? "all"}|${args.p_include_unassigned}`;

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

// Pending WhatsApp reply status (last inbound, not DNC). Inbox chips only;
// layout chrome must not call this. 5-minute TTL plus invalidate-on-send.
type ReplyStateArgs = {
  p_counsellor_id: string | null;
  p_business_key: string | null;
  p_include_outbound_only: boolean;
};

export const REPLY_STATE_TTL_MS = 5 * 60_000;
const replyStateInflight = new Map<string, Promise<RpcResult>>();
const replyStateCache = new Map<string, { at: number; res: RpcResult }>();

export async function fetchWhatsAppReplyStateCounts(args: ReplyStateArgs): Promise<RpcResult> {
  const uid = await sessionUserId();
  const key = `${uid}|${args.p_counsellor_id ?? "all"}|${args.p_business_key ?? "all"}|${args.p_include_outbound_only}`;

  const hit = replyStateCache.get(key);
  if (hit && Date.now() - hit.at < REPLY_STATE_TTL_MS) return hit.res;

  const existing = replyStateInflight.get(key);
  if (existing) return existing;

  const p = (supabase as any)
    .rpc("whatsapp_reply_state_counts", args)
    .then((res: RpcResult) => {
      replyStateInflight.delete(key);
      if (!res.error) replyStateCache.set(key, { at: Date.now(), res });
      return res;
    })
    .catch((err: any) => {
      replyStateInflight.delete(key);
      throw err;
    });

  replyStateInflight.set(key, p);
  return p;
}

/** Drop the cache after an action that changes reply state (sending a reply). */
export function invalidateWhatsAppReplyStateCounts(): void {
  replyStateCache.clear();
}

// get_active_overview returns { presence, leads } for the header widget:
// online login-users (scoped) + recently-active leads/applicants. The presence
// list is cheap; the super_admin "recently active leads" UNION is ~2s and only
// visible once the popover is open. So the every-page background poll passes
// includeLeads=false (presence only), and we pay for the leads list on demand.
// Separate cache slots per flag; dedup + TTL absorb the mount triple-fire.
const ACTIVE_OVERVIEW_TTL_MS = 5 * 60_000;
const activeOverviewInflight = new Map<string, Promise<RpcResult>>();
const activeOverviewCache = new Map<string, { at: number; res: RpcResult }>();

export async function fetchActiveOverview(includeLeads = true): Promise<RpcResult> {
  const uid = await sessionUserId();
  const key = `${uid}|${includeLeads ? "full" : "presence"}`;

  const hit = activeOverviewCache.get(key);
  if (hit && Date.now() - hit.at < ACTIVE_OVERVIEW_TTL_MS) return hit.res;

  const existing = activeOverviewInflight.get(key);
  if (existing) return existing;

  const p = (supabase as any)
    .rpc("get_active_overview", { _include_leads: includeLeads })
    .then((res: RpcResult) => {
      activeOverviewInflight.delete(key);
      if (!res.error) activeOverviewCache.set(key, { at: Date.now(), res });
      return res;
    })
    .catch((err: any) => {
      activeOverviewInflight.delete(key);
      throw err;
    });

  activeOverviewInflight.set(key, p);
  return p;
}

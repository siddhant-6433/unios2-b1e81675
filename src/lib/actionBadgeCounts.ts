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

// whatsapp_reply_state_counts is the same shape of problem: a ~1.2s
// conversation-level aggregate that the header calls on every page and the
// inbox calls on every refresh. Same dedup, longer TTL — reply state moves on
// the scale of someone typing a reply, not milliseconds.
type ReplyStateArgs = {
  p_counsellor_id: string | null;
  p_business_key: string | null;
  p_include_outbound_only: boolean;
};

const REPLY_STATE_TTL_MS = 15000;
const replyStateInflight = new Map<string, Promise<RpcResult>>();
const replyStateCache = new Map<string, { at: number; res: RpcResult }>();

export async function fetchWhatsAppReplyStateCounts(args: ReplyStateArgs): Promise<RpcResult> {
  const key = `${args.p_counsellor_id ?? "all"}|${args.p_business_key ?? "all"}|${args.p_include_outbound_only}`;

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
const ACTIVE_OVERVIEW_TTL_MS = 30000;
const activeOverviewInflight = new Map<string, Promise<RpcResult>>();
const activeOverviewCache = new Map<string, { at: number; res: RpcResult }>();

export async function fetchActiveOverview(includeLeads = true): Promise<RpcResult> {
  const key = includeLeads ? "full" : "presence";

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

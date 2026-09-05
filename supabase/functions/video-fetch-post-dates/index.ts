// video-fetch-post-dates
//
// Fills videos.instagram_posted_on / youtube_posted_on from the PLATFORM (not the
// editor), so the bill month is fraud-proof:
//   - Instagram: Graph API media of the brand's IG Business account, matched by
//     the pasted permalink's shortcode. Reuses META_PAGE_ACCESS_TOKEN
//     (already has instagram_basic). Draft / preview permalinks are not in this
//     published-media list and are rejected.
//   - YouTube: Data API videos.list -> snippet.publishedAt (needs YOUTUBE_API_KEY).
//   - LinkedIn: no API needed — the post's timestamp is encoded in the activity
//     id in the URL (first 41 bits = Unix ms; ms = id >> 22). Verified to match
//     the Instagram cross-post time to within a minute. Tamper-proof (baked into
//     the real post URL), free, offline.
//
// After fetching, each platform timestamp is compared with videos.approved_at
// (timestamptz, not calendar day). A post that went live before approval — the
// Instagram-draft trick, or any same-day pre-approval upload — is dropped.
//
// Modes:
//   { video_id }        -> one video (callable by its owning editor OR super_admin)
//   { month: 'YYYY-MM-01' } or { all: true } -> batch (super_admin only)
//   { force: true }     -> overwrite dates already set
// The videos trigger recomputes posted_month on update.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/service-auth.ts";
import {
  applySocialDateGuard,
  igShortcode,
  ytVideoId,
  type Rejection,
} from "./guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: unknown, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...cors, "Content-Type": "application/json" } });

const GRAPH = "https://graph.facebook.com/v21.0";

// Brand slug -> Instagram Business account id (verified linked to the brand FB page).
const IG_ACCOUNT: Record<string, string> = {
  nimt_educational_institutions: "17841400921723194",
  nimt_beacon_school: "17841458357143015",
  mirai_experiential_school: "17841447171961261",
  // seralis_lab: no page/IG mapped yet
};

type Vid = {
  id: string; brand: string; editor_id: string;
  instagram_url: string | null; youtube_url: string | null; linkedin_url: string | null;
  instagram_posted_on: string | null; youtube_posted_on: string | null; linkedin_posted_on: string | null;
  approved_at: string | null;
};

type IgListResult = {
  dates: Map<string, string>;
  /** true when we paged to the end or found every wanted shortcode, with no API errors */
  complete: boolean;
};

// Page an IG account's published media, collecting timestamps for the wanted shortcodes.
// Draft / preview permalinks never appear here.
async function fetchIgDates(igId: string, token: string, wanted: Set<string>): Promise<IgListResult> {
  const out = new Map<string, string>();
  let next: string | null = `${GRAPH}/${igId}/media?fields=permalink,timestamp&limit=100&access_token=${token}`;
  let complete = false;
  for (let page = 0; page < 20 && next; page++) {
    const j: any = await fetch(next).then(r => r.json()).catch(() => null);
    if (!j || j.error) return { dates: out, complete: false };
    for (const m of (j.data || [])) {
      const sc = igShortcode(m.permalink);
      if (sc && wanted.has(sc) && !out.has(sc)) out.set(sc, m.timestamp);
    }
    if ([...wanted].every(s => out.has(s))) { complete = true; break; }
    next = j.paging?.next || null;
    if (!next) complete = true;
  }
  return { dates: out, complete };
}

async function fetchYtDates(ids: string[], key: string): Promise<{ dates: Map<string, string>; ok: boolean }> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const j: any = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(",")}&key=${key}`)
      .then(r => r.json()).catch(() => null);
    if (!j || j.error) return { dates: out, ok: false };
    for (const it of (j.items || [])) if (it.id && it.snippet?.publishedAt) out.set(it.id, it.snippet.publishedAt);
  }
  return { dates: out, ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, svc, { auth: { persistSession: false } });

    // Service callers (fn_video_auto_fetch_dates cron via x-cron-secret /
    // service key) run as super with no user; staff callers authenticate by JWT.
    const svcCaller = await isServiceCaller(req, admin);
    let uid: string | null = null;
    let isSuper = svcCaller;
    if (!svcCaller) {
      const caller = createClient(url, svc, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } }, auth: { persistSession: false } });
      const { data: u } = await caller.auth.getUser();
      uid = u?.user?.id ?? null;
      if (!uid) return json({ error: "Unauthorized" }, 401);
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
      isSuper = (roles || []).some((r: { role: string }) => r.role === "super_admin");
    }

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const igToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");
    const ytKey = Deno.env.get("YOUTUBE_API_KEY");

    // Resolve the target video set.
    let targets: Vid[] = [];
    const sel = "id, brand, editor_id, instagram_url, youtube_url, linkedin_url, instagram_posted_on, youtube_posted_on, linkedin_posted_on, approved_at";
    if (body.video_id) {
      const { data: v } = await admin.from("videos").select(sel).eq("id", body.video_id).maybeSingle();
      if (!v) return json({ error: "Video not found" }, 404);
      if (!isSuper) {
        // Editor may only fetch dates for their own videos.
        const { data: ed } = await admin.from("video_editors").select("user_id").eq("id", (v as Vid).editor_id).maybeSingle();
        if (!ed || ed.user_id !== uid) return json({ error: "Forbidden" }, 403);
      }
      targets = [v as Vid];
    } else {
      if (!isSuper) return json({ error: "Forbidden — batch requires super_admin" }, 403);
      let q = admin.from("videos").select(sel).eq("is_billable", true);
      if (body.month) q = q.eq("posted_month", body.month);
      const { data } = await q.limit(2000);
      targets = (data as Vid[]) || [];
    }
    if (targets.length === 0) return json({ ok: true, updated: 0, rejected: [], note: "no target videos" });

    // Group Instagram shortcodes per brand; collect YouTube ids.
    const igWanted = new Map<string, Set<string>>();      // brand -> shortcodes
    const scByVideo = new Map<string, string>();          // video id -> shortcode
    const ytIdByVideo = new Map<string, string>();        // video id -> yt id
    for (const v of targets) {
      const sc = igShortcode(v.instagram_url);
      if (sc && IG_ACCOUNT[v.brand] && (force || !v.instagram_posted_on)) {
        scByVideo.set(v.id, sc);
        if (!igWanted.has(v.brand)) igWanted.set(v.brand, new Set());
        igWanted.get(v.brand)!.add(sc);
      }
      const yid = ytVideoId(v.youtube_url);
      if (yid && ytKey && (force || !v.youtube_posted_on)) ytIdByVideo.set(v.id, yid);
    }

    // Fetch from the platforms.
    const igDates = new Map<string, string>(); // shortcode -> timestamp
    const igCompleteByBrand = new Map<string, boolean>();
    if (igToken) {
      for (const [brand, wanted] of igWanted) {
        const m = await fetchIgDates(IG_ACCOUNT[brand], igToken, wanted);
        for (const [sc, ts] of m.dates) igDates.set(sc, ts);
        igCompleteByBrand.set(brand, m.complete);
      }
    }
    const ytResult = ytKey && ytIdByVideo.size
      ? await fetchYtDates([...new Set(ytIdByVideo.values())], ytKey)
      : { dates: new Map<string, string>(), ok: true };
    const ytDates = ytResult.dates;

    // Apply. Invalid links (draft / pre-approval) are cleared so they cannot
    // stay attached as "published".
    let updated = 0, igSet = 0, ytSet = 0, liSet = 0, igMiss = 0, ytMiss = 0;
    const rejected: Rejection[] = [];
    for (const v of targets) {
      const sc = scByVideo.get(v.id);
      const yid = ytIdByVideo.get(v.id);
      const { patch, rejected: drops } = applySocialDateGuard({
        videoId: v.id,
        approvedAt: v.approved_at,
        instagramUrl: v.instagram_url,
        youtubeUrl: v.youtube_url,
        linkedinUrl: v.linkedin_url,
        instagramPostedOn: v.instagram_posted_on,
        youtubePostedOn: v.youtube_posted_on,
        linkedinPostedOn: v.linkedin_posted_on,
        force,
        igTimestamp: sc ? (igDates.get(sc) ?? null) : null,
        igLookedUp: !!sc,
        igListingComplete: !!(igToken && igCompleteByBrand.get(v.brand)),
        ytTimestamp: yid ? (ytDates.get(yid) ?? null) : null,
        ytLookedUp: !!yid,
        ytListingComplete: ytResult.ok,
      });
      rejected.push(...drops);
      if (patch.instagram_posted_on) igSet++;
      else if (drops.some(d => d.platform === "instagram" && d.reason === "not_published")) igMiss++;
      if (patch.youtube_posted_on) ytSet++;
      else if (drops.some(d => d.platform === "youtube" && d.reason === "not_published")) ytMiss++;
      if (patch.linkedin_posted_on) liSet++;
      if (Object.keys(patch).length) {
        const { error } = await admin.from("videos").update(patch).eq("id", v.id);
        if (!error) updated++;
      }
    }

    return json({
      ok: rejected.length === 0,
      targets: targets.length, updated,
      rejected,
      instagram: { set: igSet, not_found: igMiss, token: igToken ? "present" : "MISSING META_PAGE_ACCESS_TOKEN" },
      youtube: { set: ytSet, not_found: ytMiss, key: ytKey ? "present" : "MISSING YOUTUBE_API_KEY (skipped)" },
      linkedin: { set: liSet },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// video-fetch-post-dates
//
// Fills videos.instagram_posted_on / youtube_posted_on from the PLATFORM (not the
// editor), so the bill month is fraud-proof:
//   - Instagram: Graph API media of the brand's IG Business account, matched by
//     the pasted permalink's shortcode. Reuses META_PAGE_ACCESS_TOKEN
//     (already has instagram_basic).
//   - YouTube: Data API videos.list -> snippet.publishedAt (needs YOUTUBE_API_KEY).
//   - LinkedIn: no public read API — left as-is (manual/display only).
//
// Modes:
//   { video_id }        -> one video (callable by its owning editor OR super_admin)
//   { month: 'YYYY-MM-01' } or { all: true } -> batch (super_admin only)
//   { force: true }     -> overwrite dates already set
// The videos trigger recomputes posted_month on update.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const igShortcode = (url: string | null): string | null => {
  if (!url) return null;
  const m = url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
};

const ytVideoId = (url: string | null): string | null => {
  if (!url) return null;
  const m = url.match(/(?:v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

type Vid = {
  id: string; brand: string; editor_id: string;
  instagram_url: string | null; youtube_url: string | null;
  instagram_posted_on: string | null; youtube_posted_on: string | null;
};

// Page an IG account's media, collecting timestamps for the wanted shortcodes.
async function fetchIgDates(igId: string, token: string, wanted: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let next: string | null = `${GRAPH}/${igId}/media?fields=permalink,timestamp&limit=100&access_token=${token}`;
  for (let page = 0; page < 20 && next; page++) {
    const j: any = await fetch(next).then(r => r.json()).catch(() => null);
    if (!j || j.error) break;
    for (const m of (j.data || [])) {
      const sc = igShortcode(m.permalink);
      if (sc && wanted.has(sc) && !out.has(sc)) out.set(sc, m.timestamp);
    }
    if ([...wanted].every(s => out.has(s))) break; // all found
    next = j.paging?.next || null;
  }
  return out;
}

async function fetchYtDates(ids: string[], key: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const j: any = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(",")}&key=${key}`)
      .then(r => r.json()).catch(() => null);
    for (const it of (j?.items || [])) if (it.id && it.snippet?.publishedAt) out.set(it.id, it.snippet.publishedAt);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, svc, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } }, auth: { persistSession: false } });
    const admin = createClient(url, svc, { auth: { persistSession: false } });

    const { data: u } = await caller.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    const isSuper = (roles || []).some((r: { role: string }) => r.role === "super_admin");

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const igToken = Deno.env.get("META_PAGE_ACCESS_TOKEN");
    const ytKey = Deno.env.get("YOUTUBE_API_KEY");

    // Resolve the target video set.
    let targets: Vid[] = [];
    const sel = "id, brand, editor_id, instagram_url, youtube_url, instagram_posted_on, youtube_posted_on";
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
    if (targets.length === 0) return json({ ok: true, updated: 0, note: "no target videos" });

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
    const igDates = new Map<string, string>(); // shortcode -> timestamp (per brand namespaced by shortcode uniqueness)
    if (igToken) {
      for (const [brand, wanted] of igWanted) {
        const m = await fetchIgDates(IG_ACCOUNT[brand], igToken, wanted);
        for (const [sc, ts] of m) igDates.set(sc, ts);
      }
    }
    const ytDates = ytKey ? await fetchYtDates([...new Set(ytIdByVideo.values())], ytKey) : new Map<string, string>();

    // Apply.
    let updated = 0, igSet = 0, ytSet = 0, igMiss = 0, ytMiss = 0;
    for (const v of targets) {
      const patch: Record<string, string> = {};
      const sc = scByVideo.get(v.id);
      if (sc) { const ts = igDates.get(sc); if (ts) { patch.instagram_posted_on = ts; igSet++; } else igMiss++; }
      const yid = ytIdByVideo.get(v.id);
      if (yid) { const ts = ytDates.get(yid); if (ts) { patch.youtube_posted_on = ts; ytSet++; } else ytMiss++; }
      if (Object.keys(patch).length) {
        const { error } = await admin.from("videos").update(patch).eq("id", v.id);
        if (!error) updated++;
      }
    }

    return json({
      ok: true, targets: targets.length, updated,
      instagram: { set: igSet, not_found: igMiss, token: igToken ? "present" : "MISSING META_PAGE_ACCESS_TOKEN" },
      youtube: { set: ytSet, not_found: ytMiss, key: ytKey ? "present" : "MISSING YOUTUBE_API_KEY (skipped)" },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

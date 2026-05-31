/**
 * video-notify — WhatsApp notifications for the video approval workflow.
 * ─────────────────────────────────────────────────────────────────────────
 * Events:
 *   - "submitted": an editor submitted a video → notify every super-admin
 *     phone so they can review it in the approval queue.
 *   - "approved": a super-admin approved a video → notify the editor's phone
 *     asking them to post it and submit the published social links.
 *
 * Both sends go through whatsapp-send (templated, logged to whatsapp_messages).
 * Fire-and-forget per recipient — a failed send never fails the request.
 *
 * Auth: the Supabase gateway verifies the JWT (verify_jwt = true) before this
 * runs, so any authenticated caller (the editor for "submitted", a super-admin
 * for "approved") or the service role is accepted. All privileged lookups use
 * the service-role client below.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BRAND_LABEL: Record<string, string> = {
  nimt_educational_institutions: "NIMT Educational Institutions",
  nimt_beacon_school: "NIMT Beacon School",
  mirai_experiential_school: "Mirai Experiential School",
  seralis_lab: "Seralis Lab",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let body: { event?: string; video_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { event, video_id } = body;
  if (!event || !video_id) return json({ error: "event and video_id required" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: video } = await db
    .from("videos")
    .select("id, title, brand, status, editor_id")
    .eq("id", video_id)
    .maybeSingle();
  if (!video) return json({ error: "video not found" }, 404);

  const { data: editor } = await db
    .from("video_editors")
    .select("id, name, phone, user_id")
    .eq("id", video.editor_id)
    .maybeSingle();

  const brandLabel = BRAND_LABEL[video.brand as string] || (video.brand as string);

  const sendWhatsApp = async (template_key: string, phone: string, params: string[]) => {
    if (!phone) return;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ template_key, phone, params }),
      });
    } catch (e) {
      console.error(`[video-notify] ${template_key}→${phone} failed:`, e);
    }
  };

  if (event === "submitted") {
    // Every super-admin phone gets pinged to review the new submission.
    const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "super_admin");
    const userIds = (roles || []).map((r: any) => r.user_id);
    const phones = new Set<string>();
    if (userIds.length) {
      const { data: profs } = await db.from("profiles").select("phone").in("user_id", userIds);
      (profs || []).forEach((p: any) => { if (p.phone) phones.add(String(p.phone).trim()); });
    }
    for (const phone of phones) {
      await sendWhatsApp("video_submitted_admin", phone, [editor?.name || "An editor", video.title, brandLabel]);
    }
    return json({ ok: true, notified: phones.size });
  }

  if (event === "approved") {
    // Editor's WhatsApp — prefer the explicit editor phone, fall back to the
    // linked user's profile phone.
    let phone: string | null = editor?.phone ? String(editor.phone).trim() : null;
    if (!phone && editor?.user_id) {
      const { data: prof } = await db.from("profiles").select("phone").eq("user_id", editor.user_id).maybeSingle();
      phone = prof?.phone ? String(prof.phone).trim() : null;
    }
    if (phone) await sendWhatsApp("video_approved_editor", phone, [editor?.name || "there", video.title]);
    return json({ ok: true, notified: phone ? 1 : 0 });
  }

  return json({ error: `unknown event: ${event}` }, 400);
});

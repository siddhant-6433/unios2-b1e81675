// interview-meet — attach a Google Meet link + Calendar event to an interview.
//
// If Google Workspace service-account creds are configured
// (GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_CALENDAR_ID) it creates a Calendar event
// with Meet conferencing via the Calendar API and stores the ids/links.
// Otherwise it returns a Google Calendar "add event" template URL and a
// meet.google.com/new link, so the interviewer can create them in one click.
//
// Auth: hr:interviews_edit / hr:recruitment_edit / super admin.
// Body: { interview_id } (or { applicant_id, scheduled_at, duration_mins, title })

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (p: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Google service-account JWT (RS256) ──────────────────────────────────────
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function googleAccessToken(saJson: string): Promise<string | null> {
  try {
    const sa = JSON.parse(saJson);
    const now = Math.floor(Date.now() / 1000);
    const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64urlStr(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/calendar.events",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    }));
    const unsigned = `${header}.${claim}`;
    const key = await crypto.subtle.importKey(
      "pkcs8", pemToBytes(sa.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
    const jwt = `${unsigned}.${b64url(sig)}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch (e) {
    console.error("[interview-meet] token error", e);
    return null;
  }
}

const gcalStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "Unauthorized" }, 401);
    const checks = await Promise.all([
      admin.rpc("has_permission", { _user_id: uid, _perm: "hr:interviews_edit" }),
      admin.rpc("has_permission", { _user_id: uid, _perm: "hr:recruitment_edit" }),
    ]);
    if (!checks.some((c) => c.data === true)) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const interviewId: string | undefined = body.interview_id;

    let interview: {
      id?: string; job_applicant_id?: string; scheduled_at?: string;
      duration_mins?: number | null; notes?: string | null; location?: string | null;
    } | null = null;
    let applicant: { name?: string | null; email?: string | null; desired_role?: string | null; lead_id?: string | null } | null = null;

    if (interviewId) {
      const { data: iv } = await admin.from("interviews")
        .select("id, job_applicant_id, scheduled_at, duration_mins, notes, location")
        .eq("id", interviewId).maybeSingle();
      if (!iv) return json({ error: "Interview not found" }, 404);
      interview = iv;
      const { data: a } = await admin.from("job_applicants")
        .select("name, email, desired_role, lead_id").eq("id", iv.job_applicant_id).maybeSingle();
      applicant = a;
    } else {
      if (!body.applicant_id || !body.scheduled_at) return json({ error: "interview_id or applicant_id + scheduled_at required" }, 400);
      const { data: a } = await admin.from("job_applicants")
        .select("name, email, desired_role, lead_id").eq("id", body.applicant_id).maybeSingle();
      applicant = a;
      interview = { job_applicant_id: body.applicant_id, scheduled_at: body.scheduled_at, duration_mins: body.duration_mins ?? 30, notes: body.title ?? null };
    }

    let toEmail = applicant?.email ?? null;
    if (!toEmail && applicant?.lead_id) {
      const { data: l } = await admin.from("leads").select("email").eq("id", applicant.lead_id).maybeSingle();
      toEmail = l?.email ?? null;
    }

    const start = new Date(interview!.scheduled_at!);
    const end = new Date(start.getTime() + (Number(interview!.duration_mins) || 30) * 60000);
    const title = `Interview — ${applicant?.name || "Candidate"}${applicant?.desired_role ? ` (${applicant.desired_role})` : ""}`;
    const details = `Interview scheduled via NIMT UniOs.${interview!.notes ? `\n\n${interview!.notes}` : ""}`;

    const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
    let meetLink: string | null = null;
    let eventId: string | null = null;
    let htmlLink: string | null = null;
    let createdViaApi = false;

    if (saJson && calendarId) {
      const token = await googleAccessToken(saJson);
      if (token) {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              summary: title,
              description: details,
              start: { dateTime: start.toISOString() },
              end: { dateTime: end.toISOString() },
              attendees: toEmail ? [{ email: toEmail }] : undefined,
              conferenceData: {
                createRequest: { requestId: `unios-${interviewId || Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
              },
            }),
          },
        );
        if (res.ok) {
          const ev = await res.json();
          meetLink = ev.hangoutLink ?? null;
          eventId = ev.id ?? null;
          htmlLink = ev.htmlLink ?? null;
          createdViaApi = true;
        } else {
          console.error("[interview-meet] calendar create failed", (await res.text()).slice(0, 400));
        }
      }
    }

    // Fallbacks (no Google creds configured).
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${gcalStamp(start)}/${gcalStamp(end)}` +
      `&details=${encodeURIComponent(details)}` +
      (toEmail ? `&add=${encodeURIComponent(toEmail)}` : "");
    const meetUrl = meetLink || "https://meet.google.com/new";

    if (interviewId) {
      await admin.from("interviews").update({
        meet_link: meetLink ?? "https://meet.google.com/new",
        calendar_event_id: eventId,
        calendar_html_link: htmlLink ?? calendarUrl,
        ...(meetLink ? { meeting_link: meetLink } : {}),
      }).eq("id", interviewId);
    }

    return json({
      ok: true,
      created_via_api: createdViaApi,
      meet_link: meetUrl,
      calendar_url: htmlLink ?? calendarUrl,
      calendar_event_id: eventId,
      manual: !createdViaApi,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

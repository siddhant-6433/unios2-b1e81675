// --- Rate limiting (in-memory, resets every minute) ---
const ipCounts = new Map<string, number>();
let lastReset = Date.now();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (now - lastReset > RATE_WINDOW_MS) {
    ipCounts.clear();
    lastReset = now;
  }
  const count = (ipCounts.get(ip) ?? 0) + 1;
  ipCounts.set(ip, count);
  return count > RATE_LIMIT;
}

// --- 1x1 transparent GIF ---
const TRANSPARENT_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

// --- Valid event types ---
const VALID_EVENT_TYPES = new Set([
  "page_view",
  "chat_open",
  "chat_message",
  "navya_click",
  "whatsapp_click",
  "whatsapp_reply",
  "email_open",
  "form_start",
  "apply_click",
]);

// --- Phone normalisation to +91XXXXXXXXXX ---
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("91")) return `+${digits}`;
  // Already has + prefix
  if (raw.startsWith("+91") && digits.length === 12) return `+${digits}`;
  return null;
}

// --- CORS headers ---
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  if (isRateLimited(ip)) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const restHeaders = {
    "Content-Type": "application/json",
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  async function dbInsert(table: string, row: Record<string, unknown>) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Insert ${table} failed:`, err);
      return { error: err };
    }
    return { error: null };
  }

  async function dbSelect(table: string, query: string) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
      headers: restHeaders,
    });
    if (!res.ok) return [];
    return await res.json();
  }

  try {
    // ---- GET: email open pixel ----
    if (req.method === "GET") {
      const url = new URL(req.url);
      const t = url.searchParams.get("t");
      if (t !== "email_open") {
        return jsonResponse({ ok: false, error: "invalid_tracking_type" }, 400);
      }

      const leadId = url.searchParams.get("lid");
      const messageId = url.searchParams.get("mid");

      const { error: pixelErr } = await dbInsert("lead_engagement_events", {
        event_type: "email_open",
        lead_id: leadId || null,
        metadata: { message_id: messageId },
        ip_address: ip,
      });
      if (pixelErr) console.error("pixel insert error:", pixelErr);

      return new Response(TRANSPARENT_GIF, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      });
    }

    // ---- POST: general engagement event ----
    if (req.method === "POST") {
      const body = await req.json();
      const { phone, event_type, page_url, referrer, metadata, session_id } =
        body as {
          phone?: string;
          event_type?: string;
          page_url?: string;
          referrer?: string;
          metadata?: Record<string, unknown>;
          session_id?: string;
        };

      if (!event_type || !VALID_EVENT_TYPES.has(event_type)) {
        return jsonResponse(
          {
            ok: false,
            error: `invalid_event_type. Must be one of: ${[...VALID_EVENT_TYPES].join(", ")}`,
          },
          400,
        );
      }

      // Resolve lead_id from phone
      let leadId: string | null = null;
      const normalized = phone ? normalizePhone(phone) : null;
      if (normalized) {
        const rows = await dbSelect("leads", `phone=eq.${encodeURIComponent(normalized)}&select=id&limit=1`);
        if (rows.length > 0) leadId = rows[0].id;
      }

      const { error: insertError } = await dbInsert("lead_engagement_events", {
        event_type,
        lead_id: leadId,
        phone: normalized,
        page_url: page_url || null,
        referrer: referrer || null,
        metadata: metadata || null,
        session_id: session_id || null,
        ip_address: ip,
      });

      if (insertError) {
        return jsonResponse({ ok: false, error: insertError }, 500);
      }

      // Backfill: if we now have a lead_id + session_id, link all prior
      // orphaned events from this session to the lead so engagement_score
      // gets recalculated.
      if (leadId && session_id) {
        const backfillRes = await fetch(
          `${supabaseUrl}/rest/v1/lead_engagement_events?session_id=eq.${encodeURIComponent(session_id)}&lead_id=is.null`,
          {
            method: "PATCH",
            headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ lead_id: leadId, phone: normalized }),
          },
        );
        if (backfillRes.ok) {
          // Recalculate engagement_score from all events for this lead
          const allEvents = await dbSelect(
            "lead_engagement_events",
            `lead_id=eq.${leadId}&select=event_type`,
          );
          const SCORE_MAP: Record<string, number> = {
            page_view: 1, chat_open: 3, chat_message: 5, navya_click: 5,
            whatsapp_click: 4, email_open: 3, form_start: 4, apply_click: 8,
          };
          let total = 0;
          for (const e of allEvents) {
            total += SCORE_MAP[e.event_type] ?? 0;
          }
          total = Math.min(total, 100);
          // Update lead engagement_score directly
          await fetch(
            `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`,
            {
              method: "PATCH",
              headers: { ...restHeaders, Prefer: "return=minimal" },
              body: JSON.stringify({
                engagement_score: total,
                last_engaged_at: new Date().toISOString(),
              }),
            },
          );
        }
      }

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  } catch (err) {
    console.error("track-engagement error:", err);
    return jsonResponse({ ok: false, error: "internal_error" }, 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Service-role only. Accept either the runtime-injected secret or a legacy
  // service-role JWT (what _app_config's cron pattern sends) — same dual check
  // as counsellor-call-miner/index.ts.
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let isServiceRole = token === serviceRoleKey;
  if (!isServiceRole && token.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      isServiceRole = payload?.role === "service_role";
    } catch { /* not a JWT */ }
  }
  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Recipients config — exit gracefully (logged) until a human fills it in.
    const { data: cfg } = await admin
      .from("_app_config")
      .select("value")
      .eq("key", "navya_visit_digest_recipients")
      .maybeSingle();
    let recipients: { to?: string[]; cc?: string[] } = {};
    try { recipients = JSON.parse(cfg?.value || "{}"); } catch { /* keep empty */ }
    const to = (recipients.to || []).filter((x) => typeof x === "string" && x.trim());
    const cc = (recipients.cc || []).filter((x) => typeof x === "string" && x.trim());
    if (to.length === 0) {
      console.log("navya-visit-digest: no recipients configured — skipping send");
      return new Response(JSON.stringify({ skipped: true, reason: "no recipients" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Visits Navya booked in the last 24h.
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: visits, error } = await admin
      .from("campus_visits")
      .select("visit_date, created_at, lead_id, leads(name, phone, counsellor_id, courses:course_id(name))")
      .eq("booked_by", "navya")
      .gte("created_at", sinceIso)
      .order("visit_date", { ascending: true });
    if (error) throw error;

    const rows = visits || [];
    if (rows.length === 0) {
      console.log("navya-visit-digest: no Navya visits in last 24h — nothing to send");
      return new Response(JSON.stringify({ sent: false, count: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve lead-owner names in one query (counsellor_id FKs profiles.id).
    const counsellorIds = [
      ...new Set(rows.map((r: any) => r.leads?.counsellor_id).filter(Boolean)),
    ];
    const ownerById = new Map<string, string>();
    if (counsellorIds.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", counsellorIds);
      for (const p of profs || []) ownerById.set((p as any).id, (p as any).display_name || "—");
    }

    // "Sun 13 Jul, 11:00 AM" (IST)
    const fmt = (iso: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      const date = d.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short",
      }).replace(",", "");
      const time = d.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
      }).toUpperCase();
      return `${date}, ${time}`;
    };

    // "Saturday, 12 July 2026" (IST)
    const dateLabel = new Date().toLocaleDateString("en-GB", {
      timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const n = rows.length;
    const plural = n === 1 ? "" : "s";

    const tableRows = rows
      .map((r: any, i: number) => {
        const lead = r.leads || {};
        const owner = lead.counsellor_id ? ownerById.get(lead.counsellor_id) || "—" : "Unassigned";
        const bg = i % 2 === 1 ? "background:#f8fafc;" : "";
        const leadCell = r.lead_id
          ? `<a href="https://uni.nimt.ac.in/admissions/${esc(r.lead_id)}" style="color:#0047FF;text-decoration:none;font-weight:600">${esc(lead.name || "Lead")}</a>`
          : `<span style="font-weight:600">${esc(lead.name || "—")}</span>`;
        const course = lead.courses?.name
          ? `<br /><span style="font-size:12px;color:#64748b">${esc(lead.courses.name)}</span>`
          : "";
        return `<tr style="${bg}">
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;white-space:nowrap;vertical-align:top">${esc(fmt(r.visit_date))}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;vertical-align:top">${leadCell}${course}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;vertical-align:top">${esc(owner)}</td>
        </tr>`;
      })
      .join("");

    const subject = `Navya booked ${n} campus visit${plural} — ${dateLabel}`;
    const preheader = `Navya booked ${n} campus visit${plural} — owners have been notified.`;
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;${font}">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
        <tr>
          <td style="background:#1a2744;padding:24px 32px">
            <div style="${font};font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.5px">NIMT UniOs</div>
            <div style="${font};font-size:13px;color:#8fa3c8;margin-top:4px">Navya — AI Admissions Counsellor</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px">
            <div style="${font};font-size:32px;font-weight:700;color:#0f172a;line-height:1.2">${n} campus visit${plural} booked today</div>
            <div style="${font};font-size:14px;color:#64748b;margin-top:6px">${esc(dateLabel)} (IST)</div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 16px 8px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${font};font-size:14px;color:#0f172a;border-collapse:collapse">
              <tr>
                <th align="left" style="padding:8px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:2px solid #e2e8f0;white-space:nowrap">Visit date &amp; time</th>
                <th align="left" style="padding:8px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:2px solid #e2e8f0">Lead</th>
                <th align="left" style="padding:8px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;border-bottom:2px solid #e2e8f0">Lead owner</th>
              </tr>
              ${tableRows}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px">
            <div style="${font};font-size:12px;color:#94a3b8;line-height:1.6">
              Booked automatically by Navya during AI calls. Review calls and teach Navya at
              <a href="https://uni.nimt.ac.in/admin/navya-knowledge" style="color:#0047FF;text-decoration:none">uni.nimt.ac.in/admin/navya-knowledge</a>.<br />
              NIMT Educational Institutions &middot; <a href="https://uni.nimt.ac.in" style="color:#94a3b8;text-decoration:none">uni.nimt.ac.in</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Deliver to everyone: send-email takes a single to_email + cc array.
    // First recipient is the primary; the rest fold into cc.
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        to_email: to[0],
        cc: [...to.slice(1), ...cc],
        custom_subject: subject,
        custom_body: html,
      }),
    });
    const sendResult = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`send-email failed ${res.status}: ${JSON.stringify(sendResult).slice(0, 300)}`);
    }

    console.log(`navya-visit-digest: sent ${rows.length} visits to ${to[0]} (+${to.length - 1 + cc.length} cc)`);
    return new Response(JSON.stringify({ sent: true, count: rows.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("navya-visit-digest error:", message);
    return new Response(JSON.stringify({ error: message || "Digest failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

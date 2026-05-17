// Daily reminder cron for the Personal Document Tracker.
//
// Fires from pg_cron at 08:00 IST every day. For each document with an
// expires_on within a milestone window, sends WhatsApp and/or email
// reminders (per the owner's prefs) and writes to
// personal_doc_reminders_sent so we never double-send a milestone.
//
// Milestones: 30d, 7d, 1d (before expiry), and `expired` (the day after).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Milestone = "30d" | "7d" | "1d" | "expired";

function milestoneFor(daysUntilExpiry: number): Milestone | null {
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry === 0 || daysUntilExpiry === 1) return "1d";
  if (daysUntilExpiry <= 7) return "7d";
  if (daysUntilExpiry <= 30) return "30d";
  return null;
}

function humanWindow(m: Milestone): string {
  return m === "30d" ? "in 30 days"
       : m === "7d"  ? "in 7 days"
       : m === "1d"  ? "tomorrow"
       :               "EXPIRED";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supaUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey  = Deno.env.get("RESEND_API_KEY");
    const waToken    = Deno.env.get("WHATSAPP_API_TOKEN");
    const waPnId     = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const fromEmail  = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";

    const admin = createClient(supaUrl, serviceKey);

    // Pull all docs with an expiry within the window we care about (-3 .. 30d)
    // so a freshly-added doc that already expired up to 3 days ago still gets
    // an "EXPIRED" nudge.
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    const { data: docs, error: docsErr } = await admin
      .from("personal_documents")
      .select("id, owner_email, doc_type, label, expires_on")
      .not("expires_on", "is", null)
      .gte("expires_on", new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10))
      .lte("expires_on", new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10));

    if (docsErr) {
      return json({ error: docsErr.message }, 500);
    }

    if (!docs || docs.length === 0) {
      return json({ ok: true, sent: 0, scanned: 0, note: "no docs in reminder window" }, 200);
    }

    // Hydrate owner info from user_roles + profiles + auth.users
    const ownerEmails = Array.from(new Set(docs.map(d => d.owner_email)));

    // All super_admin user IDs
    const { data: roleRows } = await admin
      .from("user_roles").select("user_id").eq("role", "super_admin");
    const saIds = (roleRows || []).map((r: { user_id: string }) => r.user_id);

    // Their profile phones
    const { data: profileRows } = saIds.length
      ? await admin.from("profiles").select("user_id, phone").in("user_id", saIds)
      : { data: [] };

    // Resolve emails via auth admin API
    const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const saIdSet = new Set(saIds);
    const profileMap = new Map((profileRows || []).map((p: { user_id: string; phone: string | null }) => [p.user_id, p.phone]));

    const ownerByEmail = new Map(
      authUsers
        .filter(u => saIdSet.has(u.id) && u.email && ownerEmails.includes(u.email))
        .map(u => [u.email!, {
          email: u.email!,
          display_name: (u.user_metadata?.display_name as string) || u.email!.split("@")[0],
          whatsapp_phone: profileMap.get(u.id) || null,
          notify_whatsapp: true,
          notify_email: true,
        }])
    );

    let sent = 0;
    const results: any[] = [];

    for (const doc of docs) {
      const expires = new Date(doc.expires_on as string + "T00:00:00Z");
      const days = Math.round((expires.getTime() - new Date(todayIso + "T00:00:00Z").getTime()) / 86400000);
      const milestone = milestoneFor(days);
      if (!milestone) continue;

      // Idempotency: skip if already sent
      const { error: dedupErr } = await admin
        .from("personal_doc_reminders_sent")
        .insert({ document_id: doc.id, milestone });
      if (dedupErr) {
        // Unique-violation = already sent; anything else is a real error.
        if (!/duplicate key|unique constraint/i.test(dedupErr.message)) {
          console.error("[reminder] dedup insert failed:", dedupErr.message);
        }
        continue;
      }

      const owner = ownerByEmail.get(doc.owner_email);
      if (!owner) continue;

      const headline = `${doc.label} (${doc.doc_type.replace(/_/g, " ")}) expires ${humanWindow(milestone)} — ${doc.expires_on}`;
      const result: any = { document_id: doc.id, milestone, channels: [] };

      // WhatsApp
      if (owner.notify_whatsapp && owner.whatsapp_phone && waToken && waPnId) {
        try {
          const r = await fetch(`https://graph.facebook.com/v21.0/${waPnId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: owner.whatsapp_phone.replace(/[^0-9]/g, ""),
              type: "text",
              text: { body: `⏰ Reminder\n${headline}` },
            }),
          });
          if (r.ok) result.channels.push("whatsapp");
          else result.channels.push(`whatsapp_failed:${r.status}`);
        } catch (e: any) {
          result.channels.push(`whatsapp_err:${e?.message || "?"}`);
        }
      }

      // Email
      if (owner.notify_email && resendKey) {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: fromEmail,
              to: [owner.email],
              subject: `Document expiry reminder: ${doc.label}`,
              html: `
                <div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;max-width:540px;margin:0 auto;padding:24px">
                  <h2 style="margin:0 0 16px;font-size:18px">Document expiry reminder</h2>
                  <p>Hi ${owner.display_name || ""},</p>
                  <p>Heads up — your <b>${doc.doc_type.replace(/_/g, " ")}</b> is ${milestone === "expired" ? "<b style=\"color:#b91c1c\">past its expiry</b>" : "approaching expiry"}.</p>
                  <table style="border-collapse:collapse;margin:16px 0">
                    <tr><td style="padding:6px 12px 6px 0;color:#64748b">Label</td><td style="padding:6px 0"><b>${doc.label}</b></td></tr>
                    <tr><td style="padding:6px 12px 6px 0;color:#64748b">Expires on</td><td style="padding:6px 0"><b>${doc.expires_on}</b> (${humanWindow(milestone)})</td></tr>
                  </table>
                  <p style="color:#64748b;font-size:12px;margin-top:24px">Sent by your Personal Document Tracker</p>
                </div>`,
            }),
          });
          if (r.ok) result.channels.push("email");
          else result.channels.push(`email_failed:${r.status}`);
        } catch (e: any) {
          result.channels.push(`email_err:${e?.message || "?"}`);
        }
      }

      sent++;
      results.push(result);
    }

    return json({ ok: true, scanned: docs.length, sent, results }, 200);
  } catch (err: any) {
    console.error("personal-doc-reminder-cron error:", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});

function json(body: any, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

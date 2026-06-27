import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SOURCE_LABELS: Record<string, string> = {
  collegehai: "CollegeHai",
  collegedunia: "CollegeDunia",
  justdial: "JustDial",
  salahlo: "Salahlo",
  website: "Website",
  website_chat: "Website Chat",
  web_chat: "Web Chat",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  mirai_website: "Mirai Website",
  consultant: "Consultant",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  reference: "Reference",
  referral: "Referral",
  education_fair: "Education Fair",
  other: "Other",
};

type LeadSummaryRow = {
  id: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  jd_category: string | null;
  created_at: string;
  courses?: { name: string | null } | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function sourceLabel(source: string | null): string {
  return source ? SOURCE_LABELS[source] || source : "Unknown";
}

function yesterdayIstBounds(now = new Date()) {
  const istOffsetMs = 330 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const todayStartUtcMs = Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
  ) - istOffsetMs;
  const yesterdayStartUtcMs = todayStartUtcMs - 24 * 60 * 60 * 1000;
  const labelDate = new Date(yesterdayStartUtcMs + istOffsetMs);
  const label = labelDate.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return {
    fromIso: new Date(yesterdayStartUtcMs).toISOString(),
    toIso: new Date(todayStartUtcMs).toISOString(),
    label,
  };
}

function buildHtml(rows: LeadSummaryRow[], label: string): string {
  const bySource = new Map<string, number>();
  for (const row of rows) {
    const label = sourceLabel(row.source);
    bySource.set(label, (bySource.get(label) || 0) + 1);
  }
  const sourceSummary = Array.from(bySource.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, count]) => `<li>${escapeHtml(source)}: <strong>${count}</strong></li>`)
    .join("");

  const tableRows = rows.slice(0, 200).map((row) => `
    <tr>
      <td>${escapeHtml(row.name || "-")}</td>
      <td>${escapeHtml(row.phone || "-")}</td>
      <td>${escapeHtml(row.courses?.name || "-")}</td>
      <td>${escapeHtml(row.jd_category || "-")}</td>
      <td>${escapeHtml(sourceLabel(row.source))}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 8px">Leads Added Yesterday</h2>
      <p style="margin:0 0 16px;color:#475569">${rows.length} lead${rows.length === 1 ? "" : "s"} added on ${escapeHtml(label)}.</p>
      <ul style="margin:0 0 18px;padding-left:20px;color:#334155">${sourceSummary || "<li>No leads added.</li>"}</ul>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="border:1px solid #cbd5e1;padding:8px;text-align:left">Lead name</th>
            <th style="border:1px solid #cbd5e1;padding:8px;text-align:left">Mobile No</th>
            <th style="border:1px solid #cbd5e1;padding:8px;text-align:left">Course</th>
            <th style="border:1px solid #cbd5e1;padding:8px;text-align:left">JD Keyword</th>
            <th style="border:1px solid #cbd5e1;padding:8px;text-align:left">Source</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || `<tr><td colspan="5" style="border:1px solid #cbd5e1;padding:8px;text-align:center;color:#64748b">No leads added.</td></tr>`}
        </tbody>
      </table>
      ${rows.length > 200 ? `<p style="color:#64748b;font-size:12px">Showing first 200 rows in email. Full list is attached as CSV.</p>` : ""}
    </div>
  `;
}

function buildCsv(rows: LeadSummaryRow[]): string {
  const header = ["Lead name", "Mobile No", "Course", "JD Keyword", "Source", "Created At"];
  const lines = rows.map((row) => [
    row.name || "",
    row.phone || "",
    row.courses?.name || "",
    row.jd_category || "",
    sourceLabel(row.source),
    row.created_at,
  ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expectedCronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = req.headers.get("x-cron-secret");
  const auth = req.headers.get("Authorization") || "";
  const authorizedByCron = !!expectedCronSecret && cronSecret === expectedCronSecret;
  const authorizedByServiceRole = auth === `Bearer ${serviceRoleKey}`;

  if (!authorizedByCron && !authorizedByServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = await req.json().catch(() => ({}));
  const bounds = body?.from && body?.to
    ? { fromIso: String(body.from), toIso: String(body.to), label: String(body.label || "selected date") }
    : yesterdayIstBounds();

  const { data, error } = await supabase
    .from("leads")
    .select("id, name, phone, source, jd_category, created_at, courses:course_id(name)")
    .gte("created_at", bounds.fromIso)
    .lt("created_at", bounds.toIso)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("daily lead summary query failed", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (data || []) as LeadSummaryRow[];
  const html = buildHtml(rows, bounds.label);
  const csv = buildCsv(rows);
  const to = (Deno.env.get("LEAD_SUMMARY_EMAIL_TO") || "admissions@nimt.ac.in")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const from = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
  const subject = "Leads Added Yesterday";

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      attachments: [{
        filename: `leads-added-yesterday-${bounds.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
        content: toBase64(csv),
      }],
    }),
  });

  const emailResult = await emailRes.json().catch(() => ({}));
  const success = emailRes.ok;

  await supabase.from("email_messages").insert({
    to_email: to.join(","),
    from_email: from,
    subject,
    body_html: html,
    status: success ? "sent" : "failed",
    provider_id: emailResult?.id || null,
    sent_at: success ? new Date().toISOString() : null,
  });

  if (!success) {
    console.error("daily lead summary email failed", emailResult);
    return new Response(JSON.stringify({ error: emailResult?.message || "Email send failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, leads: rows.length, recipients: to.length, id: emailResult?.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

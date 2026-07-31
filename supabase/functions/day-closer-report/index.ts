// Day Closer report — emailed when an accountant / super_admin closes the day
// (optionally per campus). Lists today's offline receipts for the closed
// campus(es): a Cash table and a separate Other-Offline table (cheque / bank /
// UPI / credit-note). Recipients are the actual accountants + super_admins
// (user_roles → profiles.email), plus a "Day Closer triggered by {name}" line.
//
// Invoked from the app via supabase.functions.invoke("day-closer-report", {body})
// with the caller's JWT; also callable directly with the service-role key (test).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI/Wallet",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque/DD",
  online: "Online (manual)",
  consultant_credit_note: "Consultant Credit Note",
};
const modeLabel = (m: string | null) => (m ? MODE_LABELS[m] || m : "Unknown");

type Row = {
  paid_at: string;
  receipt_no: string | null;
  person_name: string | null;
  admission_no: string | null;
  course_name: string | null;
  campus_name: string | null;
  payment_mode: string | null;
  amount: number | string | null;
  fee_type: string | null;
  gateway: string | null;
  source: string | null;
  cashier_name: string | null;
};

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const csvCell = (v: unknown) => {
  const t = String(v ?? "");
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const amt = (v: Row["amount"]) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const istTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

// [start of today IST, now] as UTC ISO bounds.
function todayIstBounds(now = new Date()) {
  const istOffsetMs = 330 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const todayStartUtcMs =
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs;
  const label = new Date(todayStartUtcMs + istOffsetMs).toLocaleDateString("en-IN", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
  });
  return { fromIso: new Date(todayStartUtcMs).toISOString(), toIso: now.toISOString(), label };
}

const TH = `border:1px solid #cbd5e1;padding:8px;text-align:left`;
const TD = `border:1px solid #cbd5e1;padding:8px`;
const TDR = `${TD};text-align:right`;

function detailTable(title: string, rows: Row[], showMode: boolean): string {
  const sum = rows.reduce((s, r) => s + amt(r.amount), 0);
  if (rows.length === 0) {
    return `<h3 style="margin:22px 0 6px">${escapeHtml(title)}</h3>
      <p style="margin:0;color:#64748b;font-size:13px">No receipts.</p>`;
  }
  const modeCol = showMode ? `<th style="${TH}">Mode</th>` : "";
  const body = rows.map((x) => `
    <tr>
      <td style="${TD}">${escapeHtml(x.receipt_no || "—")}</td>
      <td style="${TD}">${escapeHtml(x.admission_no || "—")}</td>
      <td style="${TD}">${escapeHtml(x.person_name || "—")}</td>
      <td style="${TD}">${escapeHtml(x.course_name || "—")}</td>
      <td style="${TD}">${escapeHtml(x.campus_name || "—")}</td>
      ${showMode ? `<td style="${TD}">${escapeHtml(modeLabel(x.payment_mode))}</td>` : ""}
      <td style="${TDR}">${inr(amt(x.amount))}</td>
      <td style="${TD}">${escapeHtml(x.cashier_name || "—")}</td>
      <td style="${TD}">${escapeHtml(istTime(x.paid_at))}</td>
    </tr>`).join("");
  const cols = showMode ? 6 : 5;
  return `
    <h3 style="margin:22px 0 6px">${escapeHtml(title)} — ${rows.length} receipt${rows.length === 1 ? "" : "s"}, ${inr(sum)}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="background:#f1f5f9">
        <th style="${TH}">Receipt No</th><th style="${TH}">Admission No</th><th style="${TH}">Name</th>
        <th style="${TH}">Course</th><th style="${TH}">Campus</th>${modeCol}
        <th style="${TH};text-align:right">Amount</th><th style="${TH}">Cashier</th><th style="${TH}">Time (IST)</th>
      </tr></thead>
      <tbody>${body}
        <tr style="background:#f8fafc;font-weight:600">
          <td style="${TD}" colspan="${cols}">Subtotal</td>
          <td style="${TDR}">${inr(sum)}</td><td style="${TD}"></td><td style="${TD}"></td>
        </tr>
      </tbody>
    </table>`;
}

function buildHtml(rows: Row[], scope: string, triggeredBy: string, label: string): string {
  const cash = rows.filter((r) => r.payment_mode === "cash");
  const other = rows.filter((r) => r.payment_mode !== "cash");
  const cashTotal = cash.reduce((s, r) => s + amt(r.amount), 0);
  const otherTotal = other.reduce((s, r) => s + amt(r.amount), 0);
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 4px">Day Closer — ${escapeHtml(scope)}</h2>
      <p style="margin:0 0 2px;color:#475569">Day Closer triggered by <strong>${escapeHtml(triggeredBy)}</strong> · ${escapeHtml(stamp)} IST</p>
      <p style="margin:0 0 18px;color:#475569">Collection for ${escapeHtml(label)} — Cash <strong>${inr(cashTotal)}</strong>${
        other.length ? ` · Other offline <strong>${inr(otherTotal)}</strong>` : ""
      } across ${rows.length} receipt${rows.length === 1 ? "" : "s"}.</p>

      ${detailTable("Cash", cash, false)}
      ${detailTable("Other Offline (cheque / bank / UPI / credit-note)", other, true)}

      <p style="color:#64748b;font-size:12px;margin-top:18px">Full line-item list attached as CSV.</p>
    </div>`;
}

function buildCsv(rows: Row[]): string {
  const header = ["Receipt No", "Admission No", "Name", "Course", "Campus", "Payment Mode", "Amount", "Fee Type", "Cashier", "Paid At"];
  const lines = rows.map((r) => [
    r.receipt_no || "", r.admission_no || "", r.person_name || "", r.course_name || "",
    r.campus_name || "", modeLabel(r.payment_mode), amt(r.amount), r.fee_type || "",
    r.cashier_name || "", r.paid_at,
  ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- AuthZ: service-role key (test), else a logged-in accountant/super_admin.
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  let triggeredBy = "System";
  if (jwt && jwt !== serviceRoleKey) {
    const { data: u, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    const allowed = (roles || []).some((r: { role: string }) => r.role === "accountant" || r.role === "super_admin");
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Trust the server-resolved name, not the client string.
    const { data: prof } = await admin.from("profiles").select("display_name").eq("user_id", u.user.id).maybeSingle();
    triggeredBy = prof?.display_name || u.user.email || "Unknown";
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  // null / [] => all campuses; else the specific closed campuses.
  const campusIds: string[] | null = Array.isArray(body?.campus_ids) && body.campus_ids.length
    ? body.campus_ids.map(String)
    : null;
  if (typeof body?.triggered_by === "string" && triggeredBy === "System" && !jwt) {
    triggeredBy = body.triggered_by; // only trusted when no user JWT (direct service-role test)
  }

  const bounds = todayIstBounds();
  const { data, error } = await admin.rpc("get_offline_collection", {
    p_from: bounds.fromIso,
    p_to: bounds.toIso,
    p_campus_ids: campusIds,
  });
  if (error) {
    console.error("get_offline_collection failed", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (data || []) as Row[];
  const scope = campusIds
    ? [...new Set(rows.map((r) => r.campus_name).filter(Boolean))].join(", ") || "Selected campus"
    : "All Campuses";
  const html = buildHtml(rows, scope, triggeredBy, bounds.label);
  const csv = buildCsv(rows);

  // Recipients: real accountants + super_admins (user_roles → profiles.email).
  const { data: recRoles } = await admin.from("user_roles").select("user_id").in("role", ["accountant", "super_admin"]);
  const recipientIds = [...new Set((recRoles || []).map((r: { user_id: string }) => r.user_id))];
  let to: string[] = [];
  if (recipientIds.length) {
    const { data: profs } = await admin.from("profiles").select("email").in("user_id", recipientIds);
    to = [...new Set((profs || []).map((p: { email: string | null }) => p.email).filter(Boolean) as string[])];
  }
  if (!to.length) {
    to = (Deno.env.get("FEE_REPORT_EMAIL_TO") || "siddhant@nimt.ac.in")
      .split(",").map((e) => e.trim()).filter(Boolean);
  }

  const from = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
  const subject = `Day Closer — ${scope} — ${bounds.label}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to, subject, html,
      attachments: [{
        filename: `day-closer-${bounds.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
        content: toBase64(csv),
      }],
    }),
  });
  const emailResult = await emailRes.json().catch(() => ({}));
  const success = emailRes.ok;

  await admin.from("email_messages").insert({
    to_email: to.join(","),
    from_email: from,
    subject,
    body_html: html,
    status: success ? "sent" : "failed",
    provider_id: emailResult?.id || null,
    sent_at: success ? new Date().toISOString() : null,
  });

  if (!success) {
    console.error("day closer email failed", emailResult);
    return new Response(JSON.stringify({ error: emailResult?.message || "Email send failed" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, receipts: rows.length, recipients: to.length, id: emailResult?.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

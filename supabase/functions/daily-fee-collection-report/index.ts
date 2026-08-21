import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/service-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI/Wallet",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque/DD",
  online: "Online (manual)",
  gateway: "Payment Gateway",
  consultant_credit_note: "Consultant Credit Note",
};

// Stable display order; unknown modes get appended after these.
const MODE_ORDER = ["cash", "upi", "bank_transfer", "cheque", "online", "gateway", "consultant_credit_note"];

type FeeRow = {
  paid_at: string;
  receipt_no: string | null;
  person_name: string | null;
  course_name: string | null;
  campus_name: string | null;
  payment_mode: string | null;
  amount: number | string | null;
  fee_type: string | null;
  gateway: string | null;
  source: string | null;
  cashier_name: string | null;
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

function modeLabel(mode: string | null): string {
  return mode ? MODE_LABELS[mode] || mode : "Unknown";
}

function amt(value: FeeRow["amount"]): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
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

const TH = `border:1px solid #cbd5e1;padding:8px;text-align:left`;
const TD = `border:1px solid #cbd5e1;padding:8px`;
const TDR = `${TD};text-align:right`;

// Group rows by mode, ordered by MODE_ORDER first, then any unknown modes.
function groupByMode(rows: FeeRow[]): [string, FeeRow[]][] {
  const map = new Map<string, FeeRow[]>();
  for (const r of rows) {
    const key = r.payment_mode || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const keys = [...map.keys()].sort((a, b) => {
    const ia = MODE_ORDER.indexOf(a), ib = MODE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((k) => [k, map.get(k)!]);
}

function buildHtml(rows: FeeRow[], label: string): string {
  const total = rows.reduce((s, r) => s + amt(r.amount), 0);
  const grouped = groupByMode(rows);

  if (rows.length === 0) {
    return `
      <div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
        <h2 style="margin:0 0 8px">Daily Fee Collection</h2>
        <p style="margin:0;color:#475569">No fee collected on ${escapeHtml(label)}.</p>
      </div>
    `;
  }

  // Summary by payment mode
  const modeSummary = grouped.map(([mode, r]) => {
    const sum = r.reduce((s, x) => s + amt(x.amount), 0);
    return `<tr><td style="${TD}">${escapeHtml(modeLabel(mode))}</td><td style="${TDR}">${r.length}</td><td style="${TDR}">${inr(sum)}</td></tr>`;
  }).join("");

  // Summary by campus
  const byCampus = new Map<string, { count: number; sum: number }>();
  for (const r of rows) {
    const key = r.campus_name || "—";
    const acc = byCampus.get(key) || { count: 0, sum: 0 };
    acc.count += 1;
    acc.sum += amt(r.amount);
    byCampus.set(key, acc);
  }
  const campusSummary = Array.from(byCampus.entries())
    .sort((a, b) => b[1].sum - a[1].sum || a[0].localeCompare(b[0]))
    .map(([campus, v]) => `<tr><td style="${TD}">${escapeHtml(campus)}</td><td style="${TDR}">${v.count}</td><td style="${TDR}">${inr(v.sum)}</td></tr>`)
    .join("");

  // One detail table per mode
  const detailTables = grouped.map(([mode, r]) => {
    const sum = r.reduce((s, x) => s + amt(x.amount), 0);
    const body = r.map((x) => `
      <tr>
        <td style="${TD}">${escapeHtml(x.receipt_no || "—")}</td>
        <td style="${TD}">${escapeHtml(x.person_name || "—")}</td>
        <td style="${TD}">${escapeHtml(x.course_name || "—")}</td>
        <td style="${TD}">${escapeHtml(x.campus_name || "—")}</td>
        <td style="${TDR}">${inr(amt(x.amount))}</td>
        <td style="${TD}">${escapeHtml(x.cashier_name || "—")}</td>
        <td style="${TD}">${escapeHtml(istTime(x.paid_at))}</td>
      </tr>`).join("");
    return `
      <h3 style="margin:22px 0 6px">${escapeHtml(modeLabel(mode))} — ${r.length} receipt${r.length === 1 ? "" : "s"}, ${inr(sum)}</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr style="background:#f1f5f9">
          <th style="${TH}">Receipt No</th><th style="${TH}">Name</th><th style="${TH}">Course</th>
          <th style="${TH}">Campus</th><th style="${TH};text-align:right">Amount</th>
          <th style="${TH}">Cashier</th><th style="${TH}">Time (IST)</th>
        </tr></thead>
        <tbody>${body}
          <tr style="background:#f8fafc;font-weight:600">
            <td style="${TD}" colspan="4">Subtotal</td>
            <td style="${TDR}">${inr(sum)}</td><td style="${TD}"></td><td style="${TD}"></td>
          </tr>
        </tbody>
      </table>`;
  }).join("");

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 4px">Daily Fee Collection — ${escapeHtml(label)}</h2>
      <p style="margin:0 0 18px;color:#475569">Total collected: <strong>${inr(total)}</strong> across ${rows.length} receipt${rows.length === 1 ? "" : "s"}.</p>

      <h3 style="margin:0 0 6px">By Payment Mode</h3>
      <table style="border-collapse:collapse;font-size:13px;min-width:360px">
        <thead><tr style="background:#f1f5f9">
          <th style="${TH}">Mode</th><th style="${TH};text-align:right">Receipts</th><th style="${TH};text-align:right">Total</th>
        </tr></thead>
        <tbody>${modeSummary}
          <tr style="background:#f8fafc;font-weight:600">
            <td style="${TD}">Grand Total</td><td style="${TDR}">${rows.length}</td><td style="${TDR}">${inr(total)}</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin:22px 0 6px">By Campus</h3>
      <table style="border-collapse:collapse;font-size:13px;min-width:360px">
        <thead><tr style="background:#f1f5f9">
          <th style="${TH}">Campus</th><th style="${TH};text-align:right">Receipts</th><th style="${TH};text-align:right">Total</th>
        </tr></thead>
        <tbody>${campusSummary}</tbody>
      </table>

      ${detailTables}
      <p style="color:#64748b;font-size:12px;margin-top:18px">Full line-item list attached as CSV.</p>
    </div>
  `;
}

/**
 * Money that reached the gateway but never reached the ledger.
 *
 * A candidate who pays inside a UPI app and closes the tab leaves the row
 * pending: no receipt, no ledger credit, nothing on any screen finance looks
 * at. That failure is silent by construction, so it rides along on the one
 * report finance already reads every morning.
 */
async function buildStuckSection(supabase: any): Promise<string> {
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  const [stuckRes, webhookRes] = await Promise.all([
    supabase
      .from("lead_payments")
      .select("id, amount, gateway, transaction_ref, created_at, leads(name, phone)")
      .eq("status", "pending")
      .eq("payment_mode", "gateway")
      .lt("created_at", dayAgo)
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("gateway_settlements")
      .select("id")
      .eq("gateway", "easebuzz")
      .eq("source", "webhook")
      .gte("created_at", dayAgo)
      .limit(1),
  ]);

  const stuck = (stuckRes.data || []) as any[];
  const webhookSilent = !(webhookRes.data || []).length;
  if (!stuck.length && !webhookSilent) return "";

  const total = stuck.reduce((s, r) => s + amt(r.amount), 0);
  const rowsHtml = stuck.slice(0, 25).map((r) => `
    <tr>
      <td style="${TD}">${escapeHtml(r.leads?.name || "—")}</td>
      <td style="${TD}">${escapeHtml(r.leads?.phone || "")}</td>
      <td style="${TDR}">${inr(amt(r.amount))}</td>
      <td style="${TD}">${escapeHtml(r.gateway || "")}</td>
      <td style="${TD}">${escapeHtml(String(r.created_at).slice(0, 16).replace("T", " "))}</td>
    </tr>`).join("");

  return `
    <div style="border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;padding:14px;margin:0 0 20px">
      <h3 style="margin:0 0 6px;color:#b91c1c">⚠ Gateway payments not in the ledger</h3>
      ${webhookSilent ? `<p style="margin:0 0 8px;color:#7f1d1d;font-size:13px"><strong>No EaseBuzz webhook has been received in 24 hours.</strong> If candidates are paying, the S2S webhook is not reaching us — every payment then depends on the candidate returning to the browser.</p>` : ""}
      ${stuck.length ? `
      <p style="margin:0 0 8px;color:#7f1d1d;font-size:13px">${stuck.length} payment${stuck.length === 1 ? "" : "s"} totalling <strong>${inr(total)}</strong> have been pending for more than 24 hours. Open Finance → Transaction History and use <em>Verify with EaseBuzz</em> on each. Do not record them manually first — that issues two receipts for one payment.</p>
      <table style="border-collapse:collapse;font-size:13px;min-width:520px;background:#fff">
        <thead><tr style="background:#fee2e2">
          <th style="${TH}">Candidate</th><th style="${TH}">Phone</th>
          <th style="${TH};text-align:right">Amount</th><th style="${TH}">Gateway</th><th style="${TH}">Started</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${stuck.length > 25 ? `<p style="margin:8px 0 0;color:#7f1d1d;font-size:12px">…and ${stuck.length - 25} more.</p>` : ""}` : ""}
    </div>`;
}

function buildCsv(rows: FeeRow[]): string {
  const header = ["Receipt No", "Name", "Course", "Campus", "Payment Mode", "Amount", "Fee Type", "Cashier", "Paid At"];
  const lines = rows.map((r) => [
    r.receipt_no || "",
    r.person_name || "",
    r.course_name || "",
    r.campus_name || "",
    modeLabel(r.payment_mode),
    amt(r.amount),
    r.fee_type || "",
    r.cashier_name || "",
    r.paid_at,
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
  const authorizedByServiceRole = auth === `Bearer ${serviceRoleKey}`
    || await isServiceCaller(req, createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, { auth: { persistSession: false } }));

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
    ? { fromIso: String(body.from), toIso: String(body.to), label: String(body.label || "selected range") }
    : yesterdayIstBounds();

  const { data, error } = await supabase.rpc("get_daily_fee_collection", {
    p_from: bounds.fromIso,
    p_to: bounds.toIso,
  });

  if (error) {
    console.error("daily fee collection query failed", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (data || []) as FeeRow[];
  const total = rows.reduce((s, r) => s + amt(r.amount), 0);
  const stuckHtml = await buildStuckSection(supabase).catch((e) => {
    console.error("stuck-payment section failed", e);
    return "";
  });
  const html = stuckHtml + buildHtml(rows, bounds.label);
  const csv = buildCsv(rows);
  // Optional per-call recipient override (manual test / re-send); falls back to env then hardcoded list.
  const recipientsOverride = Array.isArray(body?.recipients)
    ? body.recipients.join(",")
    : (typeof body?.recipients === "string" ? body.recipients : null);
  const to = (recipientsOverride || Deno.env.get("FEE_REPORT_EMAIL_TO") || "siddhant@nimt.ac.in,chairman@nimt.ac.in,siddharth@nimt.ac.in")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const from = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
  const subject = (stuckHtml ? "⚠ " : "") + `Daily Fee Collection — ${bounds.label}`;

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
        filename: `fee-collection-${bounds.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
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
    console.error("daily fee collection email failed", emailResult);
    return new Response(JSON.stringify({ error: emailResult?.message || "Email send failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, receipts: rows.length, total, recipients: to.length, id: emailResult?.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

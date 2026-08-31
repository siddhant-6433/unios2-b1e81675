/**
 * One-shot backfill: WhatsApp the payment receipt to lead-less students who
 * already paid via a fee-notification link but never got it.
 *
 * Root cause (fixed 2026-08-31 in _shared/gateway-settlement.ts): notify-event —
 * the only sender of a receipt PDF on WhatsApp — is lead-anchored, so fee-notify
 * links (student_id, lead_id=null) settled and minted the PDF but the send was
 * skipped by the `if (leadId)` guard. New payments are fixed; this catches the
 * ones that already paid. Mirrors sendStudentReceipt(): generate the receipt,
 * then send `payment_receipt_pdf` (text `payment_receipt` fallback) to the number
 * the invite reached (payment_links.sent_to_phone) then the student phone cascade.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Usage:
 *   node scripts/backfill-fee-notify-receipts.mjs            # dry run (default)
 *   node scripts/backfill-fee-notify-receipts.mjs --commit   # generate + send
 *   node scripts/backfill-fee-notify-receipts.mjs --commit --all-links
 *                                                            # widen beyond fee-notify
 *
 * Idempotent across runs: sent link ids are logged to scripts/.out/backfill-fee-notify-sent.json
 * and skipped on re-run (a payment has no per-row "receipt_sent" flag).
 */

import fs from 'fs';
import path from 'path';

const COMMIT = process.argv.includes('--commit');
const ALL_LINKS = process.argv.includes('--all-links'); // include non-fee-notify student links
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice('--limit='.length)) || Infinity;
// whatsapp-send accepts either the exact edge service-role key OR x-cron-secret===CRON_SECRET.
// The _app_config service key has drifted from edge env (401s), so when CRON_SECRET is
// set we auth via x-cron-secret and reuse the already-minted receipt_url (skip generation).
const CRON_SECRET = process.env.CRON_SECRET || '';
const OUT_DIR = path.join(process.cwd(), 'scripts', '.out');
const SENT_LOG = path.join(OUT_DIR, 'backfill-fee-notify-sent.json');
const PAGE = 500; // stay under the 1000-row response cap

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const validPhone = (v) => (v && String(v).replace(/\D/g, '').length >= 10 ? String(v) : null);
const resolveReceiptPhone = (sentTo, s) =>
  validPhone(sentTo) ||
  validPhone(s?.phone) || validPhone(s?.whatsapp_no) ||
  validPhone(s?.father_phone) || validPhone(s?.father_whatsapp) ||
  validPhone(s?.mother_phone) || validPhone(s?.mother_whatsapp) ||
  validPhone(s?.guardian_phone);

const readSentLog = () => {
  try { return new Set(JSON.parse(fs.readFileSync(SENT_LOG, 'utf8'))); } catch { return new Set(); }
};
const writeSentLog = (set) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SENT_LOG, JSON.stringify([...set], null, 0));
};

const post = async (fn, body) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};

// PostgREST read — no @supabase/supabase-js dependency (Node 18+ global fetch).
const rest = async (pathAndQuery) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
};

async function main() {
  // Paid student links whose booked payment has NO lead → the guard skipped the send.
  // !inner + embedded filters push the lead_id-null / confirmed test to the parent rows.
  const select =
    'id,sent_to_phone,fee_campaign_id,' +
    'lead_payments!inner(id,lead_id,amount,status,receipt_no,receipt_url),' +
    'students!inner(name,phone,whatsapp_no,father_phone,father_whatsapp,mother_phone,mother_whatsapp,guardian_phone)';
  const filters =
    '&status=eq.paid&lead_payment_id=not.is.null' +
    '&lead_payments.lead_id=is.null&lead_payments.status=eq.confirmed' +
    (ALL_LINKS ? '' : '&fee_campaign_id=not.is.null');

  const targets = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await rest(
      `payment_links?select=${encodeURIComponent(select)}${filters}&order=id&offset=${from}&limit=${PAGE}`,
    );
    for (const link of rows) {
      const lp = link.lead_payments;
      if (!lp) continue;
      const phone = resolveReceiptPhone(link.sent_to_phone, link.students);
      targets.push({
        link_id: link.id,
        payment_id: lp.id,
        name: link.students?.name || 'Student',
        amount: lp.amount,
        phone,
        receipt_no: lp.receipt_no || '',
        receipt_url: lp.receipt_url || '',
      });
    }
    if (rows.length < PAGE) break;
  }

  const sentLog = readSentLog();
  const already = targets.filter((t) => sentLog.has(t.link_id));
  const noPhone = targets.filter((t) => !t.phone && !sentLog.has(t.link_id));
  const todo = targets.filter((t) => t.phone && !sentLog.has(t.link_id));

  console.log(`scope: ${ALL_LINKS ? 'all student links' : 'fee-notify only'}`);
  console.log(`lead-less paid payments: ${targets.length}`);
  console.log(`  already sent (skipped): ${already.length}`);
  console.log(`  no usable phone:        ${noPhone.length}`);
  console.log(`  to send:                ${todo.length}`);

  if (!COMMIT) {
    console.log('\nDRY RUN — re-run with --commit to send. Sample:');
    for (const t of todo.slice(0, 10)) console.log(`  ${t.name} → ${t.phone}  (₹${t.amount}, pay ${t.payment_id})`);
    if (noPhone.length) console.log(`\n${noPhone.length} have no phone on file — cannot be reached.`);
    return;
  }

  const batch = Number.isFinite(LIMIT) ? todo.slice(0, LIMIT) : todo;
  if (Number.isFinite(LIMIT)) console.log(`--limit=${LIMIT} → sending to ${batch.length} of ${todo.length}`);

  const waHeaders = CRON_SECRET
    ? { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
  const waSend = async (body) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
      method: 'POST', headers: waHeaders, body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  };

  let sent = 0, failed = 0;
  for (const t of batch) {
    try {
      let receiptUrl = t.receipt_url;
      let receiptNo = t.receipt_no;
      // Without a cron secret we can also (re)mint via the service-key path; with the
      // cron path we reuse the receipt_url already stamped at settlement time.
      if (!receiptUrl && !CRON_SECRET) {
        const gen = await post('generate-payment-receipt', { payment_id: t.payment_id });
        if (gen.ok) { receiptUrl = gen.json?.receipt_url || ''; receiptNo = gen.json?.receipt_no || receiptNo; }
      }
      const amount = String(t.amount);

      const wa = (template_key, params, options) =>
        waSend({ template_key, phone: t.phone, params, ...(options || {}) });

      let res = receiptUrl
        ? await wa('payment_receipt_pdf', [t.name, 'Other Charges', amount, receiptNo], {
            header_document_url: receiptUrl,
            header_document_filename: `Receipt-${receiptNo || t.payment_id}.pdf`,
          })
        : { ok: false };
      if (!res.ok) res = await wa('payment_receipt', [t.name, 'Other Charges', amount, receiptNo, receiptUrl]);

      if (res.ok) {
        sent++; sentLog.add(t.link_id); writeSentLog(sentLog);
        console.log(`✓ ${t.name} → ${t.phone}`);
      } else {
        failed++;
        console.error(`✗ ${t.name} → ${t.phone}: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
      }
    } catch (e) {
      failed++;
      console.error(`✗ ${t.name} → ${t.phone}:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 250)); // gentle pace
  }
  console.log(`\nDone. sent=${sent} failed=${failed} (log: ${SENT_LOG})`);
}

main().catch((e) => { console.error(e); process.exit(1); });

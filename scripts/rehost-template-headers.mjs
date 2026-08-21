// One-off: re-host the approved sample header image of each course-detail
// WhatsApp template into the public `whatsapp-media` bucket, so it becomes a
// Meta-fetchable send link. Meta's own header_handle (scontent.whatsapp.net)
// is NOT usable as a send link (131053), so we mirror it to our public bucket
// and register the URL in whatsapp_template_settings.media_url (done by the
// accompanying migration). Prints a template_key -> public_url map to paste.
//
// Run: node scripts/rehost-template-headers.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://deylhigsisuexszsmypq.supabase.co';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc3ODQwOCwiZXhwIjoyMDg4MzU0NDA4fQ.wjV_8veUrjdJO__Uv1and4Ij5LiB5My9DEWrhyM9Jr8';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
});

const NAMES = [
  'alumni_post', 'gnm_course_details', 'dpharma_course_details', 'bca_course_details',
  'bba_course_details', 'pgdm_course_details', 'd_el_ed_course_details', 'bed_course_details',
  'llb_course_details', 'ballb_course_details', 'mba_course_details', 'b_sc__nursing_course_details',
  'mpt_course_details', 'd_aott_course_details', 'bmrit_course_details', 'mmrit_course_details',
  'bpt_course_details__nimt',
];

const BUCKET = 'whatsapp-media';
const PREFIX = 'template-headers';

function headerHandle(components) {
  const header = (components || []).find((c) => c?.type === 'HEADER');
  return header?.example?.header_handle?.[0] || null;
}

// Meta sample handles are PNG; keep .png. Detect from content-type as a guard.
function extFor(contentType) {
  if (!contentType) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}

const { data: rows, error } = await supabase
  .from('whatsapp_templates')
  .select('name, components')
  .in('name', NAMES)
  .eq('status', 'APPROVED');
if (error) { console.error('DB read failed:', error.message); process.exit(1); }

const byName = new Map(rows.map((r) => [r.name, r]));
const result = {};
let ok = 0, fail = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// scontent.whatsapp.net throttles rapid sequential fetches (generic "fetch
// failed"), so space requests out and retry with backoff.
async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(1500 * (i + 1));
  }
  throw lastErr;
}

for (const name of NAMES) {
  const row = byName.get(name);
  const handle = row && headerHandle(row.components);
  if (!handle) { console.error(`✗ ${name}: no header_handle in components`); fail++; continue; }

  try {
    const res = await fetchWithRetry(handle);
    const contentType = res.headers.get('content-type') || 'image/png';
    const buf = new Uint8Array(await res.arrayBuffer());
    const path = `${PREFIX}/${name}.${extFor(contentType)}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, { contentType, upsert: true });
    if (upErr) { console.error(`✗ ${name}: upload ${upErr.message}`); fail++; continue; }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    result[name] = pub.publicUrl;
    console.log(`✓ ${name} -> ${pub.publicUrl} (${buf.length} bytes)`);
    ok++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    fail++;
  }
  await sleep(800); // space out to avoid CDN throttling
}

console.log(`\nDone: ${ok} ok, ${fail} failed.\n`);
console.log('--- JSON (template_key -> media_url) ---');
console.log(JSON.stringify(result, null, 2));

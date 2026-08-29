/**
 * Import society / contact spreadsheets as tagged lead lists.
 *
 * Reads every .xls/.xlsx under DATA_DIR, extracts name + phone (+ email) from
 * wildly-varying layouts, tags each list with a city (from folder + society
 * name — NOT resident addresses, which are pan-India and misleading), then:
 *   --dry-run (default): writes scripts/.out/import-manifest.csv + per-list JSON
 *                        for you to review city tags before committing.
 *   --commit           : creates a lead_lists row per file and upserts contacts
 *                        via the import_leads_bulk RPC (skip_ai_call=true, no AI).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (only needed for --commit)
 * Optional: scripts/import-city-overrides.csv  ("listName,city" — your review edits)
 *
 * Usage:
 *   node scripts/import-society-lists.mjs                 # dry run
 *   node scripts/import-society-lists.mjs --commit        # write to DB
 *   node scripts/import-society-lists.mjs --commit --force  # append to existing lists
 *   DATA_DIR=/path node scripts/import-society-lists.mjs  # override data dir
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const DATA_DIR = process.env.DATA_DIR || '/Users/siddhantsingh/conductor/repos/Data';
const OUT_DIR = path.join(process.cwd(), 'scripts', '.out');
const LISTS_DIR = path.join(OUT_DIR, 'lists');
const OVERRIDES = path.join(process.cwd(), 'scripts', 'import-city-overrides.csv');

const COMMIT = process.argv.includes('--commit');
const FORCE = process.argv.includes('--force');
const BATCH = 500;
// Files above MAX_MB are skipped by default (SheetJS parses them very slowly,
// blocking the batch). Run one large file alone with --only=<name substring>.
const MAX_MB = Number(process.env.MAX_MB || 50);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
// Comma-separated case-insensitive substrings; any list whose name matches is skipped.
const EXCLUDE = (process.argv.find((a) => a.startsWith('--exclude=')) || '').slice('--exclude='.length)
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ── column alias sets (mirrors BulkLeadImportDialog.tsx) ────────────────
const ALIASES = {
  name: ['name', 'full name', 'fullname', 'customer name', 'applicant name', 'owner name', 'resident name', 'primary applicant name', 'contact person', 'director'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile no', 'contact', 'contact no', 'contact number', 'whatsapp', 'whatsapp number', 'cell', 'applicant mobile', 'tel'],
  email: ['email', 'email address', 'e-mail', 'e mail', 'mail', 'applicant email'],
};
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
const matchAlias = (header, set) => {
  const h = norm(header);
  return set.some((a) => h === a || h.includes(a));
};

// ── city resolution: filename/folder keyword → city ─────────────────────
// Order matters (most specific first). Property location, not resident address.
const CITY_RULES = [
  [/faridabad/i, 'Faridabad'],
  [/ghaziabad|indirapuram|vaishali|kaushambi/i, 'Ghaziabad'],
  [/dera ?bassi|derabassi|zirakpur|mohali|chandigarh/i, 'Chandigarh'],
  [/greater noida|gr(\.| )?noida/i, 'Greater Noida'],
  // Noida societies (also caught by the /Noida/ folder fallback below)
  [/noida|godrej nest|lotus|prateek|jaypee|supertech|kosmos|klassic|kalypso|exotica|stellar|paras|amrapali|mahagun|gulshan|ace |ats /i, 'Noida'],
  // Gurgaon developers / landmark societies
  [/dlf|m3m|emaar|vatika|bptp|ireo|central park|palm|sobha|magnolia|suncity|pyramid|araya|skyon|malibu|uptown|carlton|princeton|belaire|belair|luminare|mahindra|digihomes|golf estate|world spa|raheja|tata (raisina|primanti)|amstoria|chintal|presidia|astaire|woodstock|oris|carnation|garden city|hines|elevate|verandas|success tower|huda|mcg|gurgaon|gurugram|manesar|sohna/i, 'Gurgaon'],
];
const NATIONAL = /pan[- ]?india|industries|company data|proprietor|online seller|semi government|mnc|doctor|director|policy ?bazaar|nri|delhi director|company/i;

function resolveCity(filePath, listName) {
  const hay = `${filePath} ${listName}`;
  if (NATIONAL.test(hay)) return { city: '', needsReview: false, national: true };
  for (const [re, city] of CITY_RULES) if (re.test(hay)) return { city, needsReview: false };
  // folder fallback (low confidence)
  const lower = filePath.toLowerCase();
  if (/\/noida\//.test(lower)) return { city: 'Noida', needsReview: true, lowConfidence: true };
  if (/\/(download|data)\//.test(lower) || path.dirname(filePath) === DATA_DIR)
    return { city: 'Gurgaon', needsReview: true, lowConfidence: true };
  return { city: '', needsReview: true };
}

// ── richer metadata tags attached to each list in Uni ───────────────────
// Builder/developer → canonical tag. Lets Marketing target e.g. all "DLF".
const DEVELOPERS = [
  [/\bdlf\b/i, 'DLF'], [/\bm3m\b/i, 'M3M'], [/emaar/i, 'Emaar'], [/godr[ae]j/i, 'Godrej'],
  [/vatika/i, 'Vatika'], [/\bbptp\b/i, 'BPTP'], [/\bireo\b/i, 'Ireo'], [/sobha/i, 'Sobha'],
  [/\btata\b/i, 'Tata'], [/mahindra/i, 'Mahindra'], [/omaxe/i, 'Omaxe'], [/supertech/i, 'Supertech'],
  [/jaypee/i, 'Jaypee'], [/prateek/i, 'Prateek'], [/paras/i, 'Paras'], [/ansal/i, 'Ansal'],
  [/unitech/i, 'Unitech'], [/raheja/i, 'Raheja'], [/pyramid/i, 'Pyramid'], [/central park/i, 'Central Park'],
  [/suncity/i, 'Suncity'], [/signature ?global/i, 'Signature Global'], [/\bats\b/i, 'ATS'],
  [/mahagun/i, 'Mahagun'], [/gulshan/i, 'Gulshan'], [/amrapali/i, 'Amrapali'], [/eldeco/i, 'Eldeco'],
  [/conscient/i, 'Conscient'], [/experion/i, 'Experion'], [/adani/i, 'Adani'], [/hines/i, 'Hines'],
];
const NCR_CITIES = new Set(['Gurgaon', 'Noida', 'Greater Noida', 'Faridabad', 'Ghaziabad', 'Delhi']);

function buildTags(filePath, listName, city, national) {
  // Match content tags on the list NAME only — the Android folder path contains
  // "WhatsApp Business", which would otherwise tag everything 'business'.
  const hay = ` ${listName} `;
  const tags = [];
  if (city) tags.push(city);
  if (NCR_CITIES.has(city)) tags.push('NCR');

  // segment / property type
  if (national) tags.push('directory');
  else {
    tags.push('residential');
    if (/office|business park|corporate|\bsez\b|commercial|\bplaza\b|city ?cent(er|re)|world spa/i.test(hay)) tags.push('commercial');
    if (/\bplot/i.test(hay)) tags.push('plots');
    if (/\bfloor/i.test(hay)) tags.push('builder-floors');
    if (/villa|independent (house|floor)/i.test(hay)) tags.push('villas');
    if (/rental|rent\b|tenant/i.test(hay)) tags.push('rentals');
    if (/luxury|magnolia|aral[ia]as|camellias|the crest|golf (course|estate|link)|ultima|pinnacle|verandas/i.test(hay)) tags.push('luxury');
  }

  // audience
  if (/doctor|mbbs|\baims\b/i.test(hay)) tags.push('doctors');
  if (/investor|sharekhan|demat|trading/i.test(hay)) tags.push('investors');
  if (/proprietor|online seller|shopping|\bmnc\b|industr|company|director|business/i.test(hay)) tags.push('business');
  if (/\bnri\b/i.test(hay)) tags.push('nri');
  if (/policy ?bazaar|insurance/i.test(hay)) tags.push('insurance-leads');
  if (/semi government|govt|government/i.test(hay)) tags.push('govt');

  // developer / builder
  for (const [re, name] of DEVELOPERS) if (re.test(hay)) { tags.push(name); break; }

  // provenance + year
  if (/\/android\//i.test(filePath)) tags.push('whatsapp-import');
  const yr = listName.match(/\b(20\d{2})\b/);
  if (yr) tags.push(yr[1]);

  // dedupe, keep order, cap
  return [...new Set(tags.filter(Boolean))].slice(0, 8);
}

// ── phone extraction / normalization ────────────────────────────────────
const PHONE_ANY = /\b([6-9]\d{9})\b/;
const PHONE_LABELLED = /(?:mobile|phone|contact|cell|whatsapp)\D{0,6}(\d{10})/i;
function normPhone(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    if (/^[6-9]/.test(last10)) return '+91' + last10;
  }
  return null;
}
function phoneFromCells(cells) {
  for (const c of cells) {
    const p = normPhone(c);
    if (p) return p;
  }
  const joined = cells.map((c) => String(c ?? '')).join(' ');
  const m = joined.match(PHONE_LABELLED) || joined.match(PHONE_ANY);
  return m ? '+91' + m[1] : null;
}

// ── header-row detection ────────────────────────────────────────────────
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i] || [];
    let hits = 0;
    let map = { name: -1, phone: -1, email: -1 };
    cells.forEach((cell, ci) => {
      if (map.name < 0 && matchAlias(cell, ALIASES.name)) { map.name = ci; hits++; }
      else if (map.phone < 0 && matchAlias(cell, ALIASES.phone)) { map.phone = ci; hits++; }
      else if (map.email < 0 && matchAlias(cell, ALIASES.email)) { map.email = ci; hits++; }
    });
    if (hits >= 2 || (map.name >= 0 && map.phone >= 0)) return { idx: i, map };
  }
  return null;
}

// ── extract one file → { rows:[{name,phone,email}], stats } ─────────────
function extractFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', dense: true, raw: true, cellFormula: false, cellHTML: false, cellStyles: false });
  const out = new Map(); // phone -> {name,phone,email}
  let totalRows = 0;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, blankrows: false, raw: true });
    if (!rows.length) continue;
    const hdr = findHeader(rows);
    const start = hdr ? hdr.idx + 1 : 0;
    const map = hdr ? hdr.map : { name: -1, phone: -1, email: -1 };
    for (let i = start; i < rows.length; i++) {
      const cells = rows[i] || [];
      if (!cells.some((c) => c != null && String(c).trim() !== '')) continue;
      totalRows++;
      const phone =
        (map.phone >= 0 ? normPhone(cells[map.phone]) : null) || phoneFromCells(cells);
      if (!phone) continue;
      const name = map.name >= 0 ? String(cells[map.name] ?? '').trim() : '';
      const email = map.email >= 0 ? String(cells[map.email] ?? '').trim() : '';
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
      if (!out.has(phone)) out.set(phone, { name, phone, email: emailOk });
      else {
        const e = out.get(phone); // fill blanks from later rows
        if (!e.name && name) e.name = name;
        if (!e.email && emailOk) e.email = emailOk;
      }
    }
  }
  return { rows: [...out.values()], totalRows };
}

// ── file walk ───────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.(xlsx?|XLSX?)$/.test(entry.name) && !entry.name.startsWith('~$')) acc.push(p);
  }
  return acc;
}

const cleanListName = (filePath) =>
  path.basename(filePath).replace(/\.(xlsx?|XLSX?)$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES)) return {};
  const map = {};
  for (const line of fs.readFileSync(OVERRIDES, 'utf8').split(/\r?\n/).slice(1)) {
    const [name, city] = line.split(',');
    if (name && city != null) map[name.trim()] = city.trim();
  }
  return map;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(LISTS_DIR, { recursive: true });
  const overrides = loadOverrides();
  const files = walk(DATA_DIR);
  console.log(`Found ${files.length} spreadsheet(s) under ${DATA_DIR}`);

  const manifest = [];
  const lists = [];
  for (const filePath of files) {
    const listName = cleanListName(filePath);
    if (ONLY && !filePath.toLowerCase().includes(ONLY.toLowerCase())) continue;
    if (EXCLUDE.some((x) => listName.toLowerCase().includes(x))) { console.log(`exclude: ${listName}`); continue; }
    const sizeMb = fs.statSync(filePath).size / 1048576;
    if (!ONLY && sizeMb > MAX_MB) {
      console.log(`skip (large ${sizeMb.toFixed(0)}MB, run with --only): ${listName}`);
      manifest.push({ file: filePath, folder: path.dirname(filePath).replace(DATA_DIR, '') || '/', listName, city: '', tags: '', totalRows: 0, validPhones: 0, needsReview: true, error: `large ${sizeMb.toFixed(0)}MB — run --only` });
      continue;
    }
    let res;
    try {
      res = extractFile(filePath);
    } catch (e) {
      manifest.push({ file: filePath, folder: path.dirname(filePath).replace(DATA_DIR, '') || '/', listName, city: '', tags: '', totalRows: 0, validPhones: 0, needsReview: true, error: String(e.message || e).slice(0, 60) });
      continue;
    }
    const cityInfo = resolveCity(filePath, listName);
    const city = overrides[listName] ?? cityInfo.city;
    const tags = buildTags(filePath, listName, city, cityInfo.national);
    const rows = res.rows.map((r) => ({ ...r, city }));
    lists.push({ filePath, listName, city, tags, rows });
    manifest.push({
      file: filePath,
      folder: path.dirname(filePath).replace(DATA_DIR, '') || '/',
      listName,
      city,
      tags: tags.join('|'),
      totalRows: res.totalRows,
      validPhones: rows.length,
      needsReview: overrides[listName] ? false : !!cityInfo.needsReview,
    });
    if (!COMMIT) fs.writeFileSync(path.join(LISTS_DIR, `${listName.replace(/[/\\]/g, '_')}.json`), JSON.stringify({ listName, city, tags, rows }, null, 2));
  }

  // manifest CSV
  const cols = ['file', 'folder', 'listName', 'city', 'tags', 'totalRows', 'validPhones', 'needsReview', 'error'];
  const csv = [cols.join(','), ...manifest.map((m) => cols.map((c) => csvCell(m[c])).join(','))].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'import-manifest.csv'), csv);

  const totalContacts = lists.reduce((n, l) => n + l.rows.length, 0);
  const review = manifest.filter((m) => m.needsReview).length;
  console.log(`Manifest: ${path.join(OUT_DIR, 'import-manifest.csv')}`);
  console.log(`Lists: ${lists.length} | contacts (valid phones): ${totalContacts} | need review: ${review}`);

  if (!COMMIT) {
    console.log('\nDry run complete. Review import-manifest.csv (city/needsReview), optionally edit');
    console.log('scripts/import-city-overrides.csv (listName,city), then re-run with --commit.');
    return;
  }

  // ── commit ────────────────────────────────────────────────────────────
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to commit.');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });

  // Send one chunk; on timeout/error, recurse by splitting in half so a slow
  // batch still lands. Returns rows successfully sent. Idempotent (ON CONFLICT).
  async function sendChunk(listId, chunk, listName, offset) {
    if (!chunk.length) return 0;
    const { error } = await supabase.rpc('import_leads_bulk', { _list_id: listId, _rows: chunk, _source: 'other' });
    if (!error) return chunk.length;
    if (chunk.length <= 50) { console.error(`\n  batch failed (${listName} @${offset}, n=${chunk.length}): ${error.message}`); return 0; }
    const mid = Math.floor(chunk.length / 2);
    return (await sendChunk(listId, chunk.slice(0, mid), listName, offset)) +
           (await sendChunk(listId, chunk.slice(mid), listName, offset + mid));
  }

  let created = 0, reused = 0, empty = 0, contacts = 0, failed = 0;
  for (const l of lists) {
    if (!l.rows.length) { empty++; continue; }
    // get-or-create by name → re-runs fill gaps instead of duplicating.
    const { data: existing } = await supabase.from('lead_lists').select('id').eq('name', l.listName).maybeSingle();
    let listId;
    if (existing) {
      listId = existing.id; reused++;
      await supabase.from('lead_lists').update({ tags: l.tags }).eq('id', listId);
    } else {
      const { data: listRow, error: listErr } = await supabase
        .from('lead_lists')
        .insert({ name: l.listName, source: 'import', description: `Imported from ${path.basename(l.filePath)}`, tags: l.tags })
        .select('id')
        .single();
      if (listErr) { console.error(`list insert failed ${l.listName}:`, listErr.message); failed++; continue; }
      listId = listRow.id; created++;
    }
    for (let i = 0; i < l.rows.length; i += BATCH) {
      const chunk = l.rows.slice(i, i + BATCH);
      const ok = await sendChunk(listId, chunk, l.listName, i);
      contacts += ok; failed += chunk.length - ok;
      process.stdout.write(`\r  ${l.listName}: ${Math.min(i + BATCH, l.rows.length)}/${l.rows.length}   `);
    }
    console.log(`\r✓ ${l.listName} (${l.city || 'no city'}) — ${l.rows.length} contacts        `);
  }
  console.log(`\nDone. Lists created: ${created} | reused: ${reused} | empty(skipped): ${empty} | contacts sent: ${contacts} | failed rows: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

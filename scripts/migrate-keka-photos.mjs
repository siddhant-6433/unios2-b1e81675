// One-shot migration: pull employee photos out of Keka into UniOs storage.
//
// Keka's CSV exports carry no photo column and its API is a paid add-on, so the only
// route is the file endpoint its own UI uses. Those URLs turn out to be public — no
// session needed — but they are on Keka's CDN, which is exactly what we are leaving,
// so the bytes are copied into our own bucket rather than hot-linked.
//
// Matching is by WORK EMAIL, never by name: NIMT has "Gayatree ." and
// "Dr. Aishwary Gayatree" as different people, and Umed/Umesh Gupta at two entities.
// Putting the wrong face on a payslip is worse than having no face.
//
// Auth uses a short-lived user JWT, not the service key, so the upload goes through
// the same hr:employees_edit storage policy a human would.
//
// Usage: node scripts/migrate-keka-photos.mjs <map-file> <token-file> [--dry-run]

import { readFileSync } from "node:fs";

const [, , mapFile, tokenFile, ...flags] = process.argv;
const DRY = flags.includes("--dry-run");

const SUPABASE_URL = "https://deylhigsisuexszsmypq.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3Nzg0MDgsImV4cCI6MjA4ODM1NDQwOH0.z8YWiwxkdIU-9zQhXu0z1BGFKu-GAUDcLrdNMnFxYEY";
const KEKA_TENANT = "5892f24a-df65-4a38-afa8-f9c97b1410ed";
const BUCKET = "employee-photos";

const token = readFileSync(tokenFile, "utf8").trim();
const rows = readFileSync(mapFile, "utf8").trim().split("\n")
  .map((l) => { const [email, file] = l.split("|"); return { email: email.trim().toLowerCase(), file: file.trim() }; })
  .filter((r) => r.email && r.file);

const H = { apikey: ANON, Authorization: `Bearer ${token}` };

// Resolve email -> employee_profiles.id in one round trip.
const idsRes = await fetch(
  `${SUPABASE_URL}/rest/v1/employee_profiles?select=id,work_email,display_name,photo_url&work_email=not.is.null`,
  { headers: H },
);
if (!idsRes.ok) throw new Error(`employee lookup failed: ${idsRes.status} ${await idsRes.text()}`);
const employees = await idsRes.json();
const byEmail = new Map(employees.filter((e) => e.work_email).map((e) => [e.work_email.toLowerCase(), e]));

let uploaded = 0, skipped = 0, failed = 0;
const problems = [];

for (const { email, file } of rows) {
  const emp = byEmail.get(email);
  if (!emp) { skipped++; problems.push(`no employee for ${email}`); continue; }

  // 400x400 is the largest size Keka serves; original/no-size 404s.
  const src = `https://nimt.keka.com/files/${KEKA_TENANT}/400x400/profileimage/${file}`;
  const img = await fetch(src);
  if (!img.ok) { failed++; problems.push(`${email}: keka ${img.status}`); continue; }
  const bytes = Buffer.from(await img.arrayBuffer());
  if (bytes.length < 500) { failed++; problems.push(`${email}: suspiciously small (${bytes.length}b)`); continue; }

  if (DRY) { uploaded++; continue; }

  // Stable path so a re-run overwrites rather than accumulating orphans.
  const path = `${emp.id}/photo.jpg`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...H, "Content-Type": img.headers.get("content-type") || "image/jpeg", "x-upsert": "true" },
    body: bytes,
  });
  if (!up.ok) { failed++; problems.push(`${email}: upload ${up.status} ${(await up.text()).slice(0, 120)}`); continue; }

  // Cache-bust: the path never changes, so browsers would keep the old face.
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}?v=${Date.now()}`;
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/employee_profiles?id=eq.${emp.id}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ photo_url: url }),
  });
  if (!patch.ok) { failed++; problems.push(`${email}: patch ${patch.status}`); continue; }

  uploaded++;
  if (uploaded % 10 === 0) console.log(`  ${uploaded}/${rows.length}…`);
}

console.log(JSON.stringify({ mode: DRY ? "dry-run" : "live", total: rows.length, uploaded, skipped, failed }, null, 1));
if (problems.length) console.log("problems:\n  " + problems.join("\n  "));

// Run the passport-photo background remover over employee photos.
//
// Uses the same process-passport-photo edge function student and applicant photos go
// through, so employee photos end up with the identical plain-white treatment.
//
// Two safeguards, because this REPLACES a photo with an AI-regenerated one:
//   1. The original is copied to {id}/original.jpg first. Gemini is instructed not to
//      alter identity, but "instructed not to" is not a guarantee, and overwriting the
//      only copy of 85 people's faces would be unrecoverable.
//   2. Any failure — non-200, no image part, suspiciously small output — leaves the
//      existing photo untouched rather than writing something worse.
//
// Output is downscaled to 400px before upload: Gemini returns 1024x1024 PNGs at ~1.7MB,
// which would be 144MB for 85 people to render avatars at 40px.
//
// Usage: node scripts/bg-remove-employee-photos.mjs <token-file> [--limit N] [--dry-run]

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [, , tokenFile, ...flags] = process.argv;
const DRY = flags.includes("--dry-run");
const limitIdx = flags.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(flags[limitIdx + 1]) : Infinity;

const SUPABASE_URL = "https://deylhigsisuexszsmypq.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3Nzg0MDgsImV4cCI6MjA4ODM1NDQwOH0.z8YWiwxkdIU-9zQhXu0z1BGFKu-GAUDcLrdNMnFxYEY";
const BUCKET = "employee-photos";

const token = readFileSync(tokenFile, "utf8").trim();
const H = { apikey: ANON, Authorization: `Bearer ${token}` };

const listRes = await fetch(
  `${SUPABASE_URL}/rest/v1/employee_profiles?select=id,display_name,photo_url&photo_url=not.is.null&order=display_name`,
  { headers: H },
);
if (!listRes.ok) throw new Error(`list failed: ${listRes.status} ${await listRes.text()}`);
const employees = (await listRes.json()).slice(0, LIMIT);

console.log(`${employees.length} photos to process`);

let done = 0, failed = 0, skipped = 0;
const problems = [];

for (const emp of employees) {
  const label = emp.display_name || emp.id;
  try {
    const cur = await fetch(emp.photo_url);
    if (!cur.ok) { skipped++; problems.push(`${label}: current photo ${cur.status}`); continue; }
    const original = Buffer.from(await cur.arrayBuffer());
    const mime = cur.headers.get("content-type") || "image/jpeg";

    if (DRY) { done++; continue; }

    // Preserve the original before anything can overwrite it.
    const backup = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${emp.id}/original.jpg`, {
      method: "POST",
      headers: { ...H, "Content-Type": mime, "x-upsert": "true" },
      body: original,
    });
    if (!backup.ok) { failed++; problems.push(`${label}: backup ${backup.status}`); continue; }

    const fn = await fetch(`${SUPABASE_URL}/functions/v1/process-passport-photo`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ image: `data:${mime};base64,${original.toString("base64")}` }),
    });
    const body = await fn.json().catch(() => ({}));
    if (!fn.ok || !body.processedImage) {
      failed++;
      problems.push(`${label}: ${body.error ? String(body.error).slice(0, 90) : `http ${fn.status}`}`);
      continue;
    }

    const processed = Buffer.from(body.processedImage.split(",")[1], "base64");
    // A near-empty return means the model gave back something useless; keep the original.
    if (processed.length < 2000) { failed++; problems.push(`${label}: output only ${processed.length}b`); continue; }

    // sips is built into macOS — no image dependency needed for a one-shot script.
    const tmpIn = `/tmp/bgr-${emp.id}.png`;
    const tmpOut = `/tmp/bgr-${emp.id}.jpg`;
    writeFileSync(tmpIn, processed);
    execFileSync("sips", ["-Z", "400", "-s", "format", "jpeg", "-s", "formatOptions", "82", tmpIn, "--out", tmpOut], { stdio: "ignore" });
    const small = readFileSync(tmpOut);
    unlinkSync(tmpIn); unlinkSync(tmpOut);

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${emp.id}/photo.jpg`, {
      method: "POST",
      headers: { ...H, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: small,
    });
    if (!up.ok) { failed++; problems.push(`${label}: upload ${up.status}`); continue; }

    // The path is stable, so without a new cache-buster browsers keep the old face.
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${emp.id}/photo.jpg?v=${Date.now()}`;
    await fetch(`${SUPABASE_URL}/rest/v1/employee_profiles?id=eq.${emp.id}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ photo_url: url }),
    });

    done++;
    if (done % 5 === 0) console.log(`  ${done}/${employees.length}…`);
  } catch (e) {
    failed++;
    problems.push(`${label}: ${String(e).slice(0, 90)}`);
  }
}

console.log(JSON.stringify({ mode: DRY ? "dry-run" : "live", total: employees.length, done, failed, skipped }, null, 1));
if (problems.length) console.log("problems:\n  " + problems.join("\n  "));

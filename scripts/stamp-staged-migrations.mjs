#!/usr/bin/env node
// Pre-commit stamper: forces a REAL, unique UTC timestamp onto every
// newly-added supabase migration file.
//
// Why this exists: migration files were being created by hand / by AI agents
// with an invented "date + round hour" convention (…100000, …120000, and even
// impossible times like …240000). Those stamps are deterministic, so parallel
// Conductor worktrees branched off the same main produced IDENTICAL timestamps
// and collided on merge. This hook removes the guesswork — whatever a new
// migration is named, its 14-digit prefix is rewritten to the actual commit
// time (monotonic + collision-free against every existing migration).
//
// Only ADDED files under supabase/migrations are touched; edits to existing
// migrations keep their version. Run `node scripts/stamp-staged-migrations.mjs
// --selftest` to exercise the timestamp logic.
import { readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");

const pad = (n, s = 2) => String(n).padStart(s, "0");

function utcStamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

// Add one second to a 14-digit stamp via real date math so it never rolls into
// an impossible time (…235960). Used to guarantee strict monotonicity.
function bump(stamp) {
  const d = new Date(Date.UTC(
    +stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
    +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14) + 1,
  ));
  return utcStamp(d);
}

// Assign real, strictly-increasing, collision-free stamps to files (sorted by
// their current name so relative order is preserved). Pure — testable.
export function assignStamps(files, now, existingVersions) {
  const existing = new Set(existingVersions);
  const out = [];
  let candidate = utcStamp(now);
  let last = "00000000000000";
  for (const f of [...files].sort()) {
    let v = candidate > last ? candidate : bump(last);
    while (existing.has(v)) v = bump(v);
    existing.add(v);
    last = v;
    candidate = bump(v);
    const name = basename(f).replace(/^\d{14}_/, `${v}_`);
    out.push({ from: f, to: join(dirname(f), name), version: v });
  }
  return out;
}

function selftest() {
  const now = new Date(Date.UTC(2026, 6, 27, 15, 30, 42));
  // Two files both invented as noon; existing already has the real 15:30:42.
  const plan = assignStamps(
    ["supabase/migrations/20260727120000_a.sql", "supabase/migrations/20260727120000_b.sql"],
    now,
    ["20260727153042"],
  );
  const [a, b] = plan;
  console.assert(a.version === "20260727153043", `a=${a.version}`);   // skipped the taken 153042
  console.assert(b.version === "20260727153044", `b=${b.version}`);   // strictly after a
  console.assert(a.to.endsWith("20260727153043_a.sql"), a.to);
  console.assert(b.version > a.version, "monotonic");
  console.log("selftest ok");
}

if (process.argv.includes("--selftest")) {
  selftest();
  process.exit(0);
}

function git(args) {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || `git ${args.join(" ")} failed\n`);
    process.exit(1);
  }
  return r.stdout;
}

const staged = git(["diff", "--cached", "--name-only", "--diff-filter=A", "--", "supabase/migrations"])
  .split("\n")
  .filter((f) => /^supabase\/migrations\/\d{14}_.*\.sql$/.test(f));

if (staged.length === 0) process.exit(0);

const existing = readdirSync(migrationsDir)
  .map((f) => f.match(/^(\d{14})_/)?.[1])
  .filter(Boolean);

const plan = assignStamps(staged, new Date(), existing);

let renamed = 0;
for (const { from, to, version } of plan) {
  if (from === to) continue;
  git(["mv", from, to]);
  console.log(`migration timestamp → real UTC: ${basename(from)} → ${version}_…`);
  renamed++;
}
if (renamed > 0) {
  console.log(`Stamped ${renamed} migration(s) with the actual commit time.`);
}

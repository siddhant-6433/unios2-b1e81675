#!/usr/bin/env node
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const nameParts = args.filter((arg) => arg !== "--dry-run");

function usage() {
  console.error("Usage: npm run db:migration:new -- <name> [--dry-run]");
  console.error("Example: npm run db:migration:new -- add_student_status_index");
}

function slugify(parts) {
  const slug = parts
    .join("_")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!slug) {
    console.error("Migration name must contain at least one letter or number.");
    process.exit(2);
  }

  return slug;
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function utcTimestamp(date) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function dateFromTimestamp(version) {
  const year = Number(version.slice(0, 4));
  const month = Number(version.slice(4, 6));
  const day = Number(version.slice(6, 8));
  const hour = Number(version.slice(8, 10));
  const minute = Number(version.slice(10, 12));
  const second = Number(version.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date;
}

function nextAfter(version) {
  const date = dateFromTimestamp(version);
  if (!date) return pad(BigInt(version) + 1n, 14);
  return utcTimestamp(new Date(date.getTime() + 1000));
}

if (nameParts.length === 0) {
  usage();
  process.exit(2);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");
const slug = slugify(nameParts);

await mkdir(migrationsDir, { recursive: true });

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql"));
const versions = files
  .map((file) => file.match(/^(\d{14})_/)?.[1])
  .filter(Boolean)
  .sort();
const existing = new Set(versions);

let version = utcTimestamp(new Date());
const maxExisting = versions.at(-1);
if (maxExisting && maxExisting >= version) {
  version = nextAfter(maxExisting);
}
while (existing.has(version)) {
  version = nextAfter(version);
}

const filename = `${version}_${slug}.sql`;
const path = join(migrationsDir, filename);

if (dryRun) {
  console.log(`Would create supabase/migrations/${filename}`);
  process.exit(0);
}

await writeFile(path, `-- ${slug.replace(/_/g, " ")}\n\n`, { flag: "wx" });
console.log(`Created supabase/migrations/${filename}`);

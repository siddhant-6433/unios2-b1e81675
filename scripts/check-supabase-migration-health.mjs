#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const modeArg = [...args].find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.slice("--mode=".length) : "validate";
const validModes = new Set(["validate", "clean", "apply"]);

if (!validModes.has(mode)) {
  console.error(`Unknown mode "${mode}". Use --mode=validate, --mode=clean, or --mode=apply.`);
  process.exit(2);
}

const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const requiredCiEnv = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD"];
const missingCiEnv = requiredCiEnv.filter((key) => !process.env[key]);

if (isCi && missingCiEnv.length > 0) {
  console.error(`Missing required Supabase CI secrets: ${missingCiEnv.join(", ")}`);
  console.error("Migration health checks must fail closed in CI so database drift cannot be ignored.");
  process.exit(2);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });

  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(127);
  }

  return result;
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function checkUniqueMigrationVersions() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const migrationsDir = join(repoRoot, "supabase", "migrations");
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const byVersion = new Map();

  for (const file of files) {
    const match = file.match(/^(\d{14})_/);
    if (!match) continue;
    const version = match[1];
    const rows = byVersion.get(version) || [];
    rows.push(file);
    byVersion.set(version, rows);
  }

  const duplicates = [...byVersion.entries()].filter(([, rows]) => rows.length > 1);
  if (duplicates.length === 0) return;

  console.error("Duplicate Supabase migration version prefixes found.");
  console.error("Supabase records only the numeric timestamp as the migration version, so duplicates can be skipped or fail recording after their SQL runs.");
  for (const [version, rows] of duplicates) {
    console.error(`- ${version}:`);
    for (const row of rows) console.error(`  - supabase/migrations/${row}`);
  }
  console.error("Rename each duplicate to a unique timestamp before validating or applying migrations.");
  process.exit(1);
}

await checkUniqueMigrationVersions();

const versionCheck = run("supabase", ["--version"]);
if (versionCheck.status !== 0) {
  printResult(versionCheck);
  console.error("Supabase CLI is required for migration health checks.");
  process.exit(versionCheck.status || 127);
}

if (process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_DB_PASSWORD) {
  const link = run("supabase", [
    "link",
    "--project-ref",
    process.env.SUPABASE_PROJECT_REF,
    "--password",
    process.env.SUPABASE_DB_PASSWORD,
  ]);
  if (link.status !== 0) {
    printResult(link);
    console.error("Could not link Supabase project before migration health check.");
    process.exit(link.status || 1);
  }
}

if (mode === "apply") {
  const push = run("supabase", ["db", "push", "--include-all", "--yes"]);
  printResult(push);

  if (push.status !== 0) {
    console.error("Supabase migration apply failed. Production may still have pending migrations.");
    process.exit(push.status || 1);
  }

  console.log("Supabase migration apply completed. Verifying production is clean...");
}

const dryRunArgs = ["db", "push", "--dry-run"];
if (mode === "validate") dryRunArgs.push("--include-all");
const dryRun = run("supabase", dryRunArgs);
printResult(dryRun);

if (dryRun.status !== 0) {
  console.error("Supabase migration dry-run failed. Resolve migration drift/collisions before merging.");
  process.exit(dryRun.status || 1);
}

const output = `${dryRun.stdout || ""}\n${dryRun.stderr || ""}`;
const isClean = output.includes("Remote database is up to date.");

if ((mode === "clean" || mode === "apply") && !isClean) {
  console.error("Supabase migrations are valid but not fully applied. Run `npm run db:migrations:apply` on main.");
  process.exit(1);
}

if (mode === "clean") {
  console.log("Supabase migration health: remote is up to date.");
} else if (mode === "apply") {
  console.log("Supabase migration apply verified: remote is up to date.");
} else {
  console.log("Supabase migration health: dry-run completed successfully.");
}

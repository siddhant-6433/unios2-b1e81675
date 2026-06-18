#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const modeArg = [...args].find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.slice("--mode=".length) : "validate";
const validModes = new Set(["validate", "clean"]);

if (!validModes.has(mode)) {
  console.error(`Unknown mode "${mode}". Use --mode=validate or --mode=clean.`);
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

const dryRun = run("supabase", ["db", "push", "--dry-run"]);
printResult(dryRun);

if (dryRun.status !== 0) {
  console.error("Supabase migration dry-run failed. Resolve migration drift/collisions before merging.");
  process.exit(dryRun.status || 1);
}

const output = `${dryRun.stdout || ""}\n${dryRun.stderr || ""}`;
const isClean = output.includes("Remote database is up to date.");

if (mode === "clean" && !isClean) {
  console.error("Supabase migrations are valid but not fully applied. Run `supabase db push` on main.");
  process.exit(1);
}

if (mode === "clean") {
  console.log("Supabase migration health: remote is up to date.");
} else {
  console.log("Supabase migration health: dry-run completed successfully.");
}

#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const functionsRoot = join(repoRoot, "supabase", "functions");
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=")];
}));

function runGit(commandArgs) {
  const result = spawnSync("git", commandArgs, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  return result.stdout.trim();
}

function listFunctions() {
  return readdirSync(functionsRoot)
    .filter((entry) => entry !== "_shared")
    .filter((entry) => {
      const path = join(functionsRoot, entry);
      return statSync(path).isDirectory() && existsSync(join(path, "index.ts"));
    })
    .sort();
}

const allFunctions = listFunctions();

function changedFiles() {
  const explicit = args.get("files");
  if (explicit) return explicit.split("\n").map((file) => file.trim()).filter(Boolean);

  const base = args.get("base") || process.env.BASE_SHA || "";
  const head = args.get("head") || process.env.HEAD_SHA || "HEAD";
  if (!base || /^0+$/.test(base)) return [];
  return runGit(["diff", "--name-only", base, head]).split("\n").filter(Boolean);
}

function changedConfigFunctions() {
  const base = args.get("base") || process.env.BASE_SHA || "";
  const head = args.get("head") || process.env.HEAD_SHA || "HEAD";
  if (!base || /^0+$/.test(base)) return [];

  const diff = runGit(["diff", "--unified=0", base, head, "--", "supabase/config.toml"]);
  const functions = new Set();
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+[functions.") && !line.startsWith("-[functions.")) continue;
    const match = line.match(/^[+-]\[functions\.([^\]]+)\]/);
    if (match?.[1] && allFunctions.includes(match[1])) functions.add(match[1]);
  }
  return [...functions].sort();
}

function pathFromRepo(file) {
  return normalize(join(repoRoot, file));
}

function functionForPath(file) {
  const parts = normalize(file).split(sep);
  if (parts[0] !== "supabase" || parts[1] !== "functions") return null;
  const fn = parts[2];
  if (!fn || fn === "_shared") return null;
  return allFunctions.includes(fn) ? fn : null;
}

const importPattern = /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g;
const dependencyCache = new Map();

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, "index.ts")];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved || !resolved.startsWith(functionsRoot)) return null;
  return normalize(resolved);
}

function collectDeps(file, seen = new Set()) {
  const normalized = normalize(file);
  if (dependencyCache.has(normalized)) return dependencyCache.get(normalized);
  if (seen.has(normalized) || !existsSync(normalized)) return new Set();

  seen.add(normalized);
  const deps = new Set([normalized]);
  const source = readFileSync(normalized, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2];
    const imported = resolveImport(normalized, specifier);
    if (!imported) continue;
    for (const dep of collectDeps(imported, seen)) deps.add(dep);
  }
  dependencyCache.set(normalized, deps);
  return deps;
}

const files = changedFiles();
const changed = new Set(files.map(pathFromRepo));
let functions = new Set();

if (files.includes("supabase/config.toml")) {
  const configFunctions = changedConfigFunctions();
  functions = new Set(configFunctions.length > 0 ? configFunctions : allFunctions);
} else {
  for (const file of files) {
    const directFunction = functionForPath(file);
    if (directFunction) functions.add(directFunction);
  }

  const changedFunctionFiles = [...changed].filter((file) => file.startsWith(functionsRoot));
  for (const fn of allFunctions) {
    const entry = join(functionsRoot, fn, "index.ts");
    const deps = collectDeps(entry);
    if (changedFunctionFiles.some((file) => deps.has(normalize(file)))) {
      functions.add(fn);
    }
  }
}

const output = [...functions].sort();
console.log(output.join(" "));

if (process.env.GITHUB_OUTPUT) {
  const fs = await import("node:fs");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `functions=${output.join(" ")}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${output.length}\n`);
}

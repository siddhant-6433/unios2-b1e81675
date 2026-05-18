#!/usr/bin/env node
/**
 * Static lint for the three access regressions that have actually bitten us:
 *
 *   A. Edge function called from the anonymous apply portal but missing from
 *      supabase/config.toml — defaults to verify_jwt=true, applicants 401.
 *      (Bit us: apply-portal-upload-doc on 2026-05-18.)
 *
 *   B. SECURITY INVOKER view that queries public.leads / applications /
 *      students directly — counsellor RLS hides unassigned rows, so the
 *      view returns 0 for counsellor login while super-admin sees normal data.
 *      (Bit us: unassigned_leads_bucket on 2026-05-18.)
 *
 *   C. Apply portal invoking notify-event from anon context — the function
 *      requires service-role auth internally and always silently 401s.
 *      Lifecycle events must fire from DB triggers via fn_notify_event.
 *      (Bit us: app_submitted notification on 2026-05-18.)
 *
 * Each rule supports an inline `lint-allow: <reason>` override:
 *   - SQL:  `-- lint-allow: <reason>` on the same line or the line above
 *   - TS:   `// lint-allow: <reason>` on the same line or the line above
 *
 * Run locally: `npm run lint:access`
 * Run in CI:   `.github/workflows/access-guardrails.yml`
 *
 * Exits 1 on any violation. Prints `file:line  RULE  message` so editors
 * with problem matchers (VS Code, gh actions) jump straight to the offending
 * line.
 */

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "lint-access-guardrails.baseline.json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

// ---------- helpers ---------------------------------------------------------

async function walk(dir, filter, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      await walk(full, filter, out);
    } else if (e.isFile() && filter(full)) {
      out.push(full);
    }
  }
  return out;
}

async function readLines(path) {
  const text = await readFile(path, "utf8");
  return { text, lines: text.split("\n") };
}

// True when the offending line OR the line before it carries `lint-allow:`.
function isAllowed(lines, idx) {
  const here = lines[idx] || "";
  const above = lines[idx - 1] || "";
  const re = /lint-allow\s*:/i;
  return re.test(here) || re.test(above);
}

// ---------- rule A: apply-portal-facing edge fn in config.toml --------------

const APPLY_PORTAL_GLOBS = [
  "src/pages/ApplyPortal.tsx",
  "src/pages/ApplicantPortal.tsx",
  "src/components/apply",
];

async function findApplyPortalFiles() {
  const files = [];
  for (const g of APPLY_PORTAL_GLOBS) {
    const abs = join(REPO_ROOT, g);
    try {
      const st = await stat(abs);
      if (st.isDirectory()) {
        await walk(abs, (p) => /\.(ts|tsx|js|jsx)$/.test(p), files);
      } else if (st.isFile()) {
        files.push(abs);
      }
    } catch { /* missing path is fine */ }
  }
  return files;
}

async function ruleA(violations) {
  const configPath = join(REPO_ROOT, "supabase", "config.toml");
  const config = await readFile(configPath, "utf8");
  const declared = new Set();
  for (const m of config.matchAll(/^\[functions\.([\w-]+)\]/gm)) declared.add(m[1]);

  const files = await findApplyPortalFiles();
  for (const f of files) {
    const { lines } = await readLines(f);
    lines.forEach((line, i) => {
      const m = line.match(/functions\.invoke\(\s*["'`]([\w-]+)["'`]/);
      if (!m) return;
      const fn = m[1];
      if (declared.has(fn)) return;
      if (isAllowed(lines, i)) return;
      violations.push({
        file: relative(REPO_ROOT, f),
        line: i + 1,
        rule: "A:apply-portal-fn-not-in-config",
        message:
          `'${fn}' is invoked from the anonymous apply portal but has no [functions.${fn}] block in supabase/config.toml. ` +
          `Without an explicit verify_jwt=false, the gateway will 401 applicants whose browser carries a stale session JWT. ` +
          `Add a config block (with a comment explaining the trust model), or add 'lint-allow: <reason>' here.`,
      });
    });
  }
}

// ---------- rule B: SECURITY INVOKER view on RLS-scoped tables --------------

const RLS_SCOPED_TABLES = ["leads", "applications", "students"];

// Match a CREATE VIEW or ALTER VIEW that sets security_invoker=true.
// We treat both forms in the same pass.
async function ruleB(violations) {
  const migrationsDir = join(REPO_ROOT, "supabase", "migrations");
  const files = await walk(migrationsDir, (p) => p.endsWith(".sql"));

  for (const f of files) {
    const { text, lines } = await readLines(f);

    // Find ALTER VIEW ... SET (... security_invoker = true ...) statements.
    for (const m of text.matchAll(
      /ALTER\s+VIEW\s+(?:public\.)?(\w+)\s+SET\s*\([^)]*security_invoker\s*=\s*(?:true|on)[^)]*\)/gim
    )) {
      const view = m[1];
      const idx = text.slice(0, m.index).split("\n").length - 1;
      if (isAllowed(lines, idx)) continue;
      const def = await findViewDefinition(view, files);
      const verdict = classifyView(def);
      if (verdict.safe) continue;
      violations.push({
        file: relative(REPO_ROOT, f),
        line: idx + 1,
        rule: "B:invoker-view-on-rls-table",
        message:
          `View '${view}' is set to security_invoker=true and its body queries ${verdict.tables.join(", ")} directly. ` +
          `For counsellor / student / applicant logins this view will be filtered by RLS and likely return 0 rows. ` +
          `Wrap the body in a SECURITY DEFINER function (see public.get_unassigned_leads_bucket() for the pattern), ` +
          `or add 'lint-allow: <reason>' if RLS filtering is intentional here.`,
      });
    }

    // Find CREATE [OR REPLACE] VIEW ... WITH (security_invoker = true) AS ...
    for (const m of text.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)\s+WITH\s*\([^)]*security_invoker\s*=\s*(?:true|on)[^)]*\)\s+AS\s+([\s\S]*?);/gim
    )) {
      const view = m[1];
      const body = m[2];
      const idx = text.slice(0, m.index).split("\n").length - 1;
      if (isAllowed(lines, idx)) continue;
      const verdict = classifyView(body);
      if (verdict.safe) continue;
      violations.push({
        file: relative(REPO_ROOT, f),
        line: idx + 1,
        rule: "B:invoker-view-on-rls-table",
        message:
          `View '${view}' is created with security_invoker=true and its body queries ${verdict.tables.join(", ")} directly. ` +
          `For counsellor / student / applicant logins this view will be filtered by RLS and likely return 0 rows. ` +
          `Wrap the body in a SECURITY DEFINER function, or add 'lint-allow: <reason>' if RLS filtering is intentional.`,
      });
    }
  }
}

function classifyView(body) {
  if (!body) return { safe: true, tables: [] };
  // If the view selects from a function rather than tables, treat as safe —
  // the function's body is responsible for RLS posture (we trust the author).
  if (/FROM\s+(?:public\.)?\w+\s*\(/i.test(body)) return { safe: true, tables: [] };
  const hits = [];
  for (const t of RLS_SCOPED_TABLES) {
    const re = new RegExp(`(?:FROM|JOIN)\\s+(?:public\\.)?${t}\\b`, "i");
    if (re.test(body)) hits.push(`public.${t}`);
  }
  return { safe: hits.length === 0, tables: hits };
}

// Search the whole migrations corpus for the latest CREATE VIEW body of a
// given view — used when the migration only does ALTER VIEW.
async function findViewDefinition(view, files) {
  let best = null;
  for (const f of files) {
    const text = await readFile(f, "utf8");
    for (const m of text.matchAll(
      new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:public\\.)?${view}\\b[\\s\\S]*?AS\\s+([\\s\\S]*?);`,
        "gi"
      )
    )) {
      best = m[1];
    }
  }
  return best;
}

// ---------- rule C: apply portal must not call notify-event -----------------

async function ruleC(violations) {
  const files = await findApplyPortalFiles();
  for (const f of files) {
    const { lines } = await readLines(f);
    lines.forEach((line, i) => {
      if (!/functions\.invoke\(\s*["'`]notify-event["'`]/.test(line)) return;
      if (isAllowed(lines, i)) return;
      violations.push({
        file: relative(REPO_ROOT, f),
        line: i + 1,
        rule: "C:apply-portal-calls-notify-event",
        message:
          `notify-event requires service-role auth internally and silently 401s anon callers. ` +
          `Fire lifecycle notifications from a DB trigger via public.fn_notify_event() instead ` +
          `(see trg_notify_app_submitted in 20260612120000_app_submitted_trigger.sql).`,
      });
    });
  }
}

// ---------- main ------------------------------------------------------------

async function loadBaseline() {
  try {
    const text = await readFile(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(text);
    return new Set(parsed.allowed || []);
  } catch {
    return new Set();
  }
}

function violationKey(v) {
  return `${v.file}:${v.line}:${v.rule}`;
}

(async () => {
  const violations = [];
  await ruleA(violations);
  await ruleB(violations);
  await ruleC(violations);

  // Stable sort: file then line.
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (UPDATE_BASELINE) {
    const allowed = violations.map(violationKey);
    const payload = {
      _doc:
        "Pre-existing access-guardrail violations that have been reviewed and accepted. " +
        "Regenerate with `npm run lint:access -- --update-baseline` after a deliberate audit. " +
        "New PRs should NOT add entries here without code-review justification.",
      allowed,
    };
    await writeFile(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n");
    console.log(`access-guardrails: baseline updated (${allowed.length} entries).`);
    process.exit(0);
  }

  const baseline = await loadBaseline();
  const newViolations = violations.filter((v) => !baseline.has(violationKey(v)));

  if (newViolations.length === 0) {
    const skipped = violations.length;
    if (skipped > 0) {
      console.log(`access-guardrails: no new violations (${skipped} baselined).`);
    } else {
      console.log("access-guardrails: no violations.");
    }
    process.exit(0);
  }

  console.error("access-guardrails: new violations found\n");
  for (const v of newViolations) {
    console.error(`${v.file}:${v.line}: ${v.rule}: ${v.message}\n`);
  }
  console.error(`Total: ${newViolations.length} new violation(s).`);
  console.error(
    "Options: fix the issue, add 'lint-allow: <reason>' on the line, or " +
      "(after review) regenerate the baseline with `npm run lint:access -- --update-baseline`."
  );
  process.exit(1);
})().catch((err) => {
  console.error("access-guardrails: internal error", err);
  process.exit(2);
});

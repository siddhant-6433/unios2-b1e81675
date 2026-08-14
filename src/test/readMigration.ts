import { readFileSync, readdirSync } from "node:fs";

/**
 * Read a migration by its name, ignoring the timestamp prefix.
 *
 * The pre-commit hook rewrites a hand-stamped migration's timestamp to the real
 * commit time, so a test that hardcodes the full filename starts throwing ENOENT
 * the moment that happens (e.g. 20260806050226_… landed as 20260806050610_…).
 * Match on the name instead — it's the part that identifies the migration.
 *
 * ponytail: only the tests that have actually been bitten use this; the rest can
 * switch over when they break.
 */
export function readMigration(name: string): string {
  const suffix = `_${name.replace(/\.sql$/, "")}.sql`;
  const matches = readdirSync("supabase/migrations").filter((f) => f.endsWith(suffix));
  if (matches.length === 0) {
    throw new Error(`No migration matching "*${suffix}" in supabase/migrations`);
  }
  // Newest wins if a migration name was ever reused.
  return readFileSync(`supabase/migrations/${matches.sort().at(-1)}`, "utf8");
}

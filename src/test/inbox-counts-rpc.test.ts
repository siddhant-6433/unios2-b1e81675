import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");

// Migrations are matched by name suffix, not full filename: the pre-commit hook
// re-stamps every new migration with the actual commit time.
const readMigration = (suffix: string) => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`No migration found ending in _${suffix}.sql`);
  return readFileSync(join(dir, file), "utf8");
};

const countsMigration = readMigration("inbox_queue_counts_rpc");

describe("Inbox aggregate counts RPC", () => {
  it("is an RLS-scoped (SECURITY INVOKER) exact count, not a definer bypass or estimate", () => {
    expect(countsMigration).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(countsMigration).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(countsMigration).toContain("CREATE OR REPLACE FUNCTION public.get_inbox_counts()");
    expect(countsMigration).toContain("count(*)");
    expect(countsMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_inbox_counts() TO authenticated");
  });

  it("folds the hidden lead/student exclusion into the counts", () => {
    expect(countsMigration).toContain("s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL");
    expect(countsMigration).toContain("s.lead_id = ol.lead_id");
    expect(countsMigration).toContain("s.id = r.student_id");
  });

  it("covers every queue the client maps (Pending AN keeps its own super-admin RPC)", () => {
    for (const key of [
      "offer_waivers", "abvmu_deposits", "offer_approvals", "contact_changes",
      "applications", "followups", "whatsapp", "video_approvals",
      "voice_messages", "certificate_approvals", "fee_concessions", "offer_edits",
      "hr_document_approvals",
    ]) {
      expect(countsMigration).toContain(`'${key}'`);
      expect(inbox).toContain(`n("${key}")`);
    }
  });

  it("has the client call it instead of the old per-queue row fetches", () => {
    expect(inbox).toContain('rpc("get_inbox_counts")');
    expect(inbox).toContain('supabase.rpc("list_pending_an_generation")');
    expect(inbox).not.toContain("const waiverRows = rowsOf(0)");
    expect(inbox).not.toContain("const concessionRows = rowsOf(10)");
  });
});

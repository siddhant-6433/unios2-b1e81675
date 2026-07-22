import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260704143000_multi_counsellor_account_transfer.sql", "utf8");
const dialog = readFileSync("src/components/admin/TransferAccountDialog.tsx", "utf8");

describe("multi-counsellor account transfer", () => {
  it("adds a guarded RPC for round-robin and course-wise reassignment", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.transfer_counsellor_account_multi");
    expect(migration).toContain("target_profile_ids uuid[]");
    expect(migration).toContain("course_target_map jsonb");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin'::public.app_role)");
    expect(migration).toContain("row_number() OVER (PARTITION BY assignment_group ORDER BY created_at, lead_id)");
    expect(migration).toContain("((rn - 1) % array_length(target_ids, 1)) + 1");
  });

  it("keeps WhatsApp assignments aligned with transferred leads", () => {
    expect(migration).toContain("UPDATE public.whatsapp_messages wm");
    expect(migration).toContain("wm.lead_id = a.lead_id");
    expect(migration).toContain("whatsapp_messages_remaining_transferred");
  });

  it("wires the admin dialog to multi-select targets and course overrides", () => {
    expect(dialog).toContain('TransferMode = "round_robin" | "coursewise"');
    expect(dialog).toContain("selectedTargetIds");
    expect(dialog).toContain("courseTargetIds");
    expect(dialog).toContain('transfer_counsellor_account_multi"');
    expect(dialog).toContain("course_target_map: courseTargetMap");
    expect(dialog).toContain("Course routing");
    // Spinner must never stick on throw/timeout
    expect(dialog).toContain("finally");
    expect(dialog).toContain("setSaving(false)");
    expect(dialog).toContain("withTimeout");
    // 0-lead / single-target uses simpler RPC
    expect(dialog).toContain('transfer_counsellor_account"');
  });
});


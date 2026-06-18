import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inviteDialog = readFileSync("src/components/admin/InviteUserDialog.tsx", "utf8");
const inviteFunction = readFileSync("supabase/functions/invite-user/index.ts", "utf8");
const teamManagement = readFileSync("src/components/admin/TeamManagement.tsx", "utf8");
const aiPriorityMigration = readFileSync("supabase/migrations/20260620119000_ai_priority_assignment_history.sql", "utf8");

describe("invite user counsellor teams", () => {
  it("lets admins select multiple teams only when inviting counsellors", () => {
    expect(inviteDialog).toContain('role === "counsellor"');
    expect(inviteDialog).toContain("selectedTeamIds");
    expect(inviteDialog).toContain('team_ids: role === "counsellor" ? selectedTeamIds : undefined');
    expect(inviteDialog).toContain('supabase.from("teams").select("id, name").order("name")');
    expect(inviteDialog).toContain("setSelectedTeamIds([])");
  });

  it("persists selected counsellor teams through the invite-user function", () => {
    expect(inviteFunction).toContain("team_ids");
    expect(inviteFunction).toContain('role === "counsellor"');
    expect(inviteFunction).toContain('.from("team_members")');
    expect(inviteFunction).toContain('onConflict: "team_id,user_id"');
    expect(inviteFunction).toContain("Failed to add counsellor to teams");
  });

  it("runs a one-time backfill for unassigned priority-interested leads", () => {
    expect(aiPriorityMigration).toContain("one-time priority-interested assignment backfill");
    expect(aiPriorityMigration).toContain("WHERE stage = 'priority_interested'::public.lead_stage");
    expect(aiPriorityMigration).toContain("AND counsellor_id IS NULL");
    expect(aiPriorityMigration).toContain("public.fn_assign_priority_interested_lead");
  });

  it("does not route new automatic assignments to inactive counsellors", () => {
    expect(aiPriorityMigration).toContain("CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor");
    expect(aiPriorityMigration).toContain("COALESCE(p.login_disabled, false) = false");
    expect(aiPriorityMigration).toContain("p.archived_at IS NULL");
  });

  it("keeps archived team members visible but unavailable for new team assignment", () => {
    expect(teamManagement).toContain('select("id, user_id, display_name, archived_at, login_disabled")');
    expect(teamManagement).toContain(".filter(p => !p.archived_at && !p.login_disabled)");
    expect(teamManagement).toContain("profileByUserId");
    expect(teamManagement).toContain("Archived");
    expect(teamManagement).toContain("Login disabled");
  });
});

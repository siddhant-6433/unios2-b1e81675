import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260707130000_visit_center.sql", "utf8");
const appRoutes = readFileSync("src/App.tsx", "utf8");
const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
const accessPolicy = readFileSync("src/lib/accessPolicy.ts", "utf8");
const walkInDialog = readFileSync("src/components/visits/WalkInDialog.tsx", "utf8");
const todayBoard = readFileSync("src/components/visits/TodayVisitBoard.tsx", "utf8");
const postVisitQueue = readFileSync("src/components/visits/PostVisitQueue.tsx", "utf8");
const mobileWork = readFileSync("mobile/app/(staff)/(tabs)/work.tsx", "utf8");
const mobileIndex = readFileSync("mobile/app/(staff)/(tabs)/index.tsx", "utf8");
const mobileLayout = readFileSync("mobile/app/(staff)/work/_layout.tsx", "utf8");
const confirmCron = readFileSync("supabase/functions/visit-confirmation-cron/index.ts", "utf8");
const nudgeCron = readFileSync("supabase/functions/post-visit-nudge-cron/index.ts", "utf8");

describe("visit_center migration", () => {
  it("adds checked_in_at / purpose / outcome with a guarded outcome CHECK", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS checked_in_at timestamptz");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS purpose text");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS outcome text");
    expect(migration).toContain(
      "'interested','token_collected','offer_discussed','needs_followup','not_interested','other'",
    );
    // NULL outcome stays legal for legacy rows.
    expect(migration).toContain("CHECK (outcome IS NULL OR outcome IN (");
  });

  it("creates the walk-in RPC as SECURITY DEFINER (leads-insert RLS trap) with phone dedupe", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.create_walk_in_visit(");
    expect(migration).toContain("SECURITY DEFINER");
    // Dedupe strips non-digits on both sides before comparing.
    expect(migration).toContain("regexp_replace(phone, '\\D', '', 'g') = v_clean_phone");
    // Walk-ins are created checked-in.
    expect(migration).toContain("'walk_in', now(), _purpose, _notes");
    expect(migration).toContain("RETURN jsonb_build_object('lead_id', v_lead_id, 'visit_id', v_visit_id);");
    // Counsellor assignment comes from the caller's profile.
    expect(migration).toContain("SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid()");
  });

  it("visit_complete optionally creates the linked follow-up in the same transaction", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.visit_complete(");
    expect(migration).toContain("IF _followup_at IS NOT NULL THEN");
    expect(migration).toContain("lead_id, user_id, scheduled_at, type, status, notes, visit_id");
    expect(migration).toContain("RAISE EXCEPTION 'Visit % not found', _visit_id;");
  });

  it("extends visit_funnel_leads with checked_in_at and outcome without changing funnel logic", () => {
    expect(migration).toContain("cv.checked_in_at");
    expect(migration).toContain("cv.outcome");
    expect(migration).toContain("THEN 'visit_followup'");
    expect(migration).toContain("WHEN lv.visit_status IN ('no_show','cancelled')");
  });
});

describe("Visit Center desktop wiring", () => {
  it("registers the /visit-center route, sidebar entry, and access policy behind leads:view", () => {
    expect(appRoutes).toContain('path="/visit-center"');
    expect(appRoutes).toContain('<RequirePermission module="leads" action="view"><VisitCenter /></RequirePermission>');
    expect(sidebar).toContain('{ title: "Visit Center", url: "/visit-center", icon: DoorOpen, permission: "leads:view" }');
    expect(accessPolicy).toContain('{ path: "/visit-center", permission: "leads:view", staffOnly: true }');
  });

  it("walk-in success offers the token payment link (token-at-visit moment)", () => {
    expect(walkInDialog).toContain('supabase.rpc("create_walk_in_visit" as any');
    expect(walkInDialog).toContain("Send token payment link");
    expect(walkInDialog).toContain('defaultPurpose="pre_admission_token"');
    expect(walkInDialog).toContain("/admissions/${result.lead_id}");
  });

  it("board actions use the check-in RPC and the no-show status update that fires the trigger", () => {
    expect(todayBoard).toContain('supabase.rpc("visit_check_in" as any, { _visit_id: v.id })');
    expect(todayBoard).toContain('.update({ status: "no_show" }).eq("id", v.id)');
    expect(todayBoard).toContain('.in("status", ["scheduled", "confirmed"])');
  });

  it("post-visit queue works only visit-linked pending follow-ups", () => {
    expect(postVisitQueue).toContain('.not("visit_id", "is", null)');
    expect(postVisitQueue).toContain('.eq("status", "pending")');
    expect(postVisitQueue).toContain('status: "completed", completed_at:');
  });
});

describe("Visit Center mobile wiring", () => {
  it("registers the three screens in the work stack", () => {
    expect(mobileLayout).toContain('<Stack.Screen name="visits"');
    expect(mobileLayout).toContain('<Stack.Screen name="visit/[id]"');
    expect(mobileLayout).toContain('<Stack.Screen name="walk-in"');
  });

  it("home + work tabs link to visits and count with the real visit_date column", () => {
    expect(mobileWork).toContain("router.push('/(staff)/work/visits' as any)");
    expect(mobileWork).toContain("router.push('/(staff)/work/walk-in' as any)");
    // The old bug queried a non-existent scheduled_at column.
    expect(mobileWork).not.toContain("gte('scheduled_at'");
    expect(mobileWork).toContain("gte('visit_date'");
    expect(mobileIndex).not.toContain("gte('scheduled_at'");
    expect(mobileIndex).toContain("Visits today");
  });

  it("visit crons deep-link mobile pushes to the visit detail screen", () => {
    expect(confirmCron).toContain("data: { url: `/(staff)/work/visit/${visit.id}` }");
    expect(nudgeCron).toContain("data: { url: `/(staff)/work/visit/${visit.visit_id}` }");
    // Web fallback link retained.
    expect(confirmCron).toContain("link: `/admissions/${visit.lead_id}`");
  });
});

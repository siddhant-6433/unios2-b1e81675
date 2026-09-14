import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { canonicalizeLeadSource, LEAD_SOURCES, MANUAL_ENTRY_SOURCES } from "@/config/leadSources";

const addLeadDialog = readFileSync("src/components/admissions/AddLeadDialog.tsx", "utf8");
const admissions = readFileSync("src/pages/Admissions.tsx", "utf8");
const leadDetail = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const appLayout = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
const mergeMigration = readFileSync(
  "supabase/migrations/20260914142123_merge_direct_walkin_into_walk_in.sql",
  "utf8",
);

describe("walk-in source merge", () => {
  it("canonicalizes Direct Walk-In onto walk_in", () => {
    expect(canonicalizeLeadSource("direct_walkin")).toBe("walk_in");
    expect(canonicalizeLeadSource("Direct Walk-In")).toBe("walk_in");
    expect(LEAD_SOURCES.some((s) => s.value === "direct_walkin")).toBe(false);
    expect(MANUAL_ENTRY_SOURCES.some((s) => s.value === "walk_in")).toBe(false);
    expect(LEAD_SOURCES.some((s) => s.value === "walk_in")).toBe(true);
  });

  it("remaps existing direct_walkin rows and only allows walk_in on the RPC", () => {
    expect(mergeMigration).toContain("SET source = 'walk_in'");
    expect(mergeMigration).toContain("WHERE source = 'direct_walkin'");
    expect(mergeMigration).toContain("Walk-in source must be walk_in");
    expect(mergeMigration).toContain("_already_left  boolean     DEFAULT false");
    expect(mergeMigration).toContain("checked_out_at IS NULL");
  });

  it("keeps walk-in off Add Lead and offers Record Walk-in instead", () => {
    expect(addLeadDialog).toContain("MANUAL_ENTRY_SOURCES");
    expect(addLeadDialog).toContain("Student at the desk?");
    expect(admissions).toContain("Record Walk-in");
    expect(admissions).toContain("onRecordWalkIn");
  });

  it("records existing-lead walk-ins via WalkInDialog check-in, not completeCampusVisit", () => {
    expect(leadDetail).toContain("Record Walk-in");
    expect(leadDetail).toContain("<WalkInDialog");
    expect(leadDetail).toContain("lockIdentity");
    expect(leadDetail).toContain("On campus now");
    expect(leadDetail).toContain("completeWalkIn");
  });

  it("puts live walk-ins + complete on the navbar", () => {
    expect(appLayout).toContain("HeaderWalkIns");
    expect(appLayout).not.toContain("Record Walk-in");
  });

  it("labels Cloud Dialer previous-walk-in logging and requires a visit date", () => {
    const dialerActions = readFileSync("src/components/dialer/DialerActionRow.tsx", "utf8");
    const dialer = readFileSync("src/pages/CloudDialer.tsx", "utf8");
    const previous = readFileSync("src/components/visits/PreviousWalkInDialog.tsx", "utf8");
    const completion = readFileSync("src/lib/visitCompletion.ts", "utf8");
    const visitCenter = readFileSync("src/pages/VisitCenter.tsx", "utf8");
    expect(dialerActions).toContain('label: "Log a Previous Walk-In"');
    expect(dialer).toContain("PreviousWalkInDialog");
    expect(previous).toContain("Existing walk-ins");
    expect(previous).toContain("fetchWalkInHistory");
    expect(previous).toContain("Already logged");
    expect(completion).toContain("Previous visit date is required.");
    expect(completion).toContain("A walk-in is already logged for this date.");
    expect(completion).toContain("checked_out_at: visitAt");
    expect(visitCenter).toContain("WalkInsBoard");
    expect(visitCenter).toContain('label: "Walk-ins"');
  });
});

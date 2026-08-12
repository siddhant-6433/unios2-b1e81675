import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260717125000_academic_partner_lead_share_with_nimt.sql",
  "utf8",
);

describe("academic partner lead: share-with-NIMT gate", () => {
  it("adds an opt-in checkbox (default private) in the Add Lead dialog", () => {
    expect(portal).toContain("share_with_nimt: false");
    expect(portal).toContain("Share with NIMT admissions team");
    expect(portal).toContain('type="checkbox"');
    expect(portal).toContain("_share_with_nimt: leadForm.share_with_nimt");
  });

  it("keeps private partner leads out of every lead-created automation", () => {
    // New column defaults TRUE so existing/normal leads are unaffected.
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS shared_with_nimt boolean NOT NULL DEFAULT true",
    );
    // Private partner lead is inserted with skip_ai_call = true — the universal
    // opt-out already honoured by the AI-call and automation-engine triggers.
    expect(migration).toContain("(_requester_type = 'academic_partner' AND NOT v_shared)");
    // Welcome-WhatsApp trigger now respects the same opt-out.
    expect(migration).toContain("IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;");
    // Only academic-partner leads honour the gate; everyone else stays shared.
    expect(migration).toContain(
      "THEN COALESCE(_share_with_nimt, false) ELSE true END",
    );
  });
});

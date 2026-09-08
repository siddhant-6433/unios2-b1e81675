import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260713180000_abvmu_deposit_claims.sql",
  "utf8",
);
const tokenPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");
const depositHook = readFileSync("src/components/finance/useAbvmuDeposit.ts", "utf8");

describe("ABVMU deposit challan claims", () => {
  it("creates claims table and fee provisional credit hooks", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.abvmu_deposit_claims");
    expect(migration).toContain("status IN ('pending', 'approved', 'rejected', 'settled')");
    expect(migration).toContain("lead_abvmu_approved_credit");
    expect(migration).toContain("abvmu_approved_credit");
    expect(migration).toContain("submit_abvmu_deposit_claim");
    expect(migration).toContain("decide_abvmu_deposit_claim");
    expect(migration).toContain("settle_abvmu_deposit_claim");
    expect(migration).toContain("Only super admins can decide ABVMU deposit claims");
  });

  it("defers receipt until settle (approved is provisional only)", () => {
    expect(migration).toContain("receipt deferred until university remittance");
    expect(migration).toContain("type");
    expect(migration).toContain("'other'");
    expect(migration).toContain("settlement_payment_id");
  });

  it("wires applicant upload UI, application-form gate, and super-admin inbox", () => {
    expect(tokenPanel).toContain("submit_abvmu_deposit_claim");
    expect(tokenPanel).toContain("Already paid ABVMU deposit");
    expect(tokenPanel).toContain("abvmu_deposit_amount");
    expect(inbox).toContain("abvmu_deposits");
    expect(inbox).toContain("decide_abvmu_deposit_claim");
    expect(inbox).toContain("ABVMU Deposits");
  });

  it("shows course name with the student name in the ABVMU inbox", () => {
    const depositBranch = inbox.slice(
      inbox.indexOf('cat === "abvmu_deposits"'),
      inbox.indexOf('cat === "offer_waivers"'),
    );
    expect(depositBranch).toContain('.select("id, name, course_id")');
    expect(depositBranch).toContain('.from("courses").select("id, name")');
    expect(depositBranch).toContain("course_name:");

    const listBranch = inbox.slice(
      inbox.indexOf('selected === "abvmu_deposits"'),
      inbox.indexOf('selected === "offer_waivers"'),
    );
    expect(listBranch).toContain("{c.course_name || \"—\"}");

    const detailBranch = inbox.slice(
      inbox.indexOf('selected === "abvmu_deposits"') === -1
        ? 0
        : inbox.lastIndexOf('selected === "abvmu_deposits"'),
      inbox.lastIndexOf('selected === "offer_waivers"'),
    );
    expect(detailBranch).toContain("{c.course_name && <p className=\"text-sm text-muted-foreground\">{c.course_name}</p>}");
  });

  it("opens the challan via a public URL link (not an async signed URL)", () => {
    const start = inbox.lastIndexOf('selected === "abvmu_deposits"');
    const end = inbox.lastIndexOf('selected === "offer_waivers"');
    const detailBranch = inbox.slice(start, end);
    expect(detailBranch).toContain("applicationDocumentUrl(c.proof_path)");
    expect(detailBranch).toContain('target="_blank"');
    expect(detailBranch).toContain("View proof");
    expect(detailBranch).not.toContain("createSignedUrl");
    expect(inbox).toContain("getPublicUrl");
    expect(inbox).toContain("selectedRef.current !== cat");
    expect(depositHook).toContain("getPublicUrl");
    expect(depositHook).not.toContain("createSignedUrl");
  });
});

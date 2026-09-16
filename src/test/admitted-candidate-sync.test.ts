import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const migration = readMigration("admitted_candidate_application_ledger_sync");
const provision = readFileSync("supabase/functions/provision-student-fees/index.ts", "utf8");
const offerDialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");

describe("admitted candidate application/ledger sync", () => {
  it("resolves application leads on the same school brand, never the opposing one", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.canonical_application_lead_id");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.school_lead_brand");
    expect(migration).toContain("Keep a real lead unless it is the other school brand from this application.");
    expect(migration).toContain("CASE WHEN COALESCE(l.is_mirror, false) THEN 1 ELSE 0 END");
    expect(migration).toContain(
      "v_lead_id := public.canonical_application_lead_id(\n    _phone, _application_id, NULL, _campus_id, _course_id, _portal_brand",
    );
    expect(migration).not.toContain("SELECT id INTO v_lead_id FROM public.leads WHERE phone = _phone LIMIT 1");
  });

  it("lets primary and secondary counsellors see the application on their lead", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.counsellor_applications");
    expect(migration).toContain("FROM public.lead_counsellors lc");
    expect(migration).toContain("p.id = l.counsellor_id");
    expect(migration).not.toContain("twin.id = l.mirror_lead_id");
  });

  it("copies application-form documents onto the student at admission", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.copy_application_documents_to_student");
    expect(migration).toContain("FROM public.application_documents ad");
    expect(migration).toContain("INSERT INTO public.student_documents");
    expect(migration).toContain("trg_copy_app_docs_on_student");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF lead_id, pre_admission_no, admission_no");
    expect(migration).toContain("'Application Form'");
    expect(migration).toContain("doc_key IN ('student_photo', 'photo', 'photograph')");
  });

  it("applies approved offer waivers to the student ledger after offer approval", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.handle_offer_letter_approval");
    expect(migration).toContain("PERFORM public.sync_fee_ledger_concessions(v_student)");
    expect(migration).toContain("GREATEST(fl.total_amount - fl.concession, 0)");
    expect(migration).toContain("metadata->>'category'");
  });

  it("re-provisions concessions when school ledger rows already exist", () => {
    expect(provision).toContain("async function syncLedgerConcessions");
    expect(provision).toContain("if (newRows.length === 0)");
    expect(provision).toContain("await syncLedgerConcessions(db, studentId)");
    expect(provision).toContain('rpc("sync_fee_ledger_concessions"');
  });

  it("stores fee-proposal waiver category on the offer so ledger matching is per head", () => {
    expect(offerDialog).toContain("fee_category: w.fee_category || null");
  });
});

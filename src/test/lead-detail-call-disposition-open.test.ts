import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leadDetailSource = readFileSync("src/pages/LeadDetail.tsx", "utf8");

describe("LeadDetail Cloud Call disposition startup", () => {
  it("opens the disposition panel before waiting on manual-call", () => {
    const fn = leadDetailSource.slice(
      leadDetailSource.indexOf("const placeManualCall = async () => {"),
      leadDetailSource.indexOf("const triggerManualCall = async () => {"),
    );

    expect(fn).toContain("setDispositionCallStatus(\"calling\")");
    expect(fn).toContain("setShowCallDisposition(true)");
    expect(fn.indexOf("setShowCallDisposition(true)")).toBeLessThan(
      fn.indexOf("supabase.functions.invoke(\"manual-call\""),
    );
  });

  it("keeps live-call controls locked until a call UUID is available", () => {
    expect(leadDetailSource).toContain("callStarting={manualCalling && !activeCallUuid");
    expect(leadDetailSource).toContain("onManualConnect={activeCallUuid ?");
  });
});

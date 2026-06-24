import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const tokenFeePanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");

describe("applicant token fee instalments", () => {
  it("builds preset amounts from the outstanding token balance", () => {
    expect(tokenFeePanel).toContain("while (p < tokenOutstanding && presets.length < 6)");
    expect(tokenFeePanel).toContain("if (!presets.includes(tokenOutstanding) && tokenOutstanding > 0)");
  });

  it("keeps the custom amount field editable while pay-in-parts is open", () => {
    expect(tokenFeePanel).toContain("choose a preset or edit the amount directly");
    expect(tokenFeePanel).toContain("onChange={e => { setInstalmentPreset(null); setCustomAmt(e.target.value); }}");
    expect(tokenFeePanel).toContain("step={minInstalment}");
  });
});

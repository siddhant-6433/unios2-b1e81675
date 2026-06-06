import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cloudDialerSource = readFileSync("src/pages/CloudDialer.tsx", "utf8");

describe("CloudDialer call setup failure state", () => {
  it("turns the dialer off when manual-call fails before the counsellor phone rings", () => {
    const placeCall = cloudDialerSource.slice(
      cloudDialerSource.indexOf("const placeCall = async"),
      cloudDialerSource.indexOf("// ── Pre-select disposition"),
    );

    const providerFailureBlock = placeCall.slice(
      placeCall.indexOf("if (error || data?.error)"),
      placeCall.indexOf("// Stay in \"calling\" state"),
    );
    expect(providerFailureBlock).toContain("setDialerActive(false)");

    const thrownFailureBlock = placeCall.slice(
      placeCall.indexOf("} catch (e: any)"),
      placeCall.indexOf("  };", placeCall.indexOf("} catch (e: any)")),
    );
    expect(thrownFailureBlock).toContain("setDialerActive(false)");
  });
});

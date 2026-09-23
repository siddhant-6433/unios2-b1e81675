import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cloudDialerSource = readFileSync("src/pages/CloudDialer.tsx", "utf8");

/**
 * The poll's branch logic lives in the unit-tested classifyCloudCallPoll
 * (src/test/cloudCallPoll.test.ts). These checks pin the component wiring that
 * the state machine alone can't cover.
 */
describe("CloudDialer poll wiring", () => {
  const startPolling = cloudDialerSource.slice(
    cloudDialerSource.indexOf("const startPolling = (callId: string) =>"),
    cloudDialerSource.indexOf("const saveLeadEdit"),
  );

  it("classifies via the pure helper instead of an inline status check", () => {
    expect(startPolling).toContain("classifyCloudCallPoll(");
    expect(startPolling).not.toContain('if (data.status === "initiated")');
  });

  it("clears any previous poll interval before starting a new one", () => {
    const head = startPolling.slice(0, startPolling.indexOf("callIdRef.current = callId"));
    expect(head).toContain("clearInterval(pollRef.current)");
    expect(head).toContain("pollRef.current = null");
  });
});

describe("CloudDialer auto-next", () => {
  const moveToNext = cloudDialerSource.slice(
    cloudDialerSource.indexOf("const moveToNext = async () =>"),
    cloudDialerSource.indexOf("// Opening an inline action kills the auto-next countdown"),
  );

  it("advances to the captured next lead instead of the stale closure", () => {
    expect(moveToNext).toContain("const nextLead = queue[currentIdx + 1]");
    expect(moveToNext).toContain("placeCall(nextLead)");
    expect(moveToNext).not.toContain("setTimeout(() => placeCall(), 1000)");
  });
});

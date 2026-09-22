import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cloudDialerSource = readFileSync("src/pages/CloudDialer.tsx", "utf8");

/**
 * Regression: the dialer poll only treated status='initiated' as live. The
 * voice agent flips a bridge call to 'in_progress' the moment the STUDENT
 * answers (bridge-b-status), while the counsellor's parent leg stays
 * 'initiated' until hangup. So the first poll tick after the student answered
 * fell through to the terminal branch: the dialer marked the call ended,
 * auto-recorded a bogus call_back ~60s later, then rang the counsellor for the
 * next lead while they were still mid-conversation. Plivo flagged the
 * overlapping calls as simultaneous.
 *
 * Every non-terminal status must be treated as active.
 */
describe("CloudDialer poll active-status guard", () => {
  const poll = cloudDialerSource.slice(
    cloudDialerSource.indexOf("const startPolling = (callId: string) =>"),
    cloudDialerSource.indexOf("// Cleanup polling on unmount"),
  );

  it("treats a connected ('in_progress') call as still active", () => {
    expect(poll).toContain('data.status === "initiated"');
    expect(poll).toContain('data.status === "in_progress"');
    expect(poll).toContain('data.status === "in-progress"');
    expect(poll).toContain('data.status === "answered"');
  });

  it("routes the terminal branch through the active-status guard", () => {
    expect(poll).toContain("const activeStatus");
    expect(poll).toContain("if (activeStatus)");
    // The old bare equality check is the bug; it must not come back.
    expect(poll).not.toContain('if (data.status === "initiated")');
  });

  it("clears any previous poll interval before starting a new one", () => {
    const start = poll.indexOf("const startPolling = (callId: string) =>");
    const head = poll.slice(0, poll.indexOf("callIdRef.current = callId", start));
    expect(head).toContain("clearInterval(pollRef.current)");
    expect(head).toContain("pollRef.current = null");
  });
});

describe("CloudDialer auto-next advances to the captured next lead", () => {
  const moveToNext = cloudDialerSource.slice(
    cloudDialerSource.indexOf("const moveToNext = async () =>"),
    cloudDialerSource.indexOf("// Opening an inline action kills the auto-next countdown"),
  );

  it("passes the next queue lead to placeCall instead of relying on the stale closure", () => {
    expect(moveToNext).toContain("const nextLead = queue[currentIdx + 1]");
    expect(moveToNext).toContain("placeCall(nextLead)");
    expect(moveToNext).not.toContain("setTimeout(() => placeCall(), 1000)");
  });
});

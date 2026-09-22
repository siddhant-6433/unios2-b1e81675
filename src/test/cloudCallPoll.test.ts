import { describe, expect, it } from "vitest";
import {
  classifyCloudCallPoll,
  isActiveCallStatus,
  isCancelledDisposition,
} from "@/lib/cloudCallPoll";

const OPTS = { elapsedMs: 1000, stuckAfterMs: 8 * 60 * 1000 };

function row(over: Partial<{ status: string | null; disposition: string | null; student_connected_at: string | null }>) {
  return { status: "initiated", disposition: null, student_connected_at: null, ...over };
}

describe("isActiveCallStatus", () => {
  it.each(["initiated", "in_progress", "in-progress", "answered", "IN_PROGRESS", " In_Progress "])(
    "treats %s as active",
    (status) => expect(isActiveCallStatus(status)).toBe(true),
  );

  it.each(["completed", "no_answer", "failed", "cancelled_by_counsellor", "counsellor_no_answer", "", null, undefined])(
    "treats %s as terminal",
    (status) => expect(isActiveCallStatus(status as string | null | undefined)).toBe(false),
  );
});

describe("classifyCloudCallPoll", () => {
  it("keeps a connected call live — the regression that caused simultaneous calls", () => {
    // Student answered: /bridge-b-status sets status=in_progress AND
    // student_connected_at. This used to be read as ended, which made the
    // dialer auto-mark call_back and ring the next lead mid-conversation.
    expect(
      classifyCloudCallPoll(
        row({ status: "in_progress", student_connected_at: "2026-09-22T10:00:00Z" }),
        OPTS,
      ),
    ).toEqual({ kind: "connected" });
  });

  it("keeps a call ringing until the student actually connects", () => {
    expect(classifyCloudCallPoll(row({ status: "initiated" }), OPTS)).toEqual({ kind: "ringing" });
    // in_progress without a student_connected_at is not "connected".
    expect(classifyCloudCallPoll(row({ status: "in_progress" }), OPTS)).toEqual({ kind: "ringing" });
  });

  it("auto-disposes an active row that already carries an outcome", () => {
    expect(classifyCloudCallPoll(row({ status: "initiated", disposition: "busy" }), OPTS)).toEqual({
      kind: "auto-dispose",
      disposition: "busy",
    });
  });

  it("only declares a ringing call stuck past the threshold", () => {
    expect(
      classifyCloudCallPoll(row({ status: "initiated" }), { elapsedMs: 60_000, stuckAfterMs: 8 * 60 * 1000 }),
    ).toEqual({ kind: "ringing" });
    expect(
      classifyCloudCallPoll(row({ status: "initiated" }), { elapsedMs: 9 * 60 * 1000, stuckAfterMs: 8 * 60 * 1000 }),
    ).toEqual({ kind: "auto-dispose", disposition: "not_answered" });
  });

  it("never applies the ringing stuck-timeout to a connected call", () => {
    expect(
      classifyCloudCallPoll(
        row({ status: "in_progress", student_connected_at: "2026-09-22T10:00:00Z" }),
        { elapsedMs: 30 * 60 * 1000, stuckAfterMs: 8 * 60 * 1000 },
      ),
    ).toEqual({ kind: "connected" });
  });

  it("classifies terminal rows", () => {
    expect(
      classifyCloudCallPoll(row({ status: "completed", student_connected_at: "2026-09-22T10:00:00Z" }), OPTS),
    ).toEqual({ kind: "terminal-connected" });
    expect(classifyCloudCallPoll(row({ status: "no_answer", disposition: "not_answered" }), OPTS)).toEqual({
      kind: "terminal-auto",
      disposition: "not_answered",
    });
    expect(classifyCloudCallPoll(row({ status: "completed" }), OPTS)).toEqual({ kind: "terminal-bare" });
  });

  it("walks a full cloud call without ever ending it early", () => {
    const stuckAfterMs = 8 * 60 * 1000;
    const at = (elapsedMs: number) => ({ elapsedMs, stuckAfterMs });

    // 1. Placed — counsellor phone ringing.
    expect(classifyCloudCallPoll(row({ status: "initiated" }), at(3_000))).toEqual({ kind: "ringing" });
    // 2. Counsellor picked up, student leg now dialing (parent stays initiated).
    expect(classifyCloudCallPoll(row({ status: "initiated" }), at(10_000))).toEqual({ kind: "ringing" });
    // 3. Student answered — /bridge-b-status writes status=in_progress.
    const connected = row({ status: "in_progress", student_connected_at: "2026-09-22T10:00:00Z" });
    expect(classifyCloudCallPoll(connected, at(20_000))).toEqual({ kind: "connected" });
    // 4. Mid-conversation, well past the ring timeout — still connected.
    //    (This is where the old code flipped to "ended" and dialed the next lead.)
    expect(classifyCloudCallPoll(connected, at(30 * 60 * 1000))).toEqual({ kind: "connected" });
    // 5. Student hangs up — only now does it become terminal.
    expect(
      classifyCloudCallPoll(
        row({ status: "completed", student_connected_at: "2026-09-22T10:00:00Z" }),
        at(31 * 60 * 1000),
      ),
    ).toEqual({ kind: "terminal-connected" });
  });
});

describe("isCancelledDisposition", () => {
  it("recognises cancellations that must not be logged as call outcomes", () => {
    expect(isCancelledDisposition("cancelled")).toBe(true);
    expect(isCancelledDisposition("cancelled_by_counsellor")).toBe(true);
    expect(isCancelledDisposition("not_answered")).toBe(false);
    expect(isCancelledDisposition(null)).toBe(false);
  });
});

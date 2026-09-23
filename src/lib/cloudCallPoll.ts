/**
 * Pure classification of an `ai_call_records` row for the Cloud Dialer poll.
 *
 * Extracted from CloudDialer so the state machine can be unit-tested directly.
 * The bug this guards against — a connected bridge call being read as ended,
 * which made the dialer place the next call while the counsellor was still
 * talking — was a branch decision, not a rendering detail, so it belongs here
 * where a test can hit it.
 *
 * Status ownership (see voice-agent/server.ts):
 *   - `initiated`   — Call.create accepted; counsellor leg ringing / student
 *                     leg dialing.
 *   - `in_progress` — set by /bridge-b-status the moment the STUDENT answers.
 *   - anything else — terminal (completed / no_answer / failed /
 *                     cancelled_by_counsellor / counsellor_no_answer).
 */

export const ACTIVE_CALL_STATUSES = [
  "initiated",
  "in_progress",
  "in-progress",
  "answered",
] as const;

const ACTIVE = new Set<string>(ACTIVE_CALL_STATUSES);

export function isActiveCallStatus(status: string | null | undefined): boolean {
  return ACTIVE.has(String(status ?? "").trim().toLowerCase());
}

const CANCELLED_DISPOSITIONS = new Set(["cancelled", "cancelled_by_counsellor"]);

/** Cancellation is not a call outcome and must not be logged as a disposition. */
export function isCancelledDisposition(disposition: string | null | undefined): boolean {
  return CANCELLED_DISPOSITIONS.has(String(disposition ?? "").toLowerCase());
}

export interface CloudCallPollRow {
  status: string | null;
  disposition: string | null;
  student_connected_at: string | null;
}

export type CloudCallPollPhase =
  /** Student answered; the call is live. */
  | { kind: "connected" }
  /** Active, not connected, not stuck — keep waiting. */
  | { kind: "ringing" }
  /** Active row already carries an outcome (e.g. busy/voicemail during ringing). */
  | { kind: "auto-dispose"; disposition: string }
  /** Call ended after connecting, no disposition recorded. */
  | { kind: "terminal-connected" }
  /** Call ended with an auto disposition. */
  | { kind: "terminal-auto"; disposition: string }
  /** Call ended, never connected, no disposition. */
  | { kind: "terminal-bare" };

export function classifyCloudCallPoll(
  row: CloudCallPollRow,
  opts: { elapsedMs: number; stuckAfterMs: number },
): CloudCallPollPhase {
  if (isActiveCallStatus(row.status)) {
    if (row.student_connected_at && !row.disposition) return { kind: "connected" };
    if (row.disposition) return { kind: "auto-dispose", disposition: row.disposition };
    // Still ringing past the stuck threshold: the voice-agent context was lost
    // and bridge-hangup will never update the row. Treat it as unanswered.
    if (opts.elapsedMs > opts.stuckAfterMs) return { kind: "auto-dispose", disposition: "not_answered" };
    return { kind: "ringing" };
  }

  if (row.student_connected_at && !row.disposition) return { kind: "terminal-connected" };
  if (row.disposition) return { kind: "terminal-auto", disposition: row.disposition };
  return { kind: "terminal-bare" };
}

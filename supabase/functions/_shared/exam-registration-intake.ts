// Inbound handling for the automated entrance-exam registration check.
//
// The cron sends `exam_registration_check` (two quick-reply buttons) to leads
// whose exam registration status is 'unknown'. This module interprets the
// candidate's reply:
//   • "Not registered yet"  → status = not_registered
//   • "Yes, registered"     → status = registered_no_number, ask for the number
//   • next plausible number → status = registered, registration_no captured
//
// It is deliberately conservative on free-text capture so it never hijacks a
// normal conversation: a number is only recorded when the lead has a row that
// is explicitly awaiting one (registered_no_number, no number yet, asked
// recently).

interface AdminLike {
  from: (table: string) => any;
}

interface ExamRow {
  id: string;
  exam_code: string;
  status: string;
  registration_no: string | null;
  asked_at: string | null;
  answered_at: string | null;
}

const AWAITING_NUMBER_WINDOW_HOURS = 72;

function withinHours(ts: string | null, hours: number): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= hours * 3600 * 1000;
}

/** A plausible exam registration / roll number: 4–30 chars, alphanumeric with
 *  optional / and -, and at least one digit. Rejects prose replies. */
export function looksLikeRegNo(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 30) return false;
  if (/\s/.test(t)) return false;
  if (!/[0-9]/.test(t)) return false;
  return /^[A-Za-z0-9/\-]+$/.test(t);
}

export interface IntakeReplyResult {
  handled: boolean;
  reply?: string;
  examCode?: string;
  action?: "not_registered" | "registered_no_number" | "registered";
}

export async function handleExamRegistrationIntakeReply(
  admin: AdminLike,
  params: {
    leadId: string | null;
    buttonId?: string | null;
    buttonTitle?: string | null;
    text?: string | null;
    messageType?: string | null;
  },
): Promise<IntakeReplyResult> {
  const { leadId } = params;
  if (!leadId) return { handled: false };

  const btn = `${params.buttonId || ""} ${params.buttonTitle || ""}`.toLowerCase();
  const isNo = /regcheck_no|not[_\s]*regist/.test(btn);
  const isYes = !isNo && (/regcheck_yes/.test(btn) || (/regist/.test(btn) && /yes/.test(btn)));

  // If it's neither a button nor a text message we could parse, bail fast
  // before hitting the DB.
  if (!isNo && !isYes && !(params.messageType === "text" && params.text)) {
    return { handled: false };
  }

  const { data } = await admin
    .from("exam_registrations")
    .select("id, exam_code, status, registration_no, asked_at, answered_at")
    .eq("lead_id", leadId)
    .order("asked_at", { ascending: false, nullsFirst: false });
  const rows: ExamRow[] = data || [];
  if (!rows.length) return { handled: false };

  const nowIso = new Date().toISOString();

  if (isNo || isYes) {
    // Target the row we most recently asked about (still unknown); fall back
    // to the most recently touched row.
    const target = rows.find((r) => r.status === "unknown") || rows[0];
    if (!target) return { handled: false };

    if (isNo) {
      await admin
        .from("exam_registrations")
        .update({ status: "not_registered", answered_at: nowIso })
        .eq("id", target.id);
      return {
        handled: true,
        action: "not_registered",
        examCode: target.exam_code,
        reply: "Thanks for letting us know. Our team will reach out to help with your options.",
      };
    }

    await admin
      .from("exam_registrations")
      .update({ status: "registered_no_number", answered_at: nowIso })
      .eq("id", target.id);
    return {
      handled: true,
      action: "registered_no_number",
      examCode: target.exam_code,
      reply: "Great! Please reply with your registration / roll number so we can note it against your application.",
    };
  }

  // Free-text: only capture when a row is explicitly awaiting a number.
  const awaiting = rows.find(
    (r) => r.status === "registered_no_number" && !r.registration_no && withinHours(r.answered_at, AWAITING_NUMBER_WINDOW_HOURS),
  );
  if (awaiting && looksLikeRegNo(String(params.text))) {
    const regNo = String(params.text).trim();
    await admin
      .from("exam_registrations")
      .update({ status: "registered", registration_no: regNo, registered_at: nowIso, answered_at: nowIso })
      .eq("id", awaiting.id);
    return {
      handled: true,
      action: "registered",
      examCode: awaiting.exam_code,
      reply: `Thank you! We've recorded your registration number (${regNo}) against your application.`,
    };
  }

  return { handled: false };
}

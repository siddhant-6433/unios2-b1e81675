import { supabase } from "@/integrations/supabase/client";
import { visitDayKey } from "@/lib/walkInHistory";

/**
 * Completing a campus visit (scheduled, or logging a previous walk-in) always
 * writes the same four things: the campus_visits row, a visit_completed
 * activity, a mandatory post-visit follow-up, and the follow-up activity.
 * Live desk check-in uses create_walk_in_visit instead.
 */
export interface CompleteVisitInput {
  leadId: string;
  userId: string | null;
  /** null = walk-in (creates a completed campus_visits row instead of updating one). */
  visitId: string | null;
  /** Required for walk-ins; ignored when completing a scheduled visit. */
  campusId?: string | null;
  campusLabel?: string;
  counsellorLabel?: string;
  feedback?: string;
  courseInterest?: string;
  schoolAdmissionType?: string;
  expectedAdmissionDate?: string;
  /** YYYY-MM-DD. Required when logging a previous walk-in (`visitId` is null). */
  visitDate?: string;
  /** YYYY-MM-DD. Mandatory — a visit with no next step is how leads go cold. */
  followupDate: string;
}

export async function completeCampusVisit(input: CompleteVisitInput): Promise<void> {
  const {
    leadId, userId, visitId, campusId, feedback, courseInterest,
    schoolAdmissionType, expectedAdmissionDate, followupDate,
    campusLabel = "Campus", counsellorLabel = "Counsellor", visitDate,
  } = input;

  if (!followupDate) throw new Error("A post-visit follow-up date is required.");

  const feedbackText = [
    feedback ? `Feedback: ${feedback}` : "",
    courseInterest ? `Course Interest: ${courseInterest}` : "",
    schoolAdmissionType ? `Admission Type: ${schoolAdmissionType}` : "",
    expectedAdmissionDate ? `Expected Admission: ${expectedAdmissionDate}` : "",
  ].filter(Boolean).join("\n") || null;

  const isWalkin = !visitId;
  let postVisitId: string | null = visitId;

  if (isWalkin) {
    if (!visitDate) throw new Error("Previous visit date is required.");
    const visitAt = new Date(`${visitDate}T12:00:00`).toISOString();
    const { data: existing } = await supabase
      .from("campus_visits")
      .select("id, visit_date")
      .eq("lead_id", leadId)
      .eq("visit_type", "walk_in");
    if ((existing ?? []).some((row: { visit_date: string }) => visitDayKey(row.visit_date) === visitDate)) {
      throw new Error("A walk-in is already logged for this date.");
    }
    const { data: walkinRow } = await supabase.from("campus_visits").insert({
      lead_id: leadId,
      campus_id: campusId || null,
      scheduled_by: userId,
      visit_date: visitAt,
      status: "completed",
      visit_type: "walk_in",
      feedback: feedbackText,
      checked_in_at: visitAt,
      checked_out_at: visitAt,
    }).select("id").single();
    postVisitId = walkinRow?.id ?? null;
  } else {
    await supabase.from("campus_visits").update({
      status: "completed",
      feedback: feedbackText,
    }).eq("id", visitId);
  }

  const visitCompletedLabel = isWalkin && visitDate
    ? `Previous walk-in visit on ${new Date(`${visitDate}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
    : "Visit";

  await supabase.from("lead_activities").insert({
    lead_id: leadId, user_id: userId, type: "visit_completed",
    description: `${visitCompletedLabel} completed at ${campusLabel}. Attended by ${counsellorLabel}.`
      + `${feedback ? ` Feedback: ${feedback}` : ""}${courseInterest ? ` Course interest: ${courseInterest}` : ""}`,
  });

  await supabase.from("lead_followups").insert({
    lead_id: leadId,
    user_id: userId,
    scheduled_at: new Date(`${followupDate}T10:00:00`).toISOString(),
    type: "call",
    visit_id: postVisitId,
    notes: `Post-visit follow-up${feedback ? `. Visit feedback: ${feedback}` : ""}`,
    status: "pending",
  });

  await supabase.from("lead_activities").insert({
    lead_id: leadId, user_id: userId, type: "followup",
    description: `Post-visit follow-up scheduled for ${new Date(followupDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
  });
}

import { supabase } from "@/integrations/supabase/client";

/**
 * Completing a campus visit (walk-in or scheduled) always writes the same four
 * things: the campus_visits row, a visit_completed activity, a mandatory
 * post-visit follow-up, and the follow-up activity. Both the lead page and the
 * Cloud Dialer call this so the two surfaces can't drift.
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
  /** YYYY-MM-DD. Mandatory — a visit with no next step is how leads go cold. */
  followupDate: string;
}

export async function completeCampusVisit(input: CompleteVisitInput): Promise<void> {
  const {
    leadId, userId, visitId, campusId, feedback, courseInterest,
    schoolAdmissionType, expectedAdmissionDate, followupDate,
    campusLabel = "Campus", counsellorLabel = "Counsellor",
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
    const { data: walkinRow } = await supabase.from("campus_visits").insert({
      lead_id: leadId,
      campus_id: campusId || null,
      scheduled_by: userId,
      visit_date: new Date().toISOString(),
      status: "completed",
      visit_type: "walk_in",
      feedback: feedbackText,
    }).select("id").single();
    postVisitId = walkinRow?.id ?? null;
  } else {
    await supabase.from("campus_visits").update({
      status: "completed",
      feedback: feedbackText,
    }).eq("id", visitId);
  }

  await supabase.from("lead_activities").insert({
    lead_id: leadId, user_id: userId, type: "visit_completed",
    description: `${isWalkin ? "Walk-in visit" : "Visit"} completed at ${campusLabel}. Attended by ${counsellorLabel}.`
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

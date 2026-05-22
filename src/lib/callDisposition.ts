/**
 * Shared disposition pipeline used by LeadDetail and MissedCalls.
 *
 * The logic was previously inline in LeadDetail (`logCallDisposition`). It
 * was extracted so the /missed-calls page can present its own inline
 * call+disposition modal without duplicating the 200-line pipeline.
 *
 * Caller responsibilities (UI-only side effects deliberately kept outside):
 *   - score popups, next-lead prompts, schedule-visit dialog
 *   - tab refresh / query invalidation
 *   - the toast acknowledging the disposition was logged
 *   - any caller-specific bookkeeping (e.g. marking a missed-call resolved)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallDispositionData } from "@/components/admissions/CallDispositionDialog";

export const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead",
  application_in_progress: "Application In Progress",
  application_submitted: "Application Submitted",
  ai_called: "AI Called",
  counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled",
  interview: "Interview",
  offer_sent: "Offer Sent",
  token_paid: "Token Paid",
  pre_admitted: "Pre-Admitted",
  admitted: "Admitted",
  not_interested: "Not Interested",
  ineligible: "Ineligible",
  dnc: "Do Not Contact",
  deferred: "Deferred (Next Session)",
  rejected: "Rejected",
};

export const STAGE_ORDER = [
  "new_lead", "application_in_progress", "application_submitted",
  "ai_called", "counsellor_call", "visit_scheduled", "interview",
  "offer_sent", "token_paid", "pre_admitted", "admitted",
];

const stageIndex = (s: string) => {
  const i = STAGE_ORDER.indexOf(s);
  return i === -1 ? -1 : i;
};

/** Forward-only auto-advance — never rolls a lead backwards or out of a terminal state. */
export const shouldAutoAdvance = (currentStage: string, newStage: string) => {
  if (["rejected", "not_interested", "ineligible", "dnc", "deferred"].includes(currentStage)) return false;
  return stageIndex(newStage) > stageIndex(currentStage);
};

const DISPOSITION_LABELS: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not Interested",
  ineligible: "Ineligible",
  not_answered: "Not Answered",
  wrong_number: "Wrong Number",
  call_back: "Call Back Later",
  do_not_contact: "Do Not Contact",
  voicemail: "Voicemail",
  busy: "Busy",
};

const formatFollowupDate = (iso?: string) => {
  if (!iso) return "the agreed time";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-IN", { weekday: "short" });
  const date = d.getDate();
  const month = d.toLocaleDateString("en-IN", { month: "short" });
  const ord = (n: number) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  return `${day}, ${ord(date)} ${month}`;
};

export interface RecordCallDispositionArgs {
  supabase: SupabaseClient<any, any, any>;
  leadId: string;
  lead: {
    name: string;
    phone: string | null;
    stage: string;
  };
  userId: string | null;
  profileId: string | null;
  courseName?: string | null;
  data: CallDispositionData;
  /** Caller-provided source attribution for the call_log notes column. */
  loggedFromLabel?: string;
}

/**
 * Run the full disposition pipeline:
 *  1. record_cloud_call_log RPC (call_logs entry)
 *  2. Mark pending lead_followups completed
 *  3. Insert lead_activity
 *  4. Auto-advance stage based on disposition
 *  5. Fire auto-WhatsApp template
 *  6. Optionally also send course_info_v4
 *  7. Insert follow-up if scheduled inline
 *
 * Returns void; throws are propagated to the caller. WhatsApp sends are
 * fire-and-forget — failures log to console but don't fail the call.
 */
export async function recordCallDisposition(args: RecordCallDispositionArgs): Promise<void> {
  const { supabase, leadId, lead, userId, profileId, courseName, data, loggedFromLabel } = args;
  const label = DISPOSITION_LABELS[data.disposition] || data.disposition;

  // 1. call_logs via RPC (dedupe + "Cloud Call" classification)
  await (supabase as any).rpc("record_cloud_call_log", {
    p_call_uuid:     crypto.randomUUID(),
    p_lead_id:       leadId,
    p_user_id:       userId,
    p_disposition:   data.disposition,
    p_duration:      data.duration_seconds || 0,
    p_notes:         data.notes || `${label}${loggedFromLabel ? ` (logged from ${loggedFromLabel})` : ""}`,
    p_source:        "manual",
    p_recording_url: null,
    p_call_source:   "manual_log",
  });

  // 2. Close pending follow-ups — the call just happened
  await supabase
    .from("lead_followups")
    .update({ status: "completed", completed_at: new Date().toISOString() } as any)
    .eq("lead_id", leadId)
    .eq("status", "pending");

  // 3. Activity log
  const durationStr = data.duration_seconds > 0
    ? ` (${Math.floor(data.duration_seconds / 60)}m${data.duration_seconds % 60 ? ` ${data.duration_seconds % 60}s` : ""})`
    : "";
  await supabase.from("lead_activities").insert({
    lead_id: leadId, user_id: profileId, type: "call",
    description: `Call: ${label}${durationStr}${data.notes ? ` — ${data.notes}` : ""}`,
  } as any);

  // 4. Auto-advance stage
  const autoAdvance = async (target: string) => {
    if (shouldAutoAdvance(lead.stage, target)) {
      await supabase.from("leads").update({ stage: target as any }).eq("id", leadId);
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: profileId, type: "stage_change",
        description: `Stage auto-advanced from ${STAGE_LABELS[lead.stage] || lead.stage} to ${STAGE_LABELS[target] || target}`,
        old_stage: lead.stage as any, new_stage: target as any,
      } as any);
    }
  };

  if (data.disposition === "interested" || data.disposition === "call_back" || data.disposition === "not_answered") {
    await autoAdvance("counsellor_call");
  } else if (data.disposition === "not_interested") {
    await supabase.from("leads").update({ stage: "not_interested" as any }).eq("id", leadId);
    await supabase.from("lead_activities").insert({
      lead_id: leadId, user_id: profileId, type: "stage_change",
      description: `Stage changed to Not Interested`,
      old_stage: lead.stage as any, new_stage: "not_interested" as any,
    } as any);
  } else if (data.disposition === "do_not_contact") {
    await supabase.from("leads").update({ stage: "dnc" as any }).eq("id", leadId);
    await supabase.from("lead_activities").insert({
      lead_id: leadId, user_id: profileId, type: "stage_change",
      description: `Stage changed to Do Not Contact`,
      old_stage: lead.stage as any, new_stage: "dnc" as any,
    } as any);
  } else if (data.disposition === "ineligible") {
    const newStage = data.future_eligible_session ? "deferred" : "ineligible";
    const updates: Record<string, any> = { stage: newStage as any };
    if (data.future_eligible_session) updates.future_eligible_session = data.future_eligible_session;
    await supabase.from("leads").update(updates).eq("id", leadId);
    const futureNote = data.future_eligible_session ? ` — eligible for ${data.future_eligible_session}` : "";
    await supabase.from("lead_activities").insert({
      lead_id: leadId, user_id: profileId, type: "stage_change",
      description: newStage === "deferred"
        ? `Stage changed to Deferred (Next Session${futureNote})`
        : `Stage changed to Ineligible`,
      old_stage: lead.stage as any, new_stage: newStage as any,
    } as any);
  }

  // 5. Auto-WhatsApp (fire-and-forget — failures don't fail the disposition)
  if (lead.phone && !data.suppress_auto_whatsapp) {
    const course = courseName || "your selected course";
    let autoTemplate: string | null = null;
    let autoParams: string[] = [];

    if (data.disposition === "interested" || data.disposition === "call_back") {
      autoTemplate = "nimt_followup_v2";
      autoParams = [lead.name, formatFollowupDate(data.followup_date)];
    } else if (data.disposition === "not_answered" || data.disposition === "busy" || data.disposition === "voicemail") {
      autoTemplate = "missed_call";
      autoParams = [lead.name, course];
    } else if (data.disposition === "not_interested") {
      autoTemplate = "nimt_not_interested_ack";
      autoParams = [lead.name, course];
    }

    if (autoTemplate) {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken || anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          template_key: autoTemplate,
          phone: lead.phone,
          params: autoParams,
          lead_id: leadId,
        }),
      }).then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error("Auto WA after disposition failed:", body);
        }
      }).catch(e => console.error("Auto WA exception:", e));
    }
  }

  // 6. Optional course-info follow-up
  if (data.send_course_info && lead.phone) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken || anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        template_key: "course_info_v4",
        phone: lead.phone,
        lead_id: leadId,
      }),
    }).catch(e => console.error("course_info_v4 send exception:", e));
  }

  // 7. Inline-scheduled follow-up
  if (data.schedule_followup && data.followup_date) {
    await supabase.from("lead_followups").insert({
      lead_id: leadId,
      user_id: userId,
      scheduled_at: data.followup_date,
      type: "call",
      notes: `Follow-up after ${label}${data.notes ? `: ${data.notes}` : ""}`,
      status: "pending",
    } as any);
    await supabase.from("lead_activities").insert({
      lead_id: leadId, user_id: profileId, type: "followup",
      description: `Follow-up scheduled for ${new Date(data.followup_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    } as any);
  }
}

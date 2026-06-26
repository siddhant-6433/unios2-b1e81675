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

import type { CallDispositionData } from "@/components/admissions/CallDispositionDialog";

import { resolveCallDispositionTransition } from "@/lib/leadTransitions";
export { STAGE_LABELS, STAGE_ORDER, shouldAutoAdvance } from "@/lib/leadStages";

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

type SupabaseRpcError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type SupabaseWriteResult = {
  data: unknown;
  error: SupabaseRpcError | null;
};

type SupabaseTableBuilder = PromiseLike<SupabaseWriteResult> & {
  update: (payload: Record<string, unknown>) => SupabaseTableBuilder;
  insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<SupabaseWriteResult>;
  eq: (column: string, value: unknown) => SupabaseTableBuilder;
  select: (columns: string) => PromiseLike<SupabaseWriteResult>;
};

type DispositionSupabaseClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: SupabaseRpcError | null }>;
  from?: (table: string) => SupabaseTableBuilder;
  auth: {
    getSession: () => PromiseLike<{
      data: { session: { access_token?: string } | null };
    }>;
  };
};

const isLegacyDispositionRpcSignatureError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const rpcError = error as SupabaseRpcError;
  const code = String(rpcError.code || "");
  const message = String(rpcError.message || rpcError.details || "");
  return (
    code === "PGRST202" ||
    (message.includes("record_disposition_writes") &&
      (message.includes("Could not find") ||
       message.includes("p_cnet_appeared") ||
       message.includes("p_cahet_registered")))
  );
};

const isMissingRpcError = (error: unknown, functionName: string) => {
  if (!error || typeof error !== "object") return false;
  const rpcError = error as SupabaseRpcError;
  const code = String(rpcError.code || "");
  const message = String([rpcError.message, rpcError.details, rpcError.hint].filter(Boolean).join(" "));
  return code === "PGRST202" && message.includes(functionName);
};

const isMissingDispositionRpcError = (error: unknown) => isMissingRpcError(error, "record_disposition_writes");

const formatSupabaseErrorMessage = (error: unknown, fallback = "Please try again.") => {
  if (error instanceof Error) return error.message || fallback;
  if (!error || typeof error !== "object") return fallback;
  const rpcError = error as SupabaseRpcError;
  return (
    rpcError.message ||
    rpcError.details ||
    rpcError.hint ||
    rpcError.code ||
    fallback
  );
};

const throwSupabaseError = (error: unknown, context: string): never => {
  const message = formatSupabaseErrorMessage(error, context);
  const err = new Error(message);
  if (error && typeof error === "object") {
    (err as Error & { cause?: unknown }).cause = error;
  }
  throw err;
};

const assertNoError = (error: unknown, context: string) => {
  if (error) throwSupabaseError(error, context);
};

export interface RecordCallDispositionArgs {
  supabase: DispositionSupabaseClient;
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
  /**
   * When the disposition is being saved after a real Cloud Dialer call, pass
   * the voice-agent call_id here so the call_logs row merges onto the same
   * cloud_call_uuid as the auto bridge-hangup webhook (and CallLog.tsx can
   * join ai_call_records.recording_url back onto the row). Omit for paths
   * where no Plivo call was placed (typed-after-the-fact entries).
   */
  callUuid?: string | null;
  /**
   * Channel attribution for the new `source` column. Defaults to "manual_log"
   * when omitted. Pass "cloud_dialer" from any flow that placed a real call
   * via the manual-call edge function.
   */
  callSource?: "cloud_dialer" | "manual_log" | "inbound";
}

interface ResolvedDispositionWrites {
  label: string;
  callActivityDesc: string;
  callNotes: string;
  newStage: string | null;
  stageActivityDesc: string | null;
  futureEligibleSession: string | null;
  followupAt: string | null;
  followupNotes: string | null;
  followupActivityDesc: string | null;
  callUuid: string;
  callSource: "cloud_dialer" | "manual_log" | "inbound";
}

async function legacyRecordCloudCallLog(args: RecordCallDispositionArgs, resolved: ResolvedDispositionWrites) {
  const params: Record<string, unknown> = {
    p_call_uuid: resolved.callUuid,
    p_lead_id: args.leadId,
    p_user_id: args.userId,
    p_disposition: args.data.disposition,
    p_duration: args.data.duration_seconds || 0,
    p_notes: resolved.callNotes,
    p_source: "manual",
    p_recording_url: null,
    p_call_source: resolved.callSource,
  };
  let { error } = await args.supabase.rpc("record_cloud_call_log", params);
  if (error && isMissingRpcError(error, "record_cloud_call_log")) {
    const legacyParams = { ...params };
    delete legacyParams.p_call_source;
    const retry = await args.supabase.rpc("record_cloud_call_log", legacyParams);
    error = retry.error;
  }
  assertNoError(error, "Could not record call log");
}

async function runLegacyDispositionWrites(args: RecordCallDispositionArgs, resolved: ResolvedDispositionWrites) {
  const db = args.supabase.from;
  if (!db) {
    throw new Error("Disposition save RPC is unavailable and this client cannot run fallback writes.");
  }

  await legacyRecordCloudCallLog(args, resolved);

  const shouldClearFollowups = args.data.disposition !== "not_answered";
  if (shouldClearFollowups) {
    const { error } = await db("lead_followups")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("lead_id", args.leadId)
      .eq("status", "pending");
    assertNoError(error, "Could not complete pending follow-ups");
  }

  let result = await db("lead_activities").insert({
    lead_id: args.leadId,
    user_id: args.profileId,
    type: "call",
    description: resolved.callActivityDesc,
  });
  assertNoError(result.error, "Could not record call activity");

  if (args.data.cnet_appeared !== null && args.data.cnet_appeared !== undefined) {
    result = await db("leads")
      .update({ cnet_appeared: args.data.cnet_appeared, updated_at: new Date().toISOString() })
      .eq("id", args.leadId);
    assertNoError(result.error, "Could not save CNET answer");
  }

  if (args.data.cahet_registered !== null && args.data.cahet_registered !== undefined) {
    result = await db("leads")
      .update({ cahet_registered: args.data.cahet_registered, updated_at: new Date().toISOString() })
      .eq("id", args.leadId);
    assertNoError(result.error, "Could not save CAHET answer");
  }

  if (resolved.newStage) {
    const leadPatch: Record<string, unknown> = { stage: resolved.newStage };
    if (resolved.futureEligibleSession) leadPatch.future_eligible_session = resolved.futureEligibleSession;
    result = await db("leads").update(leadPatch).eq("id", args.leadId);
    assertNoError(result.error, "Could not update lead stage");

    result = await db("lead_activities").insert({
      lead_id: args.leadId,
      user_id: args.profileId,
      type: "stage_change",
      description: resolved.stageActivityDesc,
      old_stage: args.lead.stage,
      new_stage: resolved.newStage,
    });
    assertNoError(result.error, "Could not record stage activity");
  }

  if (resolved.followupAt) {
    if (shouldClearFollowups) {
      result = await db("lead_followups").insert({
        lead_id: args.leadId,
        user_id: args.userId,
        scheduled_at: resolved.followupAt,
        type: "call",
        notes: resolved.followupNotes,
        status: "pending",
      });
      assertNoError(result.error, "Could not schedule follow-up");
    } else {
      result = await db("lead_followups")
        .update({ scheduled_at: resolved.followupAt, notes: resolved.followupNotes })
        .eq("lead_id", args.leadId)
        .eq("status", "pending")
        .select("id");
      assertNoError(result.error, "Could not reschedule follow-up");

      if (!Array.isArray(result.data) || result.data.length === 0) {
        result = await db("lead_followups").insert({
          lead_id: args.leadId,
          user_id: args.userId,
          scheduled_at: resolved.followupAt,
          type: "call",
          notes: resolved.followupNotes,
          status: "pending",
        });
        assertNoError(result.error, "Could not schedule follow-up");
      }
    }

    result = await db("lead_activities").insert({
      lead_id: args.leadId,
      user_id: args.profileId,
      type: "followup",
      description: resolved.followupActivityDesc || "Follow-up rescheduled after not answered",
    });
    assertNoError(result.error, "Could not record follow-up activity");
  }
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
  const { supabase, leadId, lead, userId, profileId, data, loggedFromLabel, callUuid, callSource } = args;
  const label = DISPOSITION_LABELS[data.disposition] || data.disposition;

  // Resolve everything the write needs on the client (call wording, stage
  // target, follow-up), then hand it to ONE SECURITY DEFINER RPC that performs
  // every write in a single transaction / single round-trip. This replaces the
  // previous chain of separate awaited writes — each its own trip amplified by
  // per-row can_view_lead RLS on leads / lead_activities / lead_followups —
  // which is what made the save slow. No business logic is ported into SQL;
  // the client still decides everything below and passes the result in.
  const durationStr = data.duration_seconds > 0
    ? ` (${Math.floor(data.duration_seconds / 60)}m${data.duration_seconds % 60 ? ` ${data.duration_seconds % 60}s` : ""})`
    : "";
  const callActivityDesc = `Call: ${label}${durationStr}${data.notes ? ` — ${data.notes}` : ""}`;
  const callNotes = data.notes || `${label}${loggedFromLabel ? ` (logged from ${loggedFromLabel})` : ""}`;

  const transition = resolveCallDispositionTransition({
    currentStage: lead.stage,
    disposition: data.disposition,
    futureEligibleSession: data.future_eligible_session,
  });
  // newStage === null means "no stage change" (the RPC then skips that write).
  const newStage = transition.newStage;
  const stageActivityDesc = transition.activityDescription;
  const futureEligibleSession = transition.futureEligibleSession;

  // Inline-scheduled follow-up — same wording. null followupAt => RPC skips it.
  let followupAt: string | null = null;
  let followupNotes: string | null = null;
  let followupActivityDesc: string | null = null;
  if (data.schedule_followup && data.followup_date) {
    followupAt = data.followup_date;
    followupNotes = `Follow-up after ${label}${data.notes ? `: ${data.notes}` : ""}`;
    followupActivityDesc = `Follow-up scheduled for ${new Date(data.followup_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  }

  const resolved: ResolvedDispositionWrites = {
    label,
    callActivityDesc,
    callNotes,
    newStage,
    stageActivityDesc,
    futureEligibleSession,
    followupAt,
    followupNotes,
    followupActivityDesc,
    callUuid: callUuid || crypto.randomUUID(),
    callSource: callSource || "manual_log",
  };

  // Single round-trip. The RPC reuses record_cloud_call_log internally, so the
  // Cloud Call dedup/merge (recording_url, bridge-hangup webhook row) is intact.
  const rpcParams: Record<string, unknown> = {
    p_call_uuid:               resolved.callUuid,
    p_lead_id:                 leadId,
    p_user_id:                 userId,
    p_profile_id:              profileId,
    p_disposition:             data.disposition,
    p_duration:                data.duration_seconds || 0,
    p_call_notes:              callNotes,
    p_call_source:             resolved.callSource,
    p_call_activity_desc:      callActivityDesc,
    p_old_stage:               lead.stage,
    p_new_stage:               newStage,
    p_stage_activity_desc:     stageActivityDesc,
    p_future_eligible_session: futureEligibleSession,
    p_cnet_appeared:           data.cnet_appeared ?? null,
    p_cahet_registered:        data.cahet_registered ?? null,
    p_followup_at:             followupAt,
    p_followup_notes:          followupNotes,
    p_followup_activity_desc:  followupActivityDesc,
  };
  let { error } = await supabase.rpc("record_disposition_writes", rpcParams);

  // Some deployed DBs may still have the pre-CNET/CAHET RPC signature. Retry
  // that older payload so disposition + follow-up scheduling keep working;
  // the qualifier fields will start persisting once the newer migration lands.
  if (error && isLegacyDispositionRpcSignatureError(error)) {
    const legacyRpcParams = { ...rpcParams };
    delete legacyRpcParams.p_cnet_appeared;
    delete legacyRpcParams.p_cahet_registered;
    console.warn("record_disposition_writes legacy signature detected; retrying without qualifier params.", error);
    const retry = await supabase.rpc("record_disposition_writes", legacyRpcParams);
    error = retry.error;
  }

  // If PostgREST's schema cache or the deployed database signature is behind
  // the frontend, keep counsellors moving by replaying the previous direct
  // write path. Restrict this to missing-function/signature errors so real
  // authorization or constraint failures still surface.
  if (error && isMissingDispositionRpcError(error)) {
    console.warn("record_disposition_writes unavailable; falling back to direct disposition writes.", error);
    await runLegacyDispositionWrites(args, resolved);
    error = null;
  }

  // Writes are atomic now (all-or-nothing); surface a hard failure rather than
  // letting the caller report a save that didn't happen.
  if (error) throwSupabaseError(error, "Could not save call disposition");

  // WhatsApp sends fire only after the writes are confirmed — a failed save no
  // longer triggers a "thanks for your interest" message. Dispatched fully
  // out-of-band so the save never blocked on the session lookup or the
  // edge-function round-trip; genuinely fire-and-forget from here.
  dispatchDispositionWhatsApp(args, label);
}

/**
 * Fire the disposition-driven WhatsApp sends without blocking the caller.
 *
 * Resolves the session token ONCE (the old code called getSession twice, each
 * a potential token-refresh round-trip on the critical save path) and then
 * fires every applicable template. All sends are fire-and-forget: a failure
 * logs to the console but never fails the disposition. Templates and params
 * are unchanged from the previous inline implementation.
 */
function dispatchDispositionWhatsApp(args: RecordCallDispositionArgs, _label: string): void {
  const { supabase, leadId, lead, courseName, data } = args;
  const phone = lead.phone;
  if (!phone) return;

  const sends: { template_key: string; params?: string[] }[] = [];

  // Disposition-based auto template (counsellor can opt out via suppress flag).
  if (!data.suppress_auto_whatsapp) {
    const course = courseName || "your selected course";
    if (data.disposition === "interested" || data.disposition === "call_back") {
      sends.push({ template_key: "nimt_followup_v2", params: [lead.name, formatFollowupDate(data.followup_date)] });
    } else if (data.disposition === "not_answered" || data.disposition === "busy" || data.disposition === "voicemail") {
      sends.push({ template_key: "missed_call", params: [lead.name, course] });
    } else if (data.disposition === "not_interested") {
      sends.push({ template_key: "nimt_not_interested_ack", params: [lead.name, course] });
    }
  }

  // Optional course-info follow-up.
  if (data.send_course_info) {
    sends.push({ template_key: "course_info_v4" });
  }

  if (sends.length === 0) return;

  void (async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    for (const send of sends) {
      const body: Record<string, string | string[]> = { template_key: send.template_key, phone, lead_id: leadId };
      if (send.params) body.params = send.params;
      fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken || anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify(body),
      }).then(async res => {
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error(`Auto WA (${send.template_key}) after disposition failed:`, errBody);
        }
      }).catch(e => console.error(`Auto WA (${send.template_key}) exception:`, e));
    }
  })();
}

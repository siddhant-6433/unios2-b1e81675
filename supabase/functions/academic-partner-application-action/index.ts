import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CREATE_FIELDS = new Set([
  "id", "application_id", "session_id", "status", "course_selections", "full_name",
  "phone", "email", "whatsapp_verified", "fee_amount", "program_category", "flags",
  "completed_sections", "dob", "address", "father", "mother", "guardian",
  "academic_details", "result_status", "extracurricular", "school_details",
]);

// payment_status / payment_ref are settlement-owned (razorpay-payment sets them
// server-side via the admin client). Never accept them from an on-behalf client
// payload — a stale snapshot could otherwise regress a settled application.
const UPDATE_FIELDS = new Set([
  "session_id", "course_selections", "full_name", "email", "dob", "address", "father",
  "mother", "guardian", "academic_details", "result_status", "extracurricular",
  "school_details", "fee_amount", "program_category", "completed_sections", "flags",
]);

function pickAllowed(input: Record<string, unknown>, allowed: Set<string>) {
  return Object.fromEntries(Object.entries(input || {}).filter(([key]) => allowed.has(key)));
}

async function validateToken(db: any, token: string) {
  const { data: row, error } = await db
    .from("apply_magic_tokens")
    .select("token, lead_id, phone, expires_at, revoked_at, mode, actor_user_id, academic_partner_id")
    .eq("token", token)
    .maybeSingle();
  if (error || !row) throw new Error("Invalid on-behalf token");
  if (row.mode !== "academic_partner_on_behalf") throw new Error("Token is not valid for academic partner on-behalf actions");
  if (row.revoked_at) throw new Error("This on-behalf link was revoked");
  if (new Date(row.expires_at) < new Date()) throw new Error("This on-behalf link has expired");
  if (!row.actor_user_id || !row.academic_partner_id) throw new Error("On-behalf token is missing actor context");

  const { data: scoped } = await db.rpc("can_academic_partner_view_mapped_lead", {
    _user_id: row.actor_user_id,
    _lead_id: row.lead_id,
  });
  if (!scoped) throw new Error("This lead is no longer assigned to the academic partner");
  return row;
}

async function audit(db: any, tokenRow: any, action: string, extra: Record<string, unknown> = {}) {
  await db.from("application_on_behalf_audit").insert({
    action,
    lead_id: tokenRow.lead_id,
    actor_user_id: tokenRow.actor_user_id,
    academic_partner_id: tokenRow.academic_partner_id,
    candidate_phone: tokenRow.phone,
    ...extra,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey);

    const { token, action, application_id, application_uuid, payload = {} } = await req.json();
    if (!token) return json({ error: "token required" }, 400);
    if (!["create", "update", "submit"].includes(action)) return json({ error: "unsupported action" }, 400);

    const tokenRow = await validateToken(db, token);

    if (action === "create") {
      const createData = pickAllowed(payload, CREATE_FIELDS) as any;
      createData.lead_id = tokenRow.lead_id;
      createData.phone = tokenRow.phone;
      createData.whatsapp_verified = true;
      createData.status = createData.status || "draft";
      createData.flags = Array.from(new Set([...(createData.flags || []), "academic_partner_on_behalf"]));

      const { data: inserted, error } = await db
        .from("applications")
        .insert(createData)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);

      if (typeof createData.full_name === "string" && createData.full_name.trim()) {
        await db.from("leads").update({
          name: createData.full_name.trim(),
          person_role: "applicant",
        }).eq("id", tokenRow.lead_id);
      }

      await db.from("lead_activities").insert({
        lead_id: tokenRow.lead_id,
        type: "application_started",
        description: `Application ${inserted.application_id} started by academic partner`,
        old_stage: "new_lead",
        new_stage: "application_in_progress",
      });

      await audit(db, tokenRow, "application_created_by_partner", {
        application_uuid: inserted.id,
        application_id: inserted.application_id,
        metadata: { mode: "academic_partner_on_behalf" },
      });

      return json({ application: inserted });
    }

    const appSelector = application_uuid
      ? { column: "id", value: application_uuid }
      : { column: "application_id", value: application_id };
    if (!appSelector.value) return json({ error: "application_id or application_uuid required" }, 400);

    const { data: existing, error: existingErr } = await db
      .from("applications")
      .select("id, application_id, lead_id, status, payment_status")
      .eq(appSelector.column, appSelector.value)
      .maybeSingle();
    if (existingErr || !existing) return json({ error: "Application not found" }, 404);
    if (existing.lead_id !== tokenRow.lead_id) return json({ error: "Application is not linked to this assigned lead" }, 403);

    if (action === "update") {
      const updateData = pickAllowed(payload, UPDATE_FIELDS);
      const { data: updated, error } = await db
        .from("applications")
        .update(updateData)
        .eq("id", existing.id)
        .eq("lead_id", tokenRow.lead_id)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);

      if (typeof (updateData as any).full_name === "string" && (updateData as any).full_name.trim()) {
        await db.from("leads").update({
          name: (updateData as any).full_name.trim(),
          person_role: "applicant",
        }).eq("id", tokenRow.lead_id);
      }

      await audit(db, tokenRow, "application_edited_by_partner", {
        application_uuid: existing.id,
        application_id: existing.application_id,
        metadata: { fields: Object.keys(updateData) },
      });

      return json({ application: updated });
    }

    const submittedAt = new Date().toISOString();
    const completedSections = {
      ...((payload.completed_sections as Record<string, unknown>) || {}),
      review: true,
    };
    const { data: submitted, error } = await db
      .from("applications")
      .update({
        status: "submitted",
        submitted_at: submittedAt,
        completed_sections: completedSections,
      })
      .eq("id", existing.id)
      .eq("lead_id", tokenRow.lead_id)
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 400);

    const { data: lead } = await db.from("leads").select("stage").eq("id", tokenRow.lead_id).single();
    const advanceableStages = ["new_lead", "ai_called", "counsellor_call", "application_in_progress", "application_fee_paid", "not_interested", "deferred"];
    if (lead && advanceableStages.includes(lead.stage)) {
      await db.from("leads").update({
        stage: "application_submitted",
        application_progress: { personal_details: true, education_details: true, application_fee_paid: true, documents_uploaded: true },
      }).eq("id", tokenRow.lead_id);
      await db.from("lead_activities").insert({
        lead_id: tokenRow.lead_id,
        type: "application_submitted",
        description: `Application ${existing.application_id} submitted by academic partner`,
        old_stage: lead.stage,
        new_stage: "application_submitted",
      });
    }

    await audit(db, tokenRow, "application_submitted_by_partner", {
      application_uuid: existing.id,
      application_id: existing.application_id,
      metadata: { submitted_at: submittedAt },
    });

    return json({ application: submitted });
  } catch (err: any) {
    console.error("[academic-partner-application-action]", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});

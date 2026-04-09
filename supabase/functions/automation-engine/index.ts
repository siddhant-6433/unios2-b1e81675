/**
 * Automation Engine v2
 * ─────────────────────────────────────────────────────────────
 * Evaluates automation rules against a trigger event and executes matching actions.
 *
 * Triggers: stage_change, lead_created, lead_assigned, activity_created,
 *           followup_overdue, time_elapsed, visit_scheduled, visit_completed
 *
 * Actions: send_whatsapp, send_email, advance_stage, schedule_followup,
 *          assign_counsellor, create_notification, update_field, add_tag
 *
 * Conditions: source, campus, course, temperature, stage (from/to), has_email, has_counsellor
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader?.replace("Bearer ", "") || "";

    // Accept cron secret OR service role key OR valid user auth
    if (cronSecret !== expectedSecret && token !== serviceRoleKey && !authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const payload = await req.json();
    const { trigger_type, lead_id, old_stage, new_stage, activity_type, counsellor_id } = payload;

    if (!trigger_type || !lead_id) {
      return new Response(JSON.stringify({ error: "trigger_type and lead_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch matching active rules
    const { data: rules } = await admin
      .from("automation_rules")
      .select("*")
      .eq("is_active", true)
      .eq("trigger_type", trigger_type)
      .order("priority", { ascending: false });

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ matched: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get full lead data with joins
    const { data: lead } = await admin
      .from("leads")
      .select(`
        id, name, phone, email, stage, source, counsellor_id, course_id, campus_id,
        application_id, lead_temperature, lead_score,
        courses:course_id(name, code),
        campuses:campus_id(name, code)
      `)
      .eq("id", lead_id)
      .single();

    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve counsellor's auth user_id from profiles.id
    // (leads.counsellor_id → profiles.id, but notifications/followups need auth.users.id)
    let counsellorAuthUserId: string | null = null;
    if (lead.counsellor_id) {
      const { data: cp } = await admin.from("profiles").select("user_id").eq("id", lead.counsellor_id).single();
      counsellorAuthUserId = cp?.user_id || null;
    }

    let executedCount = 0;

    for (const rule of rules) {
      const config = rule.trigger_config as Record<string, any> || {};
      const conditions = config.conditions || {};

      // ── Evaluate trigger match ──
      let matches = false;

      switch (trigger_type) {
        case "stage_change":
          matches = true;
          if (config.to_stage && config.to_stage !== new_stage) matches = false;
          if (config.from_stage && config.from_stage !== old_stage) matches = false;
          break;

        case "lead_created":
          matches = true;
          break;

        case "lead_assigned":
          matches = true;
          break;

        case "activity_created":
          if (config.activity_type) {
            matches = config.activity_type === activity_type;
          } else {
            matches = true; // match any activity
          }
          break;

        case "followup_overdue":
        case "time_elapsed":
        case "visit_scheduled":
        case "visit_completed":
          matches = true;
          break;
      }

      if (!matches) continue;

      // ── Evaluate conditions (filters) ──
      if (rule.campus_id && rule.campus_id !== lead.campus_id) continue;

      if (conditions.source && conditions.source !== lead.source) continue;
      if (conditions.temperature && conditions.temperature !== lead.lead_temperature) continue;
      if (conditions.has_email === true && !lead.email) continue;
      if (conditions.has_email === false && lead.email) continue;
      if (conditions.has_counsellor === true && !lead.counsellor_id) continue;
      if (conditions.has_counsellor === false && lead.counsellor_id) continue;
      if (conditions.min_score && lead.lead_score < conditions.min_score) continue;

      // ── Check dedup: don't fire same rule for same lead within cooldown ──
      const cooldownHours = config.cooldown_hours || 24;
      const cooldownSince = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();
      const { count: recentExecs } = await admin
        .from("automation_rule_executions")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", rule.id)
        .eq("lead_id", lead.id)
        .gte("created_at", cooldownSince);
      if ((recentExecs || 0) > 0) continue;

      // ── Execute actions ──
      const actions = (rule.actions as any[]) || [];
      const executedActions: any[] = [];
      let status = "success";
      let errorMessage: string | null = null;

      const courseName = (lead as any).courses?.name || "our programmes";
      const campusName = (lead as any).campuses?.name || "our campus";

      for (const action of actions) {
        try {
          switch (action.type) {
            case "send_whatsapp": {
              if (!lead.phone) break;
              const params = action.params_template
                ? action.params_template.map((p: string) =>
                    p.replace("{{name}}", lead.name)
                     .replace("{{course}}", courseName)
                     .replace("{{campus}}", campusName)
                     .replace("{{source}}", lead.source || "")
                     .replace("{{app_id}}", lead.application_id || "N/A")
                  )
                : [lead.name, courseName, lead.source || "website"];

              await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({
                  template_key: action.template_key,
                  phone: lead.phone,
                  params,
                  lead_id: lead.id,
                }),
              });
              executedActions.push({ type: "send_whatsapp", template: action.template_key });
              break;
            }

            case "send_email": {
              if (!lead.email) break;
              const resendKey = Deno.env.get("RESEND_API_KEY");
              const emailFrom = Deno.env.get("EMAIL_FROM") || "NIMT UniOs <onboarding@resend.dev>";
              if (!resendKey) break;

              // Fetch template from DB
              const { data: tpl } = await admin
                .from("email_templates")
                .select("subject, body_html")
                .eq("slug", action.template_slug)
                .eq("is_active", true)
                .single();

              if (tpl) {
                let subject = tpl.subject;
                let body = tpl.body_html;
                const vars: Record<string, string> = {
                  student_name: lead.name, course_name: courseName,
                  campus_name: campusName, application_id: lead.application_id || "",
                };
                for (const [k, v] of Object.entries(vars)) {
                  subject = subject.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
                  body = body.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
                }

                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ from: emailFrom, to: [lead.email], subject, html: body }),
                });
                executedActions.push({ type: "send_email", template: action.template_slug });
              }
              break;
            }

            case "advance_stage": {
              if (!action.to_stage) break;
              await admin.from("leads").update({ stage: action.to_stage }).eq("id", lead.id);
              await admin.from("lead_activities").insert({
                lead_id: lead.id,
                type: "stage_change",
                description: `Stage auto-advanced to ${action.to_stage} by automation: ${rule.name}`,
                old_stage: lead.stage,
                new_stage: action.to_stage,
              });
              executedActions.push({ type: "advance_stage", to: action.to_stage });
              break;
            }

            case "schedule_followup": {
              const delayHours = action.delay_hours || 24;
              const scheduledAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
              await admin.from("lead_followups").insert({
                lead_id: lead.id,
                user_id: counsellorAuthUserId || null,
                scheduled_at: scheduledAt,
                type: action.followup_type || "call",
                notes: `Auto-scheduled by automation: ${rule.name}`,
                status: "pending",
              });
              executedActions.push({ type: "schedule_followup", at: scheduledAt });
              break;
            }

            case "create_notification": {
              const targetUser = action.notify_counsellor
                ? counsellorAuthUserId
                : action.user_id;
              if (!targetUser) break;
              await admin.from("notifications").insert({
                user_id: targetUser,
                type: action.notification_type || "general",
                title: (action.title || "Automation alert")
                  .replace("{{name}}", lead.name)
                  .replace("{{stage}}", lead.stage || ""),
                body: (action.body || "")
                  .replace("{{name}}", lead.name)
                  .replace("{{course}}", courseName),
                link: `/admissions/${lead.id}`,
                lead_id: lead.id,
              });
              executedActions.push({ type: "create_notification" });
              break;
            }

            case "update_field": {
              if (!action.field || action.value === undefined) break;
              const allowed = ["lead_temperature", "notes", "stage"];
              if (!allowed.includes(action.field)) break;
              await admin.from("leads").update({ [action.field]: action.value }).eq("id", lead.id);
              executedActions.push({ type: "update_field", field: action.field, value: action.value });
              break;
            }

            case "assign_counsellor": {
              if (!action.counsellor_id) break;
              await admin.from("leads").update({ counsellor_id: action.counsellor_id }).eq("id", lead.id);
              executedActions.push({ type: "assign_counsellor", to: action.counsellor_id });
              break;
            }
          }
        } catch (actionErr: any) {
          console.error(`Action ${action.type} failed:`, actionErr.message);
          status = "partial";
          errorMessage = actionErr.message;
        }
      }

      // Log execution
      if (executedActions.length > 0) {
        await admin.from("automation_rule_executions").insert({
          rule_id: rule.id,
          lead_id: lead.id,
          actions_executed: executedActions,
          status,
          error_message: errorMessage,
        });
        executedCount++;
      }
    }

    return new Response(
      JSON.stringify({ matched: executedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Automation engine error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

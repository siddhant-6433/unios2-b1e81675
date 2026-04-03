import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth via cron secret or user auth
    const cronSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");

    if (cronSecret !== expectedSecret && !authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { trigger_type, lead_id, old_stage, new_stage, activity_type } = await req.json();

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

    // Get lead data
    const { data: lead } = await admin
      .from("leads")
      .select("id, name, phone, stage, counsellor_id, course_id, campus_id, application_id")
      .eq("id", lead_id)
      .single();

    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let executedCount = 0;

    for (const rule of rules) {
      const config = rule.trigger_config as Record<string, any>;
      let matches = false;

      // Check trigger conditions
      if (trigger_type === "stage_change") {
        if (config.to_stage && config.to_stage === new_stage) matches = true;
        if (config.from_stage && config.from_stage !== old_stage) matches = false;
      } else if (trigger_type === "activity_created") {
        if (config.activity_type && config.activity_type === activity_type) matches = true;
      }

      if (!matches) continue;
      if (rule.campus_id && rule.campus_id !== lead.campus_id) continue;

      // Execute actions
      const actions = (rule.actions as any[]) || [];
      const executedActions: any[] = [];
      let status = "success";
      let errorMessage = null;

      for (const action of actions) {
        try {
          if (action.type === "send_whatsapp" && lead.phone) {
            const params = [lead.name, lead.application_id || "N/A"];
            await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-cron-secret": expectedSecret || "",
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
          } else if (action.type === "advance_stage" && action.to_stage) {
            await admin.from("leads").update({ stage: action.to_stage }).eq("id", lead.id);
            await admin.from("lead_activities").insert({
              lead_id: lead.id,
              type: "stage_change",
              description: `Stage auto-advanced to ${action.to_stage} by automation: ${rule.name}`,
              old_stage: lead.stage,
              new_stage: action.to_stage,
            });
            executedActions.push({ type: "advance_stage", to: action.to_stage });
          } else if (action.type === "schedule_followup") {
            const scheduledAt = new Date(Date.now() + (action.delay_hours || 24) * 60 * 60 * 1000).toISOString();
            await admin.from("lead_followups").insert({
              lead_id: lead.id,
              scheduled_at: scheduledAt,
              type: action.followup_type || "call",
              notes: `Auto-scheduled by automation: ${rule.name}`,
              status: "pending",
            });
            executedActions.push({ type: "schedule_followup", at: scheduledAt });
          }
        } catch (actionErr: any) {
          status = "partial";
          errorMessage = actionErr.message;
        }
      }

      // Log execution
      await admin.from("automation_rule_executions").insert({
        rule_id: rule.id,
        lead_id: lead.id,
        actions_executed: executedActions,
        status,
        error_message: errorMessage,
      });

      executedCount++;
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

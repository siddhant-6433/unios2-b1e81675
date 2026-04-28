import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lead_id } = await req.json();
    if (!lead_id) throw new Error("lead_id is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch lead details
    const { data: lead, error: leadErr } = await supabase
      .from("leads").select("*, courses:course_id(name), campuses:campus_id(name)")
      .eq("id", lead_id).single();

    if (leadErr || !lead) throw new Error("Lead not found");
    if (lead.stage === "dnc") throw new Error("Lead is DNC — call blocked");

    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Use AI to generate a qualification assessment
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an admission counsellor AI assistant for NIMT Group of Institutions. 
You're helping qualify a new lead by assessing their interest and readiness.
Based on the lead information, generate a brief qualification summary including:
1. Interest Level (High/Medium/Low)
2. Key talking points for the counsellor
3. Recommended next action
Keep it concise (under 150 words).`
          },
          {
            role: "user",
            content: `Lead: ${lead.name}
Phone: ${lead.phone}
Course Interest: ${(lead.courses as any)?.name || "Not specified"}
Campus: ${(lead.campuses as any)?.name || "Not specified"}
Source: ${lead.source}
Guardian: ${lead.guardian_name || "Not provided"}
Notes: ${lead.notes || "None"}`
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted, please top up" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const aiData = await aiResponse.json();
    const qualification = aiData.choices?.[0]?.message?.content || "Unable to generate assessment";

    // Extract conversion probability from AI response
    const probMatch = qualification.match(/conversion probability[:\s]*(\d+)%/i);
    const convProb = probMatch ? parseInt(probMatch[1]) : null;

    // Tag lead as AI called (don't change stage — AI call is an activity, not a stage)
    await supabase.from("leads").update({
      ai_called: true,
      ai_notes: qualification,
      ai_called_at: new Date().toISOString(),
      ai_conversion_probability: convProb,
    }).eq("id", lead_id);

    // Log activity with AI assessment
    await supabase.from("lead_activities").insert({
      lead_id, type: "ai_call",
      description: `AI qualification completed:\n${qualification}`,
    });

    // Add as a note for counsellor reference
    await supabase.from("lead_notes").insert({
      lead_id,
      content: `🤖 AI Qualification Assessment:\n${qualification}`,
    });

    return new Response(JSON.stringify({ success: true, qualification }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-first-call error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

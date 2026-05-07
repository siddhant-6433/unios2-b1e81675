/**
 * One-off submission for the two AI-call WhatsApp templates:
 *   1. ai_call_post_summary    — sent at end of an answered AI call
 *      ("as discussed on our call, here are the details for ...")
 *   2. ai_missed_call_followup — sent when AI couldn't reach the lead
 *      ("Hi Navya here, I tried calling you regarding ...")
 *
 * Both UTILITY category so they send without the 24h reply window.
 *
 * Run once with `supabase functions deploy submit-ai-call-templates`
 * then invoke. Idempotent — Meta returns "already exists" if rerun.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES = [
  {
    name: "ai_call_post_summary",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, as discussed on our call, here are the details for {{2}} at NIMT Educational Institutions:\n\n🏫 Campus: {{3}}\n📄 Course details: {{4}}\n📝 Apply now: {{5}}\n🎥 Watch course video: {{6}}\n\nReply to this message for any questions, or our admissions team will reach out shortly.",
        example: {
          body_text: [[
            "Vidhan",
            "BSc Nursing",
            "Greater Noida",
            "https://www.nimt.ac.in/courses/bsc-nursing",
            "https://uni.nimt.ac.in/apply/nimt",
            "https://youtu.be/CyLpFGx67u4",
          ]],
        },
      },
    ],
  },
  {
    name: "ai_missed_call_followup",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi {{1}}, this is Navya from NIMT Educational Institutions. I tried calling you regarding your enquiry about {{2}}.\n\nPlease feel free to call back at {{3}} during 9 AM-8 PM IST.\n\n📄 Course information: {{4}}\n🎥 Watch course video: {{5}}\n\nLooking forward to assisting you with your admission journey.",
        example: {
          body_text: [[
            "Vidhan",
            "BSc Nursing",
            "+91 80353-74903",
            "https://www.nimt.ac.in/courses/bsc-nursing",
            "https://youtu.be/CyLpFGx67u4",
          ]],
        },
      },
    ],
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");

    if (!wabaId || !waToken) {
      return new Response(JSON.stringify({ error: "WA not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    for (const tpl of TEMPLATES) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?access_token=${waToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tpl),
        }
      );
      const data = await res.json();
      results.push({
        name: tpl.name,
        ok: res.ok,
        http_status: res.status,
        response: data,
      });
    }

    return new Response(JSON.stringify({ results }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

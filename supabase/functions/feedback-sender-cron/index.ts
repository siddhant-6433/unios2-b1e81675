import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/*
  Feedback Sender Cron
  Runs every 30 minutes.
  Picks up feedback_responses with status='pending_send' and sends WhatsApp feedback requests.
*/

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const whatsappToken = Deno.env.get("WHATSAPP_API_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!whatsappToken || !phoneNumberId) {
    return new Response(JSON.stringify({ error: "WhatsApp not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Get pending feedback requests
    const { data: pending, error } = await supabase
      .from("feedback_responses")
      .select("id, lead_id, counsellor_id, interaction_type, leads!inner(name, phone)")
      .eq("status", "pending_send")
      .limit(20);

    if (error) throw error;
    if (!pending?.length) {
      return new Response(JSON.stringify({ message: "No pending feedback", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up counsellor display names in one round-trip so we can name the
    // advisor in the WhatsApp body (matches the screenshot).
    const counsellorIds = [...new Set((pending as any[]).map((p) => p.counsellor_id).filter(Boolean))];
    const counsellorNameById: Record<string, string> = {};
    if (counsellorIds.length) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", counsellorIds);
      for (const p of profileRows || []) {
        counsellorNameById[(p as any).id] = (p as any).display_name || "our counsellor";
      }
    }

    let sent = 0;

    for (const fb of pending as any[]) {
      const lead = fb.leads;
      if (!lead?.phone) continue;

      const phone = lead.phone.replace(/[^0-9]/g, "");
      const waPhone = phone.startsWith("91") ? phone : `91${phone}`;
      const counsellorName = counsellorNameById[fb.counsellor_id] || "our counsellor";

      // Send via the Meta-approved `counsellor_feedback` template so delivery
      // works outside the 24h session window. Body params: lead name,
      // counsellor name. Each quick-reply button carries a payload that
      // whatsapp-webhook parses (`feedback_good_<id>` / `feedback_bad_<id>`)
      // to update this feedback_responses row.
      const previewBody =
        `Hi ${lead.name}, we noticed you just had an interaction with our counsellor, ${counsellorName}. We'd love to know how it went! Your feedback means a lot to us. How was your experience?`;

      const templatePayload = {
        messaging_product: "whatsapp",
        to: waPhone,
        type: "template",
        template: {
          name: "counsellor_feedback",
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: lead.name },
                { type: "text", text: counsellorName },
              ],
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: "0",
              parameters: [{ type: "payload", payload: `feedback_good_${fb.id}` }],
            },
            {
              type: "button",
              sub_type: "quick_reply",
              index: "1",
              parameters: [{ type: "payload", payload: `feedback_bad_${fb.id}` }],
            },
          ],
        },
      };

      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsappToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(templatePayload),
          }
        );

        const result = await res.json();

        if (res.ok) {
          const waMessageId = result?.messages?.[0]?.id || null;

          await supabase
            .from("feedback_responses")
            .update({ status: "sent", sent_at: new Date().toISOString(), wa_message_id: waMessageId })
            .eq("id", fb.id);

          await supabase.from("whatsapp_messages").insert({
            lead_id: fb.lead_id,
            wa_message_id: waMessageId,
            direction: "outbound",
            phone: waPhone,
            message_type: "template",
            content: `${previewBody}\n[Good] [Bad]`,
            status: "sent",
            is_read: true,
            template_key: "counsellor_feedback",
          });

          sent++;
        } else {
          console.error("Feedback WA failed:", result?.error?.message);
          // Mark as sent so the cron doesn't retry forever (session window
          // likely closed). The lead is still under cooldown so they won't be
          // re-sampled for 3 days.
          await supabase
            .from("feedback_responses")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", fb.id);
        }
      } catch (e) {
        console.error("Feedback send error:", e);
      }
    }

    return new Response(
      JSON.stringify({ message: `Sent ${sent} feedback requests`, sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Feedback sender error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

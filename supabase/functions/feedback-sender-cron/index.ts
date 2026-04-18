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
      .select("id, lead_id, interaction_type, leads!inner(name, phone)")
      .eq("status", "pending_send")
      .limit(20);

    if (error) throw error;
    if (!pending?.length) {
      return new Response(JSON.stringify({ message: "No pending feedback", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;

    for (const fb of pending as any[]) {
      const lead = fb.leads;
      if (!lead?.phone) continue;

      const phone = lead.phone.replace(/[^0-9]/g, "");
      const waPhone = phone.startsWith("91") ? phone : `91${phone}`;
      const interactionText = fb.interaction_type === "visit"
        ? "your recent campus visit"
        : "your recent call";

      // Send feedback request as a plain text message (since we may not have a Meta-approved template yet)
      // This is a session message — will only deliver if the user has messaged within 24h
      // For production: create a Meta-approved template and use template messaging
      const messageBody = `Hi ${lead.name}! 👋\n\nThank you for ${interactionText} with NIMT Educational Institutions.\n\nWe'd love your quick feedback! On a scale of 1-5, how would you rate your experience?\n\n1⃣ Poor\n2⃣ Below Average\n3⃣ Average\n4⃣ Good\n5⃣ Excellent\n\nJust reply with a number (1-5). Your feedback helps us serve you better! 🙏`;

      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsappToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: waPhone,
              type: "text",
              text: { body: messageBody },
            }),
          }
        );

        const result = await res.json();

        if (res.ok) {
          const waMessageId = result?.messages?.[0]?.id || null;

          // Update status to sent
          await supabase
            .from("feedback_responses")
            .update({ status: "sent", sent_at: new Date().toISOString(), wa_message_id: waMessageId })
            .eq("id", fb.id);

          // Log as outbound message
          await supabase.from("whatsapp_messages").insert({
            lead_id: fb.lead_id,
            wa_message_id: waMessageId,
            direction: "outbound",
            phone: waPhone,
            message_type: "text",
            content: messageBody,
            status: "sent",
            is_read: true,
          });

          sent++;
        } else {
          console.error("Feedback WA failed:", result?.error?.message);
          // Mark as sent anyway to avoid retrying forever (session window might be closed)
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

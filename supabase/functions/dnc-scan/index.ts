import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DNC_PATTERNS = /\b(stop|unsubscribe|opt.?out|do not contact|dont contact|don'?t contact|not interested|nahi chahiye|mujhe nahi chahiye|remove me|block me|dnc|irritating|irritate|stop calling|stop messaging|stop whatsapp|band karo|chhodiye|chhodo|mat karo|pareshan|hata do|hatao|disturb|disturbing|leave me|leave us|go away|no more calls|no more messages|mat bhejo|call mat karo|message mat karo|whatsapp mat karo)\b/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const apply = body.apply === true; // dry_run by default

    // Fetch all inbound messages in batches
    const PAGE_SIZE = 1000;
    let offset = 0;
    const matches: {
      phone: string;
      lead_id: string | null;
      lead_name: string | null;
      current_stage: string | null;
      message: string;
      sent_at: string;
    }[] = [];

    while (true) {
      const { data: msgs, error } = await admin
        .from("whatsapp_messages")
        .select("phone, lead_id, content, created_at")
        .eq("direction", "inbound")
        .not("content", "is", null)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      if (!msgs || msgs.length === 0) break;

      for (const msg of msgs as any[]) {
        if (msg.content && DNC_PATTERNS.test(msg.content.trim())) {
          matches.push({
            phone: msg.phone,
            lead_id: msg.lead_id,
            lead_name: null,
            current_stage: null,
            message: msg.content.substring(0, 200),
            sent_at: msg.created_at,
          });
        }
      }

      if (msgs.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // De-duplicate by phone — keep earliest match per phone
    const seen = new Map<string, typeof matches[0]>();
    for (const m of matches) {
      if (!seen.has(m.phone)) seen.set(m.phone, m);
    }
    const unique = Array.from(seen.values());

    // Fetch lead names + current stages
    const leadIds = unique.filter(m => m.lead_id).map(m => m.lead_id!);
    if (leadIds.length > 0) {
      const { data: leads } = await admin
        .from("leads")
        .select("id, name, stage, phone")
        .in("id", leadIds);

      const leadMap = new Map((leads || []).map((l: any) => [l.id, l]));
      for (const m of unique) {
        if (m.lead_id) {
          const l = leadMap.get(m.lead_id) as any;
          if (l) { m.lead_name = l.name; m.current_stage = l.stage; }
        }
      }
    }

    // Also try to find leads for phone-only matches (no lead_id on message)
    const phonesWithoutLead = unique.filter(m => !m.lead_id).map(m => m.phone);
    if (phonesWithoutLead.length > 0) {
      for (const phone of phonesWithoutLead) {
        const normalized = phone.replace(/^91/, "+91");
        const { data: lr } = await admin
          .from("leads")
          .select("id, name, stage")
          .or(`phone.eq.${phone},phone.eq.${normalized},phone.eq.+${phone}`)
          .limit(1);
        if (lr?.[0]) {
          const m = seen.get(phone)!;
          m.lead_id = lr[0].id;
          m.lead_name = lr[0].name;
          m.current_stage = lr[0].stage;
        }
      }
    }

    // Separate: already DNC vs needs action
    const alreadyDnc = unique.filter(m => m.current_stage === "dnc");
    const toMark = unique.filter(m => m.current_stage !== "dnc" && m.lead_id);
    const noLead = unique.filter(m => !m.lead_id);

    const DNC_ACK = "You have been added to our Do Not Contact list. We will not reach out to you via call or WhatsApp going forward. If this was a mistake, please reply START or call us at +91 9555192192.";
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN")!;
    const pnId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;

    const sendDncAck = async (phone: string, leadId: string | null) => {
      const waPhone = phone.replace(/[^0-9]/g, "");
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${pnId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: waPhone, type: "text", text: { body: DNC_ACK } }),
        });
        if (res.ok) {
          const result = await res.json();
          await admin.from("whatsapp_messages").insert({
            lead_id: leadId,
            wa_message_id: result?.messages?.[0]?.id || null,
            direction: "outbound", phone,
            message_type: "text", content: DNC_ACK, status: "sent", is_read: true,
          });
          return true;
        }
      } catch (e) { console.error("DNC ack send error:", e); }
      return false;
    };

    // Apply if requested
    let marked = 0;
    let ackSent = 0;
    if (apply && toMark.length > 0) {
      for (const m of toMark) {
        await admin.from("leads").update({ stage: "dnc" as any }).eq("id", m.lead_id!);
        await admin.from("lead_activities").insert({
          lead_id: m.lead_id,
          type: "stage_change",
          description: `Auto-marked DNC by bulk scan. Trigger message: "${m.message.substring(0, 100)}"`,
          old_stage: m.current_stage as any,
          new_stage: "dnc" as any,
        });
        marked++;
        const sent = await sendDncAck(m.phone, m.lead_id);
        if (sent) ackSent++;
      }
    }

    // send_ack mode: send DNC message to already-marked leads (for retroactive sends)
    let retroAckSent = 0;
    if (body.send_ack === true) {
      const targets = apply ? [...toMark, ...alreadyDnc] : alreadyDnc;
      for (const m of targets) {
        const sent = await sendDncAck(m.phone, m.lead_id);
        if (sent) retroAckSent++;
      }
    }

    return new Response(JSON.stringify({
      dry_run: !apply,
      summary: {
        total_matches: unique.length,
        already_dnc: alreadyDnc.length,
        to_mark: toMark.length,
        no_lead_found: noLead.length,
        marked_now: marked,
        ack_sent: ackSent + retroAckSent,
      },
      to_mark: toMark,
      already_dnc: alreadyDnc,
      no_lead_found: noLead,
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("DNC scan error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

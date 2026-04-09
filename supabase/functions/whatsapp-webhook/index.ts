import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Auto-reply rules: keyword patterns → response
// Matched top-to-bottom; first match wins. Patterns are case-insensitive.
const AUTO_REPLIES: { patterns: RegExp; reply: string }[] = [
  {
    patterns: /^(hi|hello|hey|hii+|hlo|good\s*(morning|evening|afternoon))[\s!.]*$/i,
    reply: "Hi! 👋 Welcome to NIMT Educational Institutions. How can I help you today?\n\n1️⃣ Admission enquiry\n2️⃣ Course information\n3️⃣ Fee structure\n4️⃣ Campus visit\n5️⃣ Talk to a counsellor",
  },
  {
    patterns: /^1$/,
    reply: "Great! To start your admission process, please visit our application portal:\nhttps://uni.nimt.ac.in/apply/nimt\n\nOr reply with your name and course of interest, and our counsellor will reach out to you shortly.",
  },
  {
    patterns: /^2$/,
    reply: "We offer a wide range of courses across Engineering, Management, Law, Pharmacy, Nursing, Education and more.\n\nPlease visit https://nimt.ac.in/courses for the full list, or tell us which course you're interested in!",
  },
  {
    patterns: /^3$/,
    reply: "Our fee structure varies by course and campus. A counsellor will share the detailed fee breakdown for your chosen course.\n\nPlease reply with the course name you're interested in.",
  },
  {
    patterns: /^4$/,
    reply: "We'd love to have you visit our campus! 🏫\n\nPlease share your preferred date and the campus you'd like to visit, and we'll schedule it for you.",
  },
  {
    patterns: /^5$/,
    reply: "Our counsellor will connect with you shortly. If it's urgent, you can call us at 📞 1800-XXX-XXXX (toll free).",
  },
  {
    patterns: /\b(admission|apply|enroll|enrol)\b/i,
    reply: "For admissions, please visit our application portal:\nhttps://uni.nimt.ac.in/apply/nimt\n\nOr share your name, phone number, and course interest — our counsellor will guide you through the process.",
  },
  {
    patterns: /\b(fee|fees|cost|price|charges)\b/i,
    reply: "Our fee structure varies by course and campus. Could you tell us which course you're interested in? A counsellor will share the detailed fee breakdown.",
  },
  {
    patterns: /\b(course|program|programme|branch|stream)\b/i,
    reply: "We offer courses in Engineering, Management, Law, Pharmacy, Nursing, Education, Arts, Science and more.\n\nVisit https://nimt.ac.in/courses or tell us your area of interest!",
  },
  {
    patterns: /\b(visit|campus\s*tour|come\s*to\s*campus)\b/i,
    reply: "We'd love to have you visit! 🏫 Please share your preferred date and campus, and we'll schedule your visit.",
  },
  {
    patterns: /\b(thank|thanks|thanku|thnx|thnks|dhanyawad|shukriya)\b/i,
    reply: "You're welcome! 😊 Feel free to reach out anytime if you have more questions. We're here to help!",
  },
];

Deno.serve(async (req) => {
  // Meta webhook verification (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && token === verifyToken) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const entries = body?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const value = change?.value;
        if (!value) continue;

        // Handle inbound messages
        const messages = value?.messages || [];
        for (const msg of messages) {
          const phone = msg.from; // sender's phone number
          const waMessageId = msg.id;
          const msgType = msg.type || "text";
          const content =
            msg.text?.body ||
            msg.caption ||
            msg.image?.caption ||
            `[${msgType}]`;
          const mediaId = msg.image?.id || msg.document?.id || msg.audio?.id || msg.video?.id || null;
          let mediaUrl: string | null = mediaId;

          // Download media from Meta and upload to Supabase Storage for public access
          if (mediaId) {
            try {
              const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
              // Step 1: Get the temporary download URL from Meta
              const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
                headers: { Authorization: `Bearer ${waToken}` },
              });
              if (mediaRes.ok) {
                const mediaData = await mediaRes.json();
                if (mediaData.url) {
                  // Step 2: Download the actual media bytes (requires auth)
                  const downloadRes = await fetch(mediaData.url, {
                    headers: { Authorization: `Bearer ${waToken}` },
                  });
                  if (downloadRes.ok) {
                    const blob = await downloadRes.blob();
                    const mimeType = mediaData.mime_type || downloadRes.headers.get("content-type") || "application/octet-stream";
                    // Derive file extension from mime type
                    const extMap: Record<string, string> = {
                      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
                      "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
                      "application/pdf": "pdf",
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
                      "application/msword": "doc",
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
                    };
                    const ext = extMap[mimeType] || "bin";
                    const filePath = `${phone}/${Date.now()}_${mediaId}.${ext}`;

                    // Step 3: Upload to Supabase Storage
                    const { error: uploadError } = await admin.storage
                      .from("whatsapp-media")
                      .upload(filePath, blob, { contentType: mimeType, upsert: false });

                    if (!uploadError) {
                      const { data: publicUrlData } = admin.storage
                        .from("whatsapp-media")
                        .getPublicUrl(filePath);
                      mediaUrl = publicUrlData.publicUrl;
                    } else {
                      console.error("Storage upload error:", uploadError.message);
                    }
                  } else {
                    console.error("Media download failed:", downloadRes.status);
                  }
                }
              } else {
                console.error("Media URL fetch failed:", mediaRes.status, await mediaRes.text());
              }
            } catch (mediaErr) {
              console.error("Media URL resolution error:", mediaErr);
              // Fall back to raw media ID (already set)
            }
          }

          // Find lead by phone
          const normalizedPhone = phone.replace(/^91/, "+91");
          const { data: leadRows } = await admin
            .from("leads")
            .select("id, counsellor_id, name")
            .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.eq.+${phone}`)
            .limit(1);
          const lead = leadRows?.[0] || null;

          // Insert message
          await admin.from("whatsapp_messages").insert({
            lead_id: lead?.id || null,
            wa_message_id: waMessageId,
            direction: "inbound",
            phone,
            message_type: msgType,
            content,
            media_url: mediaUrl,
            status: "received",
            is_read: false,
            assigned_to: lead?.counsellor_id || null,
          });

          // Log activity if lead found
          if (lead?.id) {
            await admin.from("lead_activities").insert({
              lead_id: lead.id,
              type: "whatsapp",
              description: `Inbound WhatsApp: ${content?.substring(0, 100) || "[media]"}`,
            });
          }

          // Insert in-app notification for assigned counsellor or all admins
          const senderName = lead?.name || phone;
          const previewText = msgType === "text"
            ? (content?.substring(0, 80) || "")
            : `[${msgType}]`;

          if (lead?.counsellor_id) {
            await admin.from("notifications").insert({
              user_id: lead.counsellor_id,
              type: "whatsapp_message",
              title: `New WhatsApp from ${senderName}`,
              body: previewText,
              link: `/whatsapp-inbox`,
              lead_id: lead.id,
            });
          } else {
            // No counsellor assigned — notify all admission_head and super_admin users
            const { data: adminRoles } = await admin
              .from("user_roles")
              .select("user_id")
              .in("role", ["super_admin", "admission_head"]);
            if (adminRoles?.length) {
              // Deduplicate user_ids
              const uniqueIds = [...new Set(adminRoles.map((r: any) => r.user_id))];
              await admin.from("notifications").insert(
                uniqueIds.map((uid: string) => ({
                  user_id: uid,
                  type: "whatsapp_message",
                  title: `New WhatsApp from ${senderName}`,
                  body: previewText,
                  link: `/whatsapp-inbox`,
                  lead_id: lead?.id || null,
                }))
              );
            }
          }

          // Auto-reply bot: match inbound text against keyword patterns
          if (msgType === "text" && content) {
            const matched = AUTO_REPLIES.find(r => r.patterns.test(content.trim()));
            if (matched) {
              try {
                const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
                const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
                const waPhone = phone.replace(/[^0-9]/g, "");

                const autoRes = await fetch(
                  `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${waToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      messaging_product: "whatsapp",
                      to: waPhone,
                      type: "text",
                      text: { body: matched.reply },
                    }),
                  }
                );
                const autoResult = await autoRes.json();

                if (autoRes.ok) {
                  // Log auto-reply as outbound message
                  await admin.from("whatsapp_messages").insert({
                    lead_id: lead?.id || null,
                    wa_message_id: autoResult?.messages?.[0]?.id || null,
                    direction: "outbound",
                    phone,
                    message_type: "text",
                    content: matched.reply,
                    status: "sent",
                    is_read: true,
                  });
                } else {
                  console.error("Auto-reply send failed:", autoResult?.error?.message);
                }
              } catch (autoErr) {
                console.error("Auto-reply error:", autoErr);
              }
            }
          }
        }

        // Handle status updates (delivered, read)
        const statuses = value?.statuses || [];
        for (const status of statuses) {
          const waMessageId = status.id;
          const newStatus = status.status; // sent, delivered, read, failed
          if (waMessageId && newStatus) {
            await admin
              .from("whatsapp_messages")
              .update({ status: newStatus })
              .eq("wa_message_id", waMessageId);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

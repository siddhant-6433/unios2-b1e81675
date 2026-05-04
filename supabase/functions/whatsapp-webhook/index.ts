import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Auto-reply rules: keyword patterns → response
// Matched top-to-bottom; first match wins. Patterns are case-insensitive.
// Only keep exact greeting and menu-number responses.
// Everything else (fee, course, eligibility, campus, etc.) is handled by the AI knowledge base.
const AUTO_REPLIES: { patterns: RegExp; reply: string }[] = [
  {
    patterns: /^(hi|hello|hey|hii+|hlo|good\s*(morning|evening|afternoon)|namaste|namaskar|helo|hy)[\s!.]*$/i,
    reply: "Hi! 👋 Welcome to NIMT Educational Institutions. How can I help you today?\n\n1️⃣ Admission enquiry\n2️⃣ Course information\n3️⃣ Fee structure\n4️⃣ Campus visit\n5️⃣ Talk to a counsellor",
  },
  // Menu number responses are intentionally NOT here — they go to AI with context
  // so Gemini can give a rich, knowledge-base-driven answer
  {
    patterns: /\b(thank|thanks|thanku|thnx|thnks|dhanyawad|shukriya|ty)\b/i,
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

        // Capture which business number received this event so the inbox can
        // be filtered per-number (multiple WABAs / BSPs can fan out here).
        const businessPnId   = value?.metadata?.phone_number_id || null;
        const businessNumber = value?.metadata?.display_phone_number || null;

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
            .select("id, counsellor_id, name, stage")
            .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.eq.+${phone}`)
            .limit(1);
          const lead = leadRows?.[0] || null;

          // Skip all processing for DNC leads (except logging the message)
          if (lead?.stage === "dnc") {
            // Still log the message but skip replies
            await admin.from("whatsapp_messages").insert({
              lead_id: lead.id,
              wa_message_id: waMessageId,
              direction: "inbound",
              phone, message_type: msgType, content, media_url: mediaUrl,
              status: "received", is_read: false,
              assigned_to: lead.counsellor_id || null,
              business_phone_number_id: businessPnId,
              business_phone_number: businessNumber,
            });
            continue;
          }

          // Defer-flag: when true, the LLM classifier will fire the reply once
          // it knows whether this is admission / job / vendor — the webhook's
          // immediate AI-reply dispatch below is skipped to avoid pitching
          // admissions to a likely job applicant.
          let shouldDeferAiReply = false;

          // Insert message — capture id for downstream classification queue
          const { data: insertedMsg } = await admin.from("whatsapp_messages").insert({
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
            business_phone_number_id: businessPnId,
            business_phone_number: businessNumber,
          }).select("id").single();
          const inboundMessageId: string | null = insertedMsg?.id || null;

          // Log activity if lead found
          if (lead?.id) {
            await admin.from("lead_activities").insert({
              lead_id: lead.id,
              type: "whatsapp",
              description: `Inbound WhatsApp: ${content?.substring(0, 100) || "[media]"}`,
            });

            // Track engagement — inbound WhatsApp reply is a strong intent signal
            await admin.from("lead_engagement_events").insert({
              lead_id: lead.id,
              phone: normalizedPhone,
              event_type: "whatsapp_reply",
              metadata: { message_type: msgType, preview: content?.substring(0, 50) || null },
            });

            // Auto-categorize lead based on message content (job applicant, vendor, etc.)
            // If regex returns 'lead' AND the message contains a possible non-admission
            // signal, defer the AI knowledge-base reply behind LLM classification.
            // Otherwise reply immediately as today (fast path for normal admission queries).
            if (content && msgType === "text") {
              try {
                const { data: catResult } = await admin.rpc("auto_categorize_lead_from_message", {
                  _lead_id: lead.id,
                  _message_text: content,
                });

                if (catResult === "lead" && content.trim().length >= 6) {
                  const { data: ambig } = await admin.rpc("wa_message_might_be_non_admission", {
                    _text: content,
                  });
                  if (ambig === true) {
                    const { data: queueId } = await admin.rpc("enqueue_wa_classification", {
                      _lead_id: lead.id,
                      _message_id: inboundMessageId,
                      _phone: normalizedPhone,
                      _content: content,
                      _dispatch_reply: true,
                    });
                    if (queueId) {
                      // Fire classifier immediately (cron is the safety net for retries).
                      // Classifier will invoke whatsapp-ai-reply itself once it knows the
                      // intent — so we set a flag to skip the immediate AI reply below.
                      shouldDeferAiReply = true;
                      const supaUrl = Deno.env.get("SUPABASE_URL")!;
                      const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                      fetch(`${supaUrl}/functions/v1/wa-classify-message`, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${supaKey}`,
                        },
                        body: JSON.stringify({ queue_id: queueId, dispatch_reply: true }),
                      }).catch((e) => console.error("classify dispatch error:", e));
                    }
                  }
                }
              } catch (_e) {
                // non-critical, don't block webhook
              }
            }
          }


          // Insert in-app notification for assigned counsellor or all admins
          const senderName = lead?.name || phone;
          const previewText = msgType === "text"
            ? (content?.substring(0, 80) || "")
            : `[${msgType}]`;

          const waInboxLink = `/whatsapp-inbox?phone=${normalizedPhone}`;

          if (lead?.counsellor_id) {
            await admin.from("notifications").insert({
              user_id: lead.counsellor_id,
              type: "whatsapp_message",
              title: `New WhatsApp from ${senderName}`,
              body: previewText,
              link: waInboxLink,
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
                  link: waInboxLink,
                  lead_id: lead?.id || null,
                }))
              );
            }
          }

          // Feedback response detection — check BEFORE auto-replies
          // If the user has an open feedback request and replies 1-5, record the rating
          let feedbackHandled = false;
          if (msgType === "text" && content) {
            const trimmed = content.trim();
            const ratingMatch = trimmed.match(/^([1-5])$/);
            if (ratingMatch) {
              // Check for open feedback request for this phone
              const normalizedForFeedback = phone.replace(/^91/, "+91");
              const { data: openFeedback } = await admin
                .from("feedback_responses")
                .select("id, lead_id, counsellor_id, interaction_type")
                .eq("status", "sent")
                .order("sent_at", { ascending: false })
                .limit(5);

              if (openFeedback?.length) {
                // Match feedback to this phone's lead
                const { data: phoneLead } = await admin
                  .from("leads")
                  .select("id")
                  .or(`phone.eq.${phone},phone.eq.${normalizedForFeedback},phone.eq.+${phone}`)
                  .limit(1);

                const leadId = phoneLead?.[0]?.id;
                if (leadId) {
                  const fb = openFeedback.find((f: any) => f.lead_id === leadId);
                  if (fb) {
                    const rating = parseInt(ratingMatch[1]);
                    await admin
                      .from("feedback_responses")
                      .update({
                        rating,
                        status: "responded",
                        responded_at: new Date().toISOString(),
                      })
                      .eq("id", fb.id);

                    // Send thank-you reply
                    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
                    const pnId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
                    const waPhone = phone.replace(/[^0-9]/g, "");
                    const thankMsg = rating >= 4
                      ? "Thank you for the wonderful feedback! We're glad you had a great experience. 😊"
                      : rating >= 3
                      ? "Thank you for your feedback! We appreciate your time and will strive to do better. 🙏"
                      : "Thank you for sharing your feedback. We're sorry about your experience and will work to improve. Your input matters to us. 🙏";

                    try {
                      const thankRes = await fetch(
                        `https://graph.facebook.com/v21.0/${pnId}/messages`,
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
                            text: { body: thankMsg },
                          }),
                        }
                      );
                      const thankResult = await thankRes.json();
                      if (thankRes.ok) {
                        await admin.from("whatsapp_messages").insert({
                          lead_id: leadId,
                          wa_message_id: thankResult?.messages?.[0]?.id || null,
                          direction: "outbound",
                          phone,
                          message_type: "text",
                          content: thankMsg,
                          status: "sent",
                          is_read: true,
                        });
                      }
                    } catch (e) {
                      console.error("Feedback thank-you error:", e);
                    }

                    feedbackHandled = true;
                  }
                }
              }
            }
          }

          // ── DNC detection: "stop", "not interested", etc. ──────────────────
          const DNC_PATTERNS = /\b(stop|unsubscribe|opt.?out|do not contact|dont contact|don'?t contact|not interested|nahi chahiye|mujhe nahi chahiye|remove me|block me|dnc|irritating|irritate|stop calling|stop messaging|stop whatsapp|band karo|chhodiye|chhodo|mat karo|pareshan|hata do|hatao)\b/i;
          if (!feedbackHandled && msgType === "text" && content && DNC_PATTERNS.test(content.trim())) {
            // Mark lead as DNC if known
            if (lead?.id) {
              await admin.from("leads").update({ stage: "dnc" }).eq("id", lead.id);
              await admin.from("lead_activities").insert({
                lead_id: lead.id,
                type: "whatsapp",
                description: `Lead marked DNC via WhatsApp opt-out: "${content.substring(0, 100)}"`,
              });
              // Notify counsellor / admins
              const notifyUserId = lead.counsellor_id || null;
              if (notifyUserId) {
                await admin.from("notifications").insert({
                  user_id: notifyUserId,
                  type: "general",
                  title: `DNC: ${lead.name || phone} opted out`,
                  body: `Lead replied "${content.substring(0, 60)}" on WhatsApp and has been marked Do Not Contact.`,
                  link: `/admissions/${lead.id}`,
                  lead_id: lead.id,
                });
              }
            }
            // Send DNC acknowledgment
            try {
              const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
              const pnId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
              const dncMsg = "You have been unsubscribed and added to our Do Not Contact list. We will not reach out to you again. If this was a mistake, please reply \"START\" to re-subscribe.";
              const dncRes = await fetch(`https://graph.facebook.com/v21.0/${pnId}/messages`, {
                method: "POST",
                headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ messaging_product: "whatsapp", to: phone.replace(/[^0-9]/g, ""), type: "text", text: { body: dncMsg } }),
              });
              if (dncRes.ok) {
                const dncResult = await dncRes.json();
                await admin.from("whatsapp_messages").insert({
                  lead_id: lead?.id || null,
                  wa_message_id: dncResult?.messages?.[0]?.id || null,
                  direction: "outbound", phone,
                  message_type: "text", content: dncMsg, status: "sent", is_read: true,
                });
              }
            } catch (e) { console.error("DNC ack error:", e); }
            feedbackHandled = true; // skip further auto-replies
          }

          // ── Re-subscribe detection ───────────────────────────────────────
          if (!feedbackHandled && msgType === "text" && content && /^start$/i.test(content.trim())) {
            if (lead?.id) {
              await admin.from("leads").update({ stage: "new_lead" }).eq("id", lead.id);
            }
          }

          // ── Auto-reply bot: match inbound text against keyword patterns ──
          let keywordMatched = false;
          if (!feedbackHandled && msgType === "text" && content) {
            const matched = AUTO_REPLIES.find(r => r.patterns.test(content.trim()));
            if (matched) {
              keywordMatched = true;
              try {
                const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
                const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
                const waPhone = phone.replace(/[^0-9]/g, "");

                const autoRes = await fetch(
                  `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
                  {
                    method: "POST",
                    headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
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
                  await admin.from("whatsapp_messages").insert({
                    lead_id: lead?.id || null,
                    wa_message_id: autoResult?.messages?.[0]?.id || null,
                    direction: "outbound",
                    phone, message_type: "text", content: matched.reply, status: "sent", is_read: true,
                    template_key: "auto_reply",
                  });
                  const trimmedContent = content.trim();
                  if (lead?.id && lead?.counsellor_id && (trimmedContent === "3" || trimmedContent === "5")) {
                    const followupType = trimmedContent === "3" ? "Fee structure request via WhatsApp" : "Student requested counsellor callback via WhatsApp";
                    const scheduledAt = new Date(Date.now() + 3600000).toISOString();
                    await admin.from("lead_followups").insert({
                      lead_id: lead.id, scheduled_at: scheduledAt, type: "call", status: "pending", notes: followupType,
                    });
                    await admin.from("notifications").insert({
                      user_id: lead.counsellor_id,
                      type: "followup_due",
                      title: trimmedContent === "5" ? `Callback requested: ${lead.name || phone}` : `Fee inquiry: ${lead.name || phone}`,
                      body: followupType,
                      link: `/admissions/${lead.id}`,
                      lead_id: lead.id,
                    });
                  }
                } else {
                  console.error("Auto-reply send failed:", autoResult?.error?.message);
                }
              } catch (autoErr) {
                console.error("Auto-reply error:", autoErr);
              }
            }
          }

          // ── AI Knowledge Base reply (handles everything not matched above) ──
          if (!feedbackHandled && !keywordMatched && !shouldDeferAiReply && msgType === "text" && content) {
            try {
              // Map menu number selections to explicit intent so AI gives a rich answer
              const MENU_CONTEXT: Record<string, string> = {
                "1": "The user selected option 1 — they want information about admissions and how to apply.",
                "2": "The user selected option 2 — they want to know about courses offered at NIMT.",
                "3": "The user selected option 3 — they want fee structure information.",
                "4": "The user selected option 4 — they want to schedule a campus visit.",
                "5": "The user selected option 5 — they want to talk to a counsellor.",
              };
              const menuCtx = MENU_CONTEXT[content.trim()];
              const messageForAI = menuCtx
                ? `[System note: ${menuCtx}]\n\nUser message: ${content}`
                : content;

              // Fetch last 6 messages for context
              const { data: recentMsgs } = await admin
                .from("whatsapp_messages")
                .select("direction, content")
                .eq("phone", phone)
                .order("created_at", { ascending: false })
                .limit(6);

              const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
              await fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-reply`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  phone,
                  message: messageForAI,
                  lead_name: lead?.name || null,
                  lead_stage: lead?.stage || null,
                  course_interest: null,
                  recent_messages: (recentMsgs || []).reverse(),
                }),
              });
            } catch (aiErr) {
              console.error("AI reply dispatch error:", aiErr);
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

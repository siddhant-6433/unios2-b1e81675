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

function extractWhatsAppLoginCode(content: string | null | undefined): string | null {
  const match = (content || "").match(/\bUNIOS[-\s:]?([23456789A-HJ-NP-Z]{8})\b/i);
  return match?.[1]?.toUpperCase() || null;
}

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
          // Interactive button replies (e.g. our Good/Bad feedback buttons)
          // carry their payload in msg.interactive.button_reply. Surface the
          // chosen title in `content` so the inbox shows "Good" / "Bad"
          // instead of the placeholder `[interactive]`.
          const buttonReply = msg.interactive?.button_reply || msg.button?.payload
            ? {
                id:    msg.interactive?.button_reply?.id    || msg.button?.payload || null,
                title: msg.interactive?.button_reply?.title || msg.button?.text    || null,
              }
            : null;
          const content =
            msg.text?.body ||
            msg.caption ||
            msg.image?.caption ||
            buttonReply?.title ||
            `[${msgType}]`;
          const mediaId = msg.image?.id || msg.document?.id || msg.audio?.id || msg.video?.id || null;
          let mediaUrl: string | null = mediaId;

          // ── WhatsApp sign-in intent ──────────────────────────────────────
          // The browser creates a short-lived intent, then opens WhatsApp with
          // a prefilled "UNIOS-XXXXXXXX" message. When that message arrives
          // from the user's WhatsApp account, mark the intent verified and let
          // the browser polling endpoint mint the Supabase session.
          const loginCode = msgType === "text" ? extractWhatsAppLoginCode(content) : null;
          if (loginCode) {
            const senderPhone = `+${phone.replace(/[^0-9]/g, "")}`;
            const { data: intent } = await admin
              .from("whatsapp_login_intents")
              .select("id")
              .eq("code", loginCode)
              .eq("status", "pending")
              .gt("expires_at", new Date().toISOString())
              .single();

            if (intent?.id) {
              await admin
                .from("whatsapp_login_intents")
                .update({
                  status: "verified",
                  sender_phone: senderPhone,
                  business_phone_number_id: businessPnId,
                  wa_message_id: waMessageId,
                  verified_at: new Date().toISOString(),
                })
                .eq("id", intent.id)
                .eq("status", "pending");
            }

            continue;
          }

          // ── Personal Document Tracker: #mydoc trigger ───────────────────
          // Two valid patterns:
          //   (a) ONE message: media with caption "#mydoc [type_hint]"
          //   (b) TWO messages: media first (no caption), then a text
          //       message that starts with "#mydoc" within 5 minutes.
          //       WhatsApp on mobile makes captioning a forwarded
          //       document unobvious, so this two-message flow is the
          //       common case in practice.
          // Both route the file into the personal-documents bucket,
          // extract fields, save a row, and reply. We then `continue`
          // so the message does NOT enter the lead pipeline /
          // whatsapp_messages log — this is genuinely personal data.
          const captionText = (msg.text?.body || msg.caption || msg.image?.caption || msg.document?.caption || "").trim();
          const isMydocTextOnly = !mediaId && /^#mydoc\b/i.test(captionText);
          const isMydocInline   =  mediaId && /^#mydoc\b/i.test(captionText);

          if (isMydocInline || isMydocTextOnly) {
            try {
              // Look up the sender by matching their profile.phone (digits-only)
              // against all super_admin users. The "+" prefix in phone numbers
              // is not URL-encoded by PostgREST, so we do the comparison in JS.
              const phoneDigits = phone.replace(/[^0-9]/g, "");
              const phoneE164   = `+${phoneDigits}`;

              // 1. All super_admin user IDs
              const { data: roleRows } = await admin
                .from("user_roles")
                .select("user_id")
                .eq("role", "super_admin");
              const saIds = (roleRows || []).map((r: { user_id: string }) => r.user_id);

              // 2. Their profile phones
              const { data: profileRows } = saIds.length
                ? await admin.from("profiles").select("user_id, phone").in("user_id", saIds)
                : { data: [] };
              const matchedProfile = (profileRows || []).find(
                (p: { user_id: string; phone: string | null }) =>
                  (p.phone || "").replace(/[^0-9]/g, "") === phoneDigits
              );

              if (!matchedProfile) {
                console.log(`[#mydoc] rejected — phone ${phoneE164} not linked to any super_admin profile`);
                await sendWaText(phone, `Sorry, ${phoneE164} isn't linked to any super-admin account. Make sure your mobile number is set in your profile.`);
                continue;
              }

              // 3. Resolve the user's email
              const { data: { user: saUser } } = await admin.auth.admin.getUserById(matchedProfile.user_id);
              const owner = { email: saUser?.email || "" };
              if (!owner.email) {
                console.error(`[#mydoc] could not resolve email for user_id ${matchedProfile.user_id}`);
                continue;
              }

              const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
              const supaUrl = Deno.env.get("SUPABASE_URL")!;
              const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

              // Resolve the media bytes. Inline case: fetch fresh from
              // Meta. Text-only case: the prior media message was already
              // mirrored to the whatsapp-media bucket by the standard
              // handler; pull it back out by phone+recency.
              let fileBlob: Blob;
              let mimeType: string;

              if (isMydocInline) {
                const mRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
                  headers: { Authorization: `Bearer ${waToken}` },
                });
                if (!mRes.ok) throw new Error(`media meta ${mRes.status}`);
                const mMeta = await mRes.json();
                const dlRes = await fetch(mMeta.url, { headers: { Authorization: `Bearer ${waToken}` } });
                if (!dlRes.ok) throw new Error(`media download ${dlRes.status}`);
                fileBlob = await dlRes.blob();
                mimeType = mMeta.mime_type || dlRes.headers.get("content-type") || "application/octet-stream";
              } else {
                // text-only #mydoc: find the most recent inbound media
                // message from this phone in the last 5 minutes.
                const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
                const { data: priorMsgs } = await admin
                  .from("whatsapp_messages")
                  .select("media_url, message_type, created_at")
                  .eq("phone", phone)
                  .eq("direction", "inbound")
                  .gte("created_at", fiveMinAgo)
                  .not("media_url", "is", null)
                  .order("created_at", { ascending: false })
                  .limit(1);
                const prior = priorMsgs?.[0];
                if (!prior?.media_url) {
                  await sendWaText(phone, "I didn't find a document just before this. Forward the file again with caption #mydoc, or send the file first and then #mydoc within 5 minutes.");
                  continue;
                }
                const dlRes = await fetch(prior.media_url);
                if (!dlRes.ok) throw new Error(`mirror download ${dlRes.status}`);
                fileBlob = await dlRes.blob();
                mimeType = dlRes.headers.get("content-type") || "application/octet-stream";
              }
              const extMap: Record<string, string> = {
                "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
                "application/pdf": "pdf",
              };
              const ext = extMap[mimeType] || "bin";
              const docId = crypto.randomUUID();
              const path = `${owner.email}/${docId}.${ext}`;

              const { error: upErr } = await admin.storage
                .from("personal-documents")
                .upload(path, fileBlob, { contentType: mimeType, upsert: false });
              if (upErr) throw new Error(`storage upload: ${upErr.message}`);

              // Optional type hint from "#mydoc <type>"
              const hintMatch = captionText.match(/^#mydoc\s+([a-z_]+)/i);
              const docTypeHint = hintMatch ? hintMatch[1].toLowerCase() : undefined;

              // Run extractor (service-role auth)
              const exRes = await fetch(`${supaUrl}/functions/v1/extract-personal-doc`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ file_path: path, doc_type_hint: docTypeHint }),
              });

              let extracted: any = {};
              let extractionErr: string | null = null;
              if (exRes.ok) {
                extracted = await exRes.json();
              } else {
                const errBody = await exRes.text();
                extractionErr = `HTTP ${exRes.status}: ${errBody.slice(0, 250)}`;
                console.error("[#mydoc] extraction failed:", extractionErr);
              }

              const { error: insErr } = await admin.from("personal_documents").insert({
                id: docId,
                owner_email: owner.email,
                doc_type: extracted.doc_type || "other",
                label: extracted.label || `WhatsApp upload ${new Date().toLocaleDateString("en-IN")}`,
                file_path: path,
                mime_type: mimeType,
                source: "whatsapp",
                issuer: extracted.issuer ?? null,
                policy_number: extracted.policy_number ?? null,
                vehicle_reg: extracted.vehicle_reg ?? null,
                insured_name: extracted.insured_name ?? null,
                issued_on: extracted.issued_on ?? null,
                expires_on: extracted.expires_on ?? null,
                raw_extracted: extracted.raw ?? null,
              });
              if (insErr) throw new Error(`insert: ${insErr.message}`);

              // Confirmation reply
              const lines = [
                "✅ Document saved to your dashboard.",
                `Type: ${extracted.doc_type || "other"}`,
                extracted.label ? `Label: ${extracted.label}` : null,
                extracted.policy_number ? `Policy #: ${extracted.policy_number}` : null,
                extracted.vehicle_reg ? `Vehicle: ${extracted.vehicle_reg}` : null,
                extracted.expires_on ? `Expires: ${extracted.expires_on}` : "Expiry: not detected — please edit on dashboard",
                extractionErr ? `⚠️ Extraction error: ${extractionErr}` : null,
              ].filter(Boolean).join("\n");
              await sendWaText(phone, lines);
            } catch (e: any) {
              console.error("[#mydoc] error:", e?.message || e);
              await sendWaText(phone, `Couldn't save that document: ${e?.message || "unknown error"}`);
            }
            continue; // skip lead pipeline entirely
          }

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
            .select("id, counsellor_id, name, stage, person_role")
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

          // HR / careers channel: messages on +919599675267 (pnid
          // 970526789470416) OR conversations already classified as
          // job_applicant must NEVER receive the admissions auto-reply
          // (greeting menu) or the admissions AI reply. Notifications and
          // lead-activity logging still happen — only outbound auto-replies
          // are suppressed.
          const HR_BUSINESS_PNID = "970526789470416";
          const isHrChannel =
            businessPnId === HR_BUSINESS_PNID ||
            (lead as any)?.person_role === "job_applicant";

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
            // Skipped on the HR channel: the classifier dispatches AI replies, which
            // we never want for HR/job-applicant traffic.
            if (content && msgType === "text" && !isHrChannel) {
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
          let feedbackHandled = false;

          // (a) Interactive button reply: payload ids look like
          //     "feedback_good_<feedback_id>" / "feedback_bad_<feedback_id>"
          //     (sent by feedback-sender-cron). Good=5, Bad=1.
          if (!feedbackHandled && buttonReply?.id) {
            const m = buttonReply.id.match(/^feedback_(good|bad)_([0-9a-f-]{36})$/i);
            if (m) {
              const verdict = m[1].toLowerCase();
              const fbId = m[2];
              const rating = verdict === "good" ? 5 : 1;

              // Update the specific feedback row. Restrict to status='sent' so a
              // duplicate tap can't overwrite an already-responded row.
              const { data: updatedRows } = await admin
                .from("feedback_responses")
                .update({
                  rating,
                  status: "responded",
                  responded_at: new Date().toISOString(),
                })
                .eq("id", fbId)
                .eq("status", "sent")
                .select("id, lead_id, counsellor_id, interaction_type");

              const updated = updatedRows?.[0];
              if (updated) {
                // Notify the counsellor in the navbar bell. Title shows the
                // lead name + verdict so it's actionable at a glance.
                const verdictLabel = verdict === "good" ? "👍 Good" : "👎 Bad";
                await admin.from("notifications").insert({
                  user_id: updated.counsellor_id,
                  type: "feedback_received",
                  title: `${verdictLabel} feedback from ${lead?.name || phone}`,
                  body: updated.interaction_type === "visit"
                    ? "Rated their recent campus visit."
                    : "Rated their recent call.",
                  link: updated.lead_id ? `/admissions/${updated.lead_id}` : null,
                  lead_id: updated.lead_id,
                });

                // Acknowledge on WhatsApp
                const thankMsg = verdict === "good"
                  ? "Thank you for the kind feedback! We're glad you had a great experience. 😊"
                  : "Thank you for sharing your feedback. We're sorry it wasn't a great experience — your input helps us improve. 🙏";
                try {
                  const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
                  const pnId    = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
                  const waPhone = phone.replace(/[^0-9]/g, "");
                  const ackRes = await fetch(`https://graph.facebook.com/v21.0/${pnId}/messages`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      messaging_product: "whatsapp",
                      to: waPhone,
                      type: "text",
                      text: { body: thankMsg },
                    }),
                  });
                  if (ackRes.ok) {
                    const ackResult = await ackRes.json();
                    await admin.from("whatsapp_messages").insert({
                      lead_id: updated.lead_id,
                      wa_message_id: ackResult?.messages?.[0]?.id || null,
                      direction: "outbound",
                      phone,
                      message_type: "text",
                      content: thankMsg,
                      status: "sent",
                      is_read: true,
                    });
                  }
                } catch (e) {
                  console.error("Feedback button ack error:", e);
                }
              }
              feedbackHandled = true;
            }
          }

          // (b) Legacy 1–5 text fallback for anyone who replies with a digit
          //     instead of tapping the button.
          if (!feedbackHandled && msgType === "text" && content) {
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
          // Skipped on the HR channel and for job_applicant leads — those
          // conversations are admissions-irrelevant.
          let keywordMatched = false;
          if (!feedbackHandled && !isHrChannel && msgType === "text" && content) {
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
          // Suppressed on the HR channel and for job_applicant leads — the
          // admissions knowledge base shouldn't reply on careers traffic.
          if (!feedbackHandled && !keywordMatched && !shouldDeferAiReply && !isHrChannel && msgType === "text" && content) {
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

// Fire-and-forget text reply via the WhatsApp Cloud API. Used by the
// #mydoc personal-documents branch; logs but does not throw on failure
// so the caller never blocks on delivery errors.
async function sendWaText(toPhone: string, body: string): Promise<void> {
  try {
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const pnId    = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (!waToken || !pnId) return;
    const to = toPhone.replace(/[^0-9]/g, "");
    const r = await fetch(`https://graph.facebook.com/v21.0/${pnId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!r.ok) console.error("sendWaText failed:", r.status, await r.text());
  } catch (e: any) {
    console.error("sendWaText error:", e?.message || e);
  }
}

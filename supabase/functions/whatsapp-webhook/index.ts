import { createClient } from "npm:@supabase/supabase-js@2";
import { upsertConversationState } from "../_shared/whatsapp-conversation-state.ts";
import {
  markWhatsAppInboundEvent,
  recordWhatsAppInboundEvent,
} from "../_shared/whatsapp-inbound-events.ts";
import { applyLeadTransition } from "../_shared/lead-transition.ts";
import { loadLatestOutboundContext } from "../_shared/whatsapp-outbound-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function invokeConversationOrchestrator(payload: Record<string, unknown>): void {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  const dispatch = fetch(`${supabaseUrl}/functions/v1/whatsapp-conversation-orchestrator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("conversation orchestrator dispatch error:", err));
  (globalThis as any).EdgeRuntime?.waitUntil?.(dispatch);
}

type WhatsAppRoute = "default" | "otp" | "call" | "visit" | "bulk" | "reply";

function routeConfig(route: WhatsAppRoute) {
  const token =
    (route === "otp" ? Deno.env.get("WHATSAPP_OTP_API_TOKEN") : null) ||
    (route === "call" ? Deno.env.get("WHATSAPP_CALL_API_TOKEN") : null) ||
    (route === "visit" ? Deno.env.get("WHATSAPP_VISIT_API_TOKEN") : null) ||
    (route === "bulk" ? Deno.env.get("WHATSAPP_BULK_API_TOKEN") : null) ||
    (route === "reply" ? Deno.env.get("WHATSAPP_REPLY_API_TOKEN") : null) ||
    Deno.env.get("WHATSAPP_API_TOKEN");

  const phoneNumberId =
    (route === "otp" ? Deno.env.get("WHATSAPP_OTP_PHONE_NUMBER_ID") : null) ||
    (route === "call" ? Deno.env.get("WHATSAPP_CALL_PHONE_NUMBER_ID") : null) ||
    (route === "visit" ? Deno.env.get("WHATSAPP_VISIT_PHONE_NUMBER_ID") : null) ||
    (route === "bulk" ? Deno.env.get("WHATSAPP_BULK_PHONE_NUMBER_ID") : null) ||
    (route === "reply" ? Deno.env.get("WHATSAPP_REPLY_PHONE_NUMBER_ID") : null) ||
    Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  return { route, token, phoneNumberId };
}

function getWhatsAppConfigForPhone(requestedPhoneNumberId: string | null) {
  const configs = [
    routeConfig("default"),
    routeConfig("otp"),
    routeConfig("call"),
    routeConfig("visit"),
    routeConfig("bulk"),
    routeConfig("reply"),
  ];
  return configs.find((config) => requestedPhoneNumberId && config.phoneNumberId === requestedPhoneNumberId) || routeConfig("reply");
}

// Auto-reply rules: keyword patterns → response
// Matched top-to-bottom; first match wins. Patterns are case-insensitive.
// Only keep exact greeting and menu-number responses.
// Everything else (fee, course, eligibility, campus, etc.) is handled by the AI knowledge base.
const AUTO_REPLIES: { patterns: RegExp; reply: string }[] = [
  {
    patterns: /^(hi|hello|hey|hii+|hlo|good\s*(morning|evening|afternoon)|namaste|namaskar|helo|hy)[\s!.]*$/i,
    reply: "Hi! 👋 Welcome to NIMT Admissions.\n\nPlease share your name and course interest. You can reply like: *Priya, 3*\n\n1. B.Sc Nursing\n2. GNM\n3. BPT\n4. BMRIT\n5. MBA\n6. PGDM\n7. BBA\n8. BCA\n9. BA LLB / LLB\n10. B.Ed\n11. D Pharma\n12. School admission",
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

// Handle Meta template lifecycle webhooks (status / quality / category).
// Updates the whatsapp_templates mirror row and notifies the creator plus
// every super-admin via the in-app notifications table (realtime → toast).
async function handleTemplateStatusEvent(
  admin: any,
  field: string,
  value: any,
): Promise<void> {
  try {
    const metaId = value?.message_template_id ? String(value.message_template_id) : null;
    const name = value?.message_template_name || null;
    const language = value?.message_template_language || null;

    const patch: Record<string, unknown> = { status_updated_at: new Date().toISOString() };
    let title = "";
    let notifyBody = "";

    if (field === "message_template_status_update") {
      const event = String(value?.event || "").toUpperCase(); // APPROVED / REJECTED / PAUSED / …
      const reason = value?.reason && String(value.reason).toUpperCase() !== "NONE" ? String(value.reason) : null;
      if (event) patch.status = event;
      patch.reject_reason = event === "REJECTED" ? (reason || "Rejected by Meta") : null;
      const label = event === "APPROVED" ? "approved" : event === "REJECTED" ? "rejected" : event.toLowerCase();
      title = `Template ${label}: ${name || ""}`.trim();
      notifyBody = event === "REJECTED" && reason ? `Reason: ${reason}` : `Status is now ${event}.`;
    } else if (field === "message_template_quality_update") {
      const q = String(value?.new_quality_score || "").toUpperCase();
      if (q) patch.quality_score = q;
      title = `Template quality changed: ${name || ""}`.trim();
      notifyBody = `Quality score is now ${q || "unknown"}.`;
    } else if (field === "template_category_update") {
      const cat = String(value?.new_category || value?.correct_category || "").toUpperCase();
      if (cat) patch.category = cat;
      title = `Template category changed: ${name || ""}`.trim();
      notifyBody = `Category is now ${cat || "unknown"}.`;
    }

    // Update the mirror row, matching by Meta id first, else name+language.
    let row: { id: string; created_by: string | null; name: string } | null = null;
    if (metaId) {
      const { data } = await admin
        .from("whatsapp_templates")
        .update(patch)
        .eq("meta_template_id", metaId)
        .select("id, created_by, name")
        .maybeSingle();
      row = data as any;
    }
    if (!row && name) {
      let q = admin.from("whatsapp_templates").update(patch).eq("name", name);
      if (language) q = q.eq("language", language);
      const { data } = await q.select("id, created_by, name").maybeSingle();
      row = data as any;
    }
    if (!row) {
      console.warn("template status event: no matching row", { metaId, name, language });
      return;
    }

    // Notify creator + all super-admins (deduped).
    const recipients = new Set<string>();
    if (row.created_by) recipients.add(row.created_by);
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
    for (const a of admins || []) if (a?.user_id) recipients.add(a.user_id);

    if (recipients.size > 0 && title) {
      const notifRows = Array.from(recipients).map((uid) => ({
        user_id: uid,
        type: "template_status_update",
        title,
        body: notifyBody,
        link: "/template-manager",
      }));
      await admin.from("notifications").insert(notifRows);
    }
  } catch (err) {
    console.error("handleTemplateStatusEvent error:", err);
  }
}

async function markCampaignRecipientEngagement(
  admin: any,
  args: {
    phone: string;
    businessNumber: string | null;
    messageType: string;
    content: string;
    rawMessage: any;
  },
): Promise<void> {
  try {
    const outboundContext = await loadLatestOutboundContext(admin, args.phone, args.businessNumber);
    const recipientId = typeof outboundContext?.campaign_recipient_id === "string"
      ? outboundContext.campaign_recipient_id
      : null;
    if (!recipientId) return;

    const buttonReply = args.rawMessage?.interactive?.button_reply || null;
    const listReply = args.rawMessage?.interactive?.list_reply || null;
    const legacyButton = args.rawMessage?.button || null;
    const buttonPayload = buttonReply?.id || listReply?.id || legacyButton?.payload || null;
    const buttonTitle = buttonReply?.title || listReply?.title || legacyButton?.text || null;
    const referralUrl = args.rawMessage?.referral?.source_url || null;
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (buttonPayload || buttonTitle || args.messageType === "interactive" || args.messageType === "button") {
      patch.clicked_button_at = nowIso;
      patch.clicked_button_payload = buttonPayload || args.content || null;
      patch.clicked_button_title = buttonTitle || args.content || null;
    }
    if (referralUrl) {
      patch.clicked_link_at = nowIso;
      patch.clicked_url = referralUrl;
    }

    if (Object.keys(patch).length > 0) {
      await admin
        .from("whatsapp_campaign_recipients")
        .update(patch)
        .eq("id", recipientId);
    }
  } catch (err) {
    console.error("markCampaignRecipientEngagement error:", err);
  }
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

        // ── Template status / quality / category updates ─────────────────
        // Meta sends these when a submitted template is approved, rejected,
        // paused, or its quality/category changes. They carry no `messages`
        // array, so handle them here and `continue`. Mirrors the row in
        // whatsapp_templates and notifies the creator + super-admins.
        if (
          change?.field === "message_template_status_update" ||
          change?.field === "message_template_quality_update" ||
          change?.field === "template_category_update"
        ) {
          await handleTemplateStatusEvent(admin, change.field, value);
          continue;
        }

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
          const inboundEventId = await recordWhatsAppInboundEvent(admin, {
            provider: "meta",
            providerEventId: waMessageId,
            phone,
            businessNumber: businessPnId || businessNumber,
            messageType: msgType,
            content,
            mediaCount: mediaId ? 1 : 0,
            rawPayload: msg,
            normalized: {
              entry_id: entry?.id || null,
              change_field: change?.field || null,
              business_phone_number_id: businessPnId,
              business_phone_number: businessNumber,
              media_id: mediaId,
              button_reply: buttonReply,
            },
          });

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

            await markWhatsAppInboundEvent(admin, inboundEventId, {
              processingStatus: "skipped",
              skipReason: "whatsapp_login_intent",
              normalized: {
                login_code: loginCode,
                business_phone_number_id: businessPnId,
                business_phone_number: businessNumber,
              },
            });
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
            await markWhatsAppInboundEvent(admin, inboundEventId, {
              processingStatus: "skipped",
              skipReason: "personal_document_flow",
              normalized: {
                business_phone_number_id: businessPnId,
                business_phone_number: businessNumber,
                media_id: mediaId,
              },
            });
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
            .eq("is_mirror", false)
            .limit(1);
          let lead = leadRows?.[0] || null;

          if (!lead) {
            const phoneForLead = phone.length === 10 ? `+91${phone}` : `+${phone}`;
            const { data: newLead, error: leadInsertErr } = await admin
              .from("leads")
              .insert({
                phone: phoneForLead,
                source: "whatsapp",
                stage: "new_lead",
                name: phoneForLead,
              })
              .select("id, counsellor_id, name, stage, person_role")
              .single();
            if (leadInsertErr) {
              console.error("Webhook auto-create lead failed:", leadInsertErr.message);
            }
            lead = newLead || null;

            // Distribute brand-new WhatsApp leads across the same admin-maintained
            // intake round-robin pool that inbound voice calls use (prefers
            // online counsellors). No-op when no pool is configured.
            if (lead?.id && !lead.counsellor_id) {
              try {
                const { data: assignedId } = await admin.rpc("fn_intake_round_robin_assign", { _lead_id: lead.id });
                if (assignedId) {
                  lead.counsellor_id = assignedId as string;
                  console.log(`WhatsApp intake round-robin assigned lead ${lead.id} → ${assignedId}`);
                }
              } catch (e) {
                console.error("WhatsApp intake round-robin assign failed:", (e as Error).message);
              }
            }
          }

          // Skip all processing for DNC leads (except logging the message)
          if (lead?.stage === "dnc") {
            // Still log the message but skip replies
            const { data: dncMsg } = await admin.from("whatsapp_messages").insert({
              lead_id: lead.id,
              wa_message_id: waMessageId,
              direction: "inbound",
              phone, message_type: msgType, content, media_url: mediaUrl,
              status: "received", is_read: false,
              assigned_to: lead.counsellor_id || null,
              business_phone_number_id: businessPnId,
              business_phone_number: businessNumber,
            }).select("id").single();
            await markCampaignRecipientEngagement(admin, {
              phone,
              businessNumber: businessPnId || businessNumber || null,
              messageType: msgType,
              content,
              rawMessage: msg,
            });
            await markWhatsAppInboundEvent(admin, inboundEventId, {
              leadId: lead.id,
              messageId: dncMsg?.id || null,
              processingStatus: dncMsg?.id ? "linked" : "error",
              skipReason: dncMsg?.id ? "dnc" : "dnc_message_insert_missing_id",
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
          await markCampaignRecipientEngagement(admin, {
            phone,
            businessNumber: businessPnId || businessNumber || null,
            messageType: msgType,
            content,
            rawMessage: msg,
          });
          await markWhatsAppInboundEvent(admin, inboundEventId, {
            leadId: lead?.id || null,
            messageId: inboundMessageId,
            processingStatus: inboundMessageId ? "linked" : "error",
            skipReason: inboundMessageId ? null : "whatsapp_message_insert_missing_id",
          });

          if (businessPnId) {
            await upsertConversationState(admin, {
              phone,
              businessNumber: businessPnId,
              provider: "meta",
              leadId: lead?.id || null,
              mode: "ai",
              state: msgType === "text" ? "new_unqualified" : "needs_counsellor",
              ownerUserId: lead?.counsellor_id || null,
              escalationRole: msgType === "text" ? null : "counsellor",
              handoffReason: msgType === "text" ? null : "inbound_media",
              priority: msgType === "text" ? "normal" : "high",
            });
          }

          invokeConversationOrchestrator({
            source: "meta_webhook",
            provider: "meta",
            phone,
            business_phone_number_id: businessPnId,
            business_phone_number: businessNumber,
            message_id: inboundMessageId,
            lead_id: lead?.id || null,
            lead_stage: lead?.stage || null,
            person_role: (lead as any)?.person_role || null,
            owner_user_id: lead?.counsellor_id || null,
            message_type: msgType,
            content,
            dispatch_reply: true,
          });

          // Log activity if lead found
          const orchestratorOwnsReplyDecision = true;
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
            if (!orchestratorOwnsReplyDecision && content && msgType === "text" && !isHrChannel) {
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
                      _phone: phone,
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
                      template_key: "feedback_ack",
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
                  .eq("is_mirror", false)
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
                    const { token: waToken, phoneNumberId: pnId } = getWhatsAppConfigForPhone(businessPnId);
                    if (!waToken || !pnId) throw new Error("WhatsApp reply route is not configured");
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
                          business_phone_number_id: pnId,
                          template_key: "feedback_thanks",
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
          if (!orchestratorOwnsReplyDecision && !feedbackHandled && msgType === "text" && content && DNC_PATTERNS.test(content.trim())) {
            // Mark lead as DNC if known
            if (lead?.id) {
              await applyLeadTransition(admin, {
                leadId: lead.id,
                currentStage: lead.stage ?? null,
                command: "markDnc",
                activityType: "whatsapp",
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
              const { token: waToken, phoneNumberId: pnId } = getWhatsAppConfigForPhone(businessPnId);
              if (!waToken || !pnId) throw new Error("WhatsApp reply route is not configured");
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
                  business_phone_number_id: pnId,
                  template_key: "dnc_ack",
                });
              }
            } catch (e) { console.error("DNC ack error:", e); }
            feedbackHandled = true; // skip further auto-replies
          }

          // ── Re-subscribe detection ───────────────────────────────────────
          if (!feedbackHandled && msgType === "text" && content && /^start$/i.test(content.trim())) {
            if (lead?.id) {
              await applyLeadTransition(admin, {
                leadId: lead.id,
                currentStage: lead.stage ?? null,
                command: "restoreFromDnc",
                activityType: "whatsapp",
                description: "Lead replied START on WhatsApp and was restored from DNC",
              });
            }
          }

          // ── Auto-reply bot: match inbound text against keyword patterns ──
          // Skipped on the HR channel and for job_applicant leads — those
          // conversations are admissions-irrelevant.
          let keywordMatched = false;
          if (!orchestratorOwnsReplyDecision && !feedbackHandled && !isHrChannel && msgType === "text" && content) {
            const matched = AUTO_REPLIES.find(r => r.patterns.test(content.trim()));
            if (matched) {
              keywordMatched = true;
              try {
                const { token: waToken, phoneNumberId } = getWhatsAppConfigForPhone(businessPnId);
                if (!waToken || !phoneNumberId) throw new Error("WhatsApp reply route is not configured");
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
                    business_phone_number_id: phoneNumberId,
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
	          if (!orchestratorOwnsReplyDecision && !feedbackHandled && !keywordMatched && !shouldDeferAiReply && !isHrChannel && msgType === "text" && content) {
	            try {
	              // Map menu number selections to explicit intent so AI gives a rich answer
	              const MENU_CONTEXT: Record<string, string> = {
	                "1": "The user selected course option 1 — B.Sc Nursing.",
	                "2": "The user selected course option 2 — GNM.",
	                "3": "The user selected course option 3 — BPT.",
	                "4": "The user selected course option 4 — BMRIT.",
	                "5": "The user selected course option 5 — MBA.",
	                "6": "The user selected course option 6 — PGDM.",
	                "7": "The user selected course option 7 — BBA.",
	                "8": "The user selected course option 8 — BCA.",
	                "9": "The user selected course option 9 — BA LLB / LLB.",
	                "10": "The user selected course option 10 — B.Ed.",
	                "11": "The user selected course option 11 — D Pharma.",
	                "12": "The user selected course option 12 — School admission.",
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
                  business_phone_number_id: businessPnId,
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
            const updates: Record<string, unknown> = {
              status: newStatus,
              ...(businessPnId ? { business_phone_number_id: businessPnId } : {}),
              ...(status.errors ? { status_error: status.errors } : {}),
            };
            await admin
              .from("whatsapp_messages")
              .update(updates)
              .eq("wa_message_id", waMessageId);

            await admin
              .from("whatsapp_otps")
              .update({
                wa_status: newStatus,
                wa_status_error: status.errors || null,
                wa_status_updated_at: new Date().toISOString(),
              })
              .eq("wa_message_id", waMessageId);

            if (["sent", "delivered", "read", "failed"].includes(newStatus)) {
              const recipientPatch: Record<string, unknown> = {
                status: newStatus,
              };
              if (newStatus === "failed" && status.errors) {
                recipientPatch.error_message = JSON.stringify(status.errors);
              }
              await admin
                .from("whatsapp_campaign_recipients")
                .update(recipientPatch)
                .eq("message_id", waMessageId);
            }
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

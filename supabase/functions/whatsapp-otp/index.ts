import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

async function hashOtp(otp: string): Promise<string> {
  return hashText(otp);
}

async function hashText(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateLoginCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function normalizeLoginPhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 0 && trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length > 0) return `+${digits}`;
  return null;
}

async function createSession(admin: SupabaseClient, userId: string) {
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) return null;

  const { data: magicLink, error: magicError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (magicError || !magicLink) return null;

  const { data: sessionData, error: verifyError } = await admin.auth.verifyOtp({
    token_hash: magicLink.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !sessionData?.session) return null;

  return {
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  };
}

async function provisionUser(
  admin: SupabaseClient,
  phone: string,
  role: "student" | "parent" | "alumni"
): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  const email = `${digits}@${role}.unios.local`;

  let userId: string | null = null;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { provisioned_by: "whatsapp_otp", role, phone: digits },
  });

  if (!createErr && created?.user) {
    userId = created.user.id;
    console.log(`[whatsapp-otp] provisioned new ${role} user ${userId} for ${phone}`);
  } else {
    // User already exists — find by scanning listUsers (rare path)
    console.log(`[whatsapp-otp] createUser failed (${createErr?.message}), scanning for existing ${email}`);
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users?.find((u) => u.email === email);
    if (match) {
      userId = match.id;
      // Backfill phone in user_metadata for users provisioned before this field existed —
      // RLS via current_user_phone() reads it on the alumni portal.
      const existingMeta = (match.user_metadata ?? {}) as Record<string, unknown>;
      if (!existingMeta.phone) {
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: { ...existingMeta, phone: digits },
        });
      }
    }
  }

  if (!userId) return null;

  // user_roles has an app_role enum that includes 'student' and 'parent' but not 'alumni'.
  if (role !== "alumni") {
    await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
  }

  return userId;
}

async function resolveUserForPhone(admin: SupabaseClient, normalizedPhone: string): Promise<{ userId: string; role?: string } | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id")
    .eq("phone", normalizedPhone)
    .single();

  if (profile?.user_id) return { userId: profile.user_id, role: "staff" };

  const { data: studentSelf } = await admin
    .from("students")
    .select("id, user_id")
    .or(`phone.eq.${normalizedPhone},whatsapp_no.eq.${normalizedPhone}`)
    .limit(1)
    .single();

  if (studentSelf) {
    let userId = studentSelf.user_id;
    if (!userId) {
      userId = await provisionUser(admin, normalizedPhone, "student");
      if (userId) await admin.from("students").update({ user_id: userId }).eq("id", studentSelf.id);
    }
    if (userId) return { userId, role: "student" };
  }

  const { data: studentByFather } = await admin
    .from("students")
    .select("id, father_user_id")
    .or(`father_phone.eq.${normalizedPhone},father_whatsapp.eq.${normalizedPhone}`)
    .limit(1)
    .single();

  if (studentByFather) {
    let userId = studentByFather.father_user_id;
    if (!userId) {
      userId = await provisionUser(admin, normalizedPhone, "parent");
      if (userId) await admin.from("students").update({ father_user_id: userId }).eq("id", studentByFather.id);
    }
    if (userId) return { userId, role: "parent" };
  }

  const { data: studentByMother } = await admin
    .from("students")
    .select("id, mother_user_id")
    .or(`mother_phone.eq.${normalizedPhone},mother_whatsapp.eq.${normalizedPhone}`)
    .limit(1)
    .single();

  if (studentByMother) {
    let userId = studentByMother.mother_user_id;
    if (!userId) {
      userId = await provisionUser(admin, normalizedPhone, "parent");
      if (userId) await admin.from("students").update({ mother_user_id: userId }).eq("id", studentByMother.id);
    }
    if (userId) return { userId, role: "parent" };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { action, phone, otp, intent_id, client_secret } = await req.json();
    const normalizedPhone = normalizeLoginPhone(phone);

    // ── Start WhatsApp sign-in intent ────────────────────────────────────────
    if (action === "start_sign_in") {
      const businessPhone = (Deno.env.get("WHATSAPP_SIGN_IN_PHONE") || Deno.env.get("WHATSAPP_BUSINESS_PHONE") || "")
        .replace(/[^0-9]/g, "");

      if (!businessPhone) {
        return new Response(
          JSON.stringify({ error: "WhatsApp sign-in number is not configured." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientSecret = randomBase64Url(32);
      const clientSecretHash = await hashText(clientSecret);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      let created: { id: string; code: string; expires_at: string } | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        const code = generateLoginCode();
        const { data, error } = await adminClient
          .from("whatsapp_login_intents")
          .insert({
            code,
            client_secret_hash: clientSecretHash,
            expires_at: expiresAt,
          })
          .select("id, code, expires_at")
          .single();
        created = data;
        lastError = error;
      }

      if (!created) {
        console.error("[whatsapp-otp] failed to create login intent", lastError);
        return new Response(
          JSON.stringify({ error: "Could not start WhatsApp sign-in. Try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const text = [
        "Sign in to NIMT UniOs",
        "",
        `Code: UNIOS-${created.code}`,
        "",
        "Only send this if you just requested login on this device.",
      ].join("\n");
      const deeplinkUrl = `https://wa.me/${businessPhone}?text=${encodeURIComponent(text)}`;

      return new Response(
        JSON.stringify({
          success: true,
          intent_id: created.id,
          client_secret: clientSecret,
          code: created.code,
          expires_at: created.expires_at,
          deeplink_url: deeplinkUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Poll WhatsApp sign-in intent ─────────────────────────────────────────
    if (action === "status_sign_in") {
      if (!intent_id || !client_secret) {
        return new Response(
          JSON.stringify({ error: "Login request id and client secret required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const clientSecretHash = await hashText(client_secret);
      const { data: intent } = await adminClient
        .from("whatsapp_login_intents")
        .select("id, status, sender_phone, user_id, role, error, expires_at")
        .eq("id", intent_id)
        .eq("client_secret_hash", clientSecretHash)
        .single();

      if (!intent) {
        return new Response(
          JSON.stringify({ error: "Login request not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (intent.status === "pending" && new Date(intent.expires_at).getTime() < Date.now()) {
        await adminClient
          .from("whatsapp_login_intents")
          .update({ status: "expired", error: "Login request expired" })
          .eq("id", intent.id)
          .eq("status", "pending");
        return new Response(
          JSON.stringify({ success: true, status: "expired", error: "Login request expired" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (intent.status === "pending") {
        return new Response(
          JSON.stringify({ success: true, status: "pending", expires_at: intent.expires_at }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (intent.status === "failed" || intent.status === "expired" || intent.status === "consumed") {
        return new Response(
          JSON.stringify({ success: true, status: intent.status, error: intent.error }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let userId = intent.user_id;
      let role = intent.role;
      if (!userId) {
        const resolved = intent.sender_phone
          ? await resolveUserForPhone(adminClient, intent.sender_phone)
          : null;
        if (!resolved) {
          const error = "No UniOs account is linked to this WhatsApp number.";
          await adminClient
            .from("whatsapp_login_intents")
            .update({ status: "failed", error })
            .eq("id", intent.id)
            .eq("status", "verified");
          return new Response(
            JSON.stringify({ success: true, status: "failed", error }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        userId = resolved.userId;
        role = resolved.role;
        await adminClient
          .from("whatsapp_login_intents")
          .update({ user_id: userId, role })
          .eq("id", intent.id);
      }

      const token = await createSession(adminClient, userId);
      if (!token) {
        return new Response(
          JSON.stringify({ error: "Failed to create session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await adminClient
        .from("whatsapp_login_intents")
        .update({ status: "consumed", consumed_at: new Date().toISOString() })
        .eq("id", intent.id)
        .eq("status", "verified");

      return new Response(
        JSON.stringify({ success: true, status: "verified", token, role }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Send OTP ──────────────────────────────────────────────────────────────
    if (action === "send") {
      const whatsappToken = Deno.env.get("WHATSAPP_OTP_API_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN");
      const phoneNumberId = Deno.env.get("WHATSAPP_OTP_PHONE_NUMBER_ID") || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
      const otpTemplateName = Deno.env.get("WHATSAPP_OTP_TEMPLATE") || "unios2_login";

      console.log("[whatsapp-otp] Secret diagnostics:", {
        WHATSAPP_OTP_API_TOKEN: !!Deno.env.get("WHATSAPP_OTP_API_TOKEN"),
        WHATSAPP_API_TOKEN: !!Deno.env.get("WHATSAPP_API_TOKEN"),
        WHATSAPP_OTP_PHONE_NUMBER_ID: !!Deno.env.get("WHATSAPP_OTP_PHONE_NUMBER_ID"),
        WHATSAPP_PHONE_NUMBER_ID: !!Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),
        phoneNumberId_length: phoneNumberId?.length ?? 0,
        templateName: otpTemplateName,
      });

      if (!whatsappToken || !phoneNumberId) {
        return new Response(
          JSON.stringify({ error: "WhatsApp API not configured. Contact administrator." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!normalizedPhone || normalizedPhone.length < 10) {
        return new Response(
          JSON.stringify({ error: "Valid phone number required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Rate limit: max 1 OTP per phone per 60 seconds
      const { data: recentOtp } = await adminClient
        .from("whatsapp_otps")
        .select("id")
        .eq("phone", normalizedPhone)
        .eq("verified", false)
        .gt("created_at", new Date(Date.now() - 60000).toISOString())
        .limit(1);

      if (recentOtp && recentOtp.length > 0) {
        return new Response(
          JSON.stringify({ error: "Please wait 60 seconds before requesting a new OTP." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const otpCode = generateOtp();
      const otpHash = await hashOtp(otpCode);

      await adminClient.from("whatsapp_otps").delete().eq("phone", normalizedPhone).eq("verified", false);
      const { data: otpRecord, error: otpInsertError } = await adminClient.from("whatsapp_otps").insert({
        phone: normalizedPhone,
        otp_hash: otpHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }).select("id").single();

      if (otpInsertError || !otpRecord?.id) {
        console.error("[whatsapp-otp] failed to create OTP record", otpInsertError);
        return new Response(
          JSON.stringify({ error: "Could not create OTP. Try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const waPhone = normalizedPhone.replace(/[^0-9]/g, "");
      console.log("[whatsapp-otp] Sending to:", waPhone, "template:", otpTemplateName, "phoneNumberId:", phoneNumberId);

      const waResponse = await fetch(
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
            type: "template",
            template: {
              name: otpTemplateName,
              language: { code: "en" },
              components: [
                {
                  type: "body",
                  parameters: [{ type: "text", text: otpCode }],
                },
                {
                  type: "button",
                  sub_type: "url",
                  index: "0",
                  parameters: [{ type: "text", text: otpCode }],
                },
              ],
            },
          }),
        }
      );

      const waBody = await waResponse.text();
      console.log("[whatsapp-otp] Meta API response:", waResponse.status, waBody);

      if (!waResponse.ok) {
        const parsedWaError = parseJsonObject(waBody);
        const waError = isRecord(parsedWaError?.error) ? parsedWaError.error : null;
        const waCode = typeof waError?.code === "string" || typeof waError?.code === "number" ? waError.code : undefined;
        const waMessage = typeof waError?.message === "string" ? waError.message : undefined;
        const fbtrace = typeof waError?.fbtrace_id === "string" ? waError.fbtrace_id : undefined;
        await adminClient
          .from("whatsapp_otps")
          .update({
            wa_status: "failed",
            wa_status_error: parsedWaError || { raw: waBody.slice(0, 1000) },
            wa_status_updated_at: new Date().toISOString(),
          })
          .eq("id", otpRecord.id);
        return new Response(
          JSON.stringify({ error: waMessage || "Failed to send WhatsApp message. Try again.", meta_code: waCode, meta_fbtrace: fbtrace }),
          { status: waResponse.status >= 400 && waResponse.status < 500 ? 403 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const waResult = parseJsonObject(waBody);
      const waMessages = Array.isArray(waResult?.messages) ? waResult.messages : [];
      const waContacts = Array.isArray(waResult?.contacts) ? waResult.contacts : [];
      const waMessage = isRecord(waMessages[0]) ? waMessages[0] : null;
      const waContact = isRecord(waContacts[0]) ? waContacts[0] : null;
      const wamid = typeof waMessage?.id === "string" ? waMessage.id : undefined;
      console.log("[whatsapp-otp] Message sent, wamid:", wamid, "contact:", JSON.stringify(waContact));

      await adminClient
        .from("whatsapp_otps")
        .update({
          wa_message_id: wamid || null,
          wa_status: wamid ? "accepted" : "accepted_without_message_id",
          wa_sent_at: new Date().toISOString(),
          wa_status_updated_at: new Date().toISOString(),
        })
        .eq("id", otpRecord.id);

      return new Response(
        JSON.stringify({ success: true, wamid, wa_id: waContact?.wa_id, input: waContact?.input }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify OTP ────────────────────────────────────────────────────────────
    if (action === "verify") {
      if (!otp || !normalizedPhone) {
        return new Response(
          JSON.stringify({ error: "Phone and OTP required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const otpHash = await hashOtp(otp);

      const { data: otpRecord } = await adminClient
        .from("whatsapp_otps")
        .select("id, phone")
        .eq("phone", normalizedPhone)
        .eq("otp_hash", otpHash)
        .eq("verified", false)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (!otpRecord) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired OTP. Please try again." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await adminClient.from("whatsapp_otps").update({ verified: true }).eq("id", otpRecord.id);

      // ── 1. Staff login: check profiles ────────────────────────────────────
      const { data: profile } = await adminClient
        .from("profiles")
        .select("user_id")
        .eq("phone", normalizedPhone)
        .single();

      if (profile?.user_id) {
        const token = await createSession(adminClient, profile.user_id);
        if (!token) {
          return new Response(JSON.stringify({ error: "Failed to create session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.log("[whatsapp-otp] staff login for user", profile.user_id);
        return new Response(JSON.stringify({ success: true, verified: true, token }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── 2. Student login: check students.phone / whatsapp_no ──────────────
      const { data: studentSelf } = await adminClient
        .from("students")
        .select("id, user_id")
        .or(`phone.eq.${normalizedPhone},whatsapp_no.eq.${normalizedPhone}`)
        .limit(1)
        .single();

      if (studentSelf) {
        let userId = studentSelf.user_id;

        if (!userId) {
          userId = await provisionUser(adminClient, normalizedPhone, "student");
          if (userId) {
            await adminClient.from("students").update({ user_id: userId }).eq("id", studentSelf.id);
            console.log("[whatsapp-otp] linked student", studentSelf.id, "→ user", userId);
          }
        }

        if (userId) {
          const token = await createSession(adminClient, userId);
          if (!token) {
            return new Response(JSON.stringify({ error: "Failed to create session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          console.log("[whatsapp-otp] student login for student", studentSelf.id);
          return new Response(JSON.stringify({ success: true, verified: true, token, role: "student" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // ── 3. Parent login: check father_phone / father_whatsapp ─────────────
      const { data: studentByFather } = await adminClient
        .from("students")
        .select("id, father_user_id")
        .or(`father_phone.eq.${normalizedPhone},father_whatsapp.eq.${normalizedPhone}`)
        .limit(1)
        .single();

      if (studentByFather) {
        let userId = studentByFather.father_user_id;

        if (!userId) {
          userId = await provisionUser(adminClient, normalizedPhone, "parent");
          if (userId) {
            await adminClient.from("students").update({ father_user_id: userId }).eq("id", studentByFather.id);
            console.log("[whatsapp-otp] linked father for student", studentByFather.id, "→ user", userId);
          }
        }

        if (userId) {
          const token = await createSession(adminClient, userId);
          if (!token) {
            return new Response(JSON.stringify({ error: "Failed to create session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          console.log("[whatsapp-otp] father/parent login for student", studentByFather.id);
          return new Response(JSON.stringify({ success: true, verified: true, token, role: "parent" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // ── 4. Parent login: check mother_phone / mother_whatsapp ─────────────
      const { data: studentByMother } = await adminClient
        .from("students")
        .select("id, mother_user_id")
        .or(`mother_phone.eq.${normalizedPhone},mother_whatsapp.eq.${normalizedPhone}`)
        .limit(1)
        .single();

      if (studentByMother) {
        let userId = studentByMother.mother_user_id;

        if (!userId) {
          userId = await provisionUser(adminClient, normalizedPhone, "parent");
          if (userId) {
            await adminClient.from("students").update({ mother_user_id: userId }).eq("id", studentByMother.id);
            console.log("[whatsapp-otp] linked mother for student", studentByMother.id, "→ user", userId);
          }
        }

        if (userId) {
          const token = await createSession(adminClient, userId);
          if (!token) {
            return new Response(JSON.stringify({ error: "Failed to create session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          console.log("[whatsapp-otp] mother/parent login for student", studentByMother.id);
          return new Response(JSON.stringify({ success: true, verified: true, token, role: "parent" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // ── 5. Fallback: alumni applicant — provision a session-only user ──
      // The alumni portal inserts into alumni_verification_requests, which has
      // no anon SELECT policy. PostgREST's .insert().select() requires SELECT
      // RLS on the new row, so the caller must be authenticated.
      const alumniUserId = await provisionUser(adminClient, normalizedPhone, "alumni");
      if (!alumniUserId) {
        return new Response(JSON.stringify({ error: "Failed to provision applicant user" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const alumniToken = await createSession(adminClient, alumniUserId);
      if (!alumniToken) {
        return new Response(JSON.stringify({ error: "Failed to create session" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log("[whatsapp-otp] alumni applicant login for user", alumniUserId);
      return new Response(
        JSON.stringify({ success: true, verified: true, token: alumniToken, role: "alumni" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("[whatsapp-otp] Error:", err);
    return new Response(
      JSON.stringify({ error: getErrorMessage(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

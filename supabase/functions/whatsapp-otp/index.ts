import { createClient } from "npm:@supabase/supabase-js@2";

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
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createSession(admin: any, userId: string) {
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
  admin: any,
  phone: string,
  role: "student" | "parent"
): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  const email = `${digits}@${role}.unios.local`;

  let userId: string | null = null;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { provisioned_by: "whatsapp_otp", role },
  });

  if (!createErr && created?.user) {
    userId = created.user.id;
    console.log(`[whatsapp-otp] provisioned new ${role} user ${userId} for ${phone}`);
  } else {
    // User already exists — find by scanning listUsers (rare path)
    console.log(`[whatsapp-otp] createUser failed (${createErr?.message}), scanning for existing ${email}`);
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users?.find((u: any) => u.email === email);
    if (match) userId = match.id;
  }

  if (!userId) return null;

  // Assign role (ignore duplicate)
  await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });

  return userId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { action, phone, otp } = await req.json();

    const normalizedPhone = phone?.startsWith("+") ? phone : `+${phone}`;

    // ── Send OTP ──────────────────────────────────────────────────────────────
    if (action === "send") {
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
      await adminClient.from("whatsapp_otps").insert({
        phone: normalizedPhone,
        otp_hash: otpHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

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
        let parsedWaError: any = null;
        try { parsedWaError = JSON.parse(waBody); } catch { /* keep raw */ }
        const waCode = parsedWaError?.error?.code;
        const waMessage = parsedWaError?.error?.message as string | undefined;
        const fbtrace = parsedWaError?.error?.fbtrace_id;
        return new Response(
          JSON.stringify({ error: waMessage || "Failed to send WhatsApp message. Try again.", meta_code: waCode, meta_fbtrace: fbtrace }),
          { status: waResponse.status >= 400 && waResponse.status < 500 ? 403 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let waResult: any = null;
      try { waResult = JSON.parse(waBody); } catch { /* ignore */ }
      const wamid = waResult?.messages?.[0]?.id;
      const waContact = waResult?.contacts?.[0];
      console.log("[whatsapp-otp] Message sent, wamid:", wamid, "contact:", JSON.stringify(waContact));

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

      // ── 5. Fallback: applicant OTP (no session needed) ────────────────────
      console.log("[whatsapp-otp] no user found for", normalizedPhone, "— applicant flow");
      return new Response(
        JSON.stringify({ success: true, verified: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[whatsapp-otp] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

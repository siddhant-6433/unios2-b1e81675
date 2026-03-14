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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const whatsappToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const otpTemplateName = Deno.env.get("WHATSAPP_OTP_TEMPLATE") || "unios2_login";

    // Diagnostic logging (no secret values)
    console.log("[whatsapp-otp] Secret diagnostics:", {
      WHATSAPP_API_TOKEN: !!whatsappToken,
      WHATSAPP_PHONE_NUMBER_ID: !!phoneNumberId,
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

      // Generate & store OTP
      const otpCode = generateOtp();
      const otpHash = await hashOtp(otpCode);

      // Invalidate old OTPs for this phone
      await adminClient
        .from("whatsapp_otps")
        .delete()
        .eq("phone", normalizedPhone)
        .eq("verified", false);

      await adminClient.from("whatsapp_otps").insert({
        phone: normalizedPhone,
        otp_hash: otpHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      // Send via Meta WhatsApp Cloud API
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
              ],
            },
          }),
        }
      );

      if (!waResponse.ok) {
        const waErrorText = await waResponse.text();
        console.error("[whatsapp-otp] Meta API error:", waResponse.status, waErrorText);

        let parsedWaError: any = null;
        try {
          parsedWaError = JSON.parse(waErrorText);
        } catch {
          // keep raw
        }

        const waCode = parsedWaError?.error?.code;
        const waMessage = parsedWaError?.error?.message as string | undefined;
        const fbtrace = parsedWaError?.error?.fbtrace_id;

        return new Response(
          JSON.stringify({
            error: waMessage || "Failed to send WhatsApp message. Try again.",
            meta_code: waCode,
            meta_fbtrace: fbtrace,
          }),
          { status: waResponse.status >= 400 && waResponse.status < 500 ? 403 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

      // Mark as verified
      await adminClient
        .from("whatsapp_otps")
        .update({ verified: true })
        .eq("id", otpRecord.id);

      // Find user by phone (for staff login flow)
      const { data: profile } = await adminClient
        .from("profiles")
        .select("user_id")
        .eq("phone", normalizedPhone)
        .single();

      if (!profile) {
        // No staff profile — this is an applicant OTP verification (no session needed)
        return new Response(
          JSON.stringify({ success: true, verified: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Staff login: generate session
      const { data: userData } = await adminClient.auth.admin.getUserById(profile.user_id);

      if (!userData?.user?.email) {
        return new Response(
          JSON.stringify({ error: "User has no email configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: magicLink, error: magicError } =
        await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: userData.user.email,
        });

      if (magicError || !magicLink) {
        return new Response(
          JSON.stringify({ error: "Failed to create session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: sessionData, error: verifyError } = await adminClient.auth.verifyOtp({
        token_hash: magicLink.properties.hashed_token,
        type: "magiclink",
      });

      if (verifyError || !sessionData.session) {
        return new Response(
          JSON.stringify({ error: "Failed to create session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          verified: true,
          token: {
            access_token: sessionData.session.access_token,
            refresh_token: sessionData.session.refresh_token,
          },
        }),
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

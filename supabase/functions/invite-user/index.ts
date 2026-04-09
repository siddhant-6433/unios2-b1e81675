import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // JWT is already verified by Supabase gateway — decode sub claim directly
    const jwt = authHeader.replace("Bearer ", "");
    const [, payloadB64] = jwt.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const callerId: string | undefined = payload?.sub;

    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRole } = await adminClient.rpc("get_user_role", {
      _user_id: callerId,
    });

    if (callerRole !== "super_admin") {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, display_name, phone, role, campus, password } = await req.json();

    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: "Email and role are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let newUser: any;

    if (password) {
      // Create user with password immediately (no email invite)
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: display_name || email,
          full_name: display_name || email,
        },
      });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      newUser = data;
    } else {
      // Send email invite
      const { data, error: inviteError } =
        await adminClient.auth.admin.inviteUserByEmail(email, {
          data: {
            display_name: display_name || email,
            full_name: display_name || email,
          },
        });
      if (inviteError) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      newUser = data;
    }

    // Normalise phone: ensure it starts with +
    const normalizedPhone = phone
      ? (phone.startsWith("+") ? phone : `+${phone}`)
      : undefined;

    // Upsert profile with additional info
    // (profile may already exist from the handle_new_user trigger)
    if (display_name || campus || normalizedPhone) {
      const profileUpdate: Record<string, string> = { user_id: newUser.user.id };
      if (display_name) profileUpdate.display_name = display_name;
      if (campus) profileUpdate.campus = campus;
      if (normalizedPhone) profileUpdate.phone = normalizedPhone;

      await adminClient
        .from("profiles")
        .upsert(profileUpdate, { onConflict: "user_id" });
    }

    // Assign role
    const { error: roleError } = await adminClient
      .from("user_roles")
      .insert({ user_id: newUser.user.id, role });

    if (roleError) {
      return new Response(JSON.stringify({ error: roleError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send WhatsApp staff_welcome if phone is provided
    if (normalizedPhone) {
      try {
        const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
        const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
        if (waToken && phoneNumberId) {
          const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const waPhone = normalizedPhone.replace(/[^0-9]/g, "");
          const waPayload = {
            messaging_product: "whatsapp",
            to: waPhone,
            type: "template",
            template: {
              name: "nimt_new_staff",
              language: { code: "en" },
              components: [{
                type: "body",
                parameters: [
                  { type: "text", text: display_name || email },
                  { type: "text", text: roleLabel },
                  { type: "text", text: campus || "NIMT Educational Institutions" },
                ],
              }],
            },
          };
          const waRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(waPayload),
          });
          const waResult = await waRes.json();
          if (!waRes.ok) {
            console.error("Staff WhatsApp failed:", waResult?.error?.message);
          } else {
            const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
            const campusLabel = campus || "NIMT Educational Institutions";
            // Log the full rendered message text
            await adminClient.from("whatsapp_messages").insert({
              wa_message_id: waResult?.messages?.[0]?.id || null,
              direction: "outbound",
              phone: waPhone,
              message_type: "template",
              content: `Welcome to NIMT Educational Institutions, ${display_name || email}!\n\nYour account has been created.\nLogin: ${email}\nRole: ${roleLabel}\nCampus: ${campusLabel}\n\nPlease login at https://uni.nimt.ac.in to get started.\n\nFor any assistance, contact the admin office.`,
              template_key: "staff_welcome",
              status: "sent",
              is_read: true,
            });
          }
        }
      } catch (e) {
        console.error("Staff WhatsApp error:", e);
      }
    }

    // Send welcome email with credentials (if password was set)
    if (password) {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (resendApiKey) {
        try {
          // Fetch template from DB
          const { data: tpl } = await adminClient
            .from("email_templates")
            .select("subject, body_html")
            .eq("slug", "new-user-welcome")
            .eq("is_active", true)
            .single();

          if (tpl) {
            const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
            const vars: Record<string, string> = {
              display_name: display_name || email,
              email,
              password,
              role: roleLabel,
            };

            let subject = tpl.subject;
            let bodyHtml = tpl.body_html;
            for (const [k, v] of Object.entries(vars)) {
              const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
              subject = subject.replace(re, v);
              bodyHtml = bodyHtml.replace(re, v);
            }

            const emailFrom = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ from: emailFrom, to: [email], subject, html: bodyHtml }),
            });
          }
        } catch (e) {
          console.error("Welcome email failed:", e);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

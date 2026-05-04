import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email provider not configured. Set RESEND_API_KEY." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: accept either a logged-in user JWT OR a service-role JWT (for
    // server-side relays like notify-event). Service-role tokens don't have
    // an associated auth.users row so getUser() fails on them — decode the
    // payload and check role explicitly to short-circuit.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let user: { id: string | null } | null = null;
    let isServiceRole = false;
    const token = authHeader.slice(7);

    // Two paths to recognise service-role auth:
    //  (a) Legacy eyJ... JWT: decode payload, check role claim.
    //  (b) New sb_secret_... opaque key: direct string-equality vs env.
    if (token === serviceRoleKey) {
      isServiceRole = true;
      user = { id: null };
    } else {
      try {
        const [, payloadB64] = token.split(".");
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role") {
            isServiceRole = true;
            user = { id: null };
          }
        }
      } catch { /* fall through to user-token path */ }
    }

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error: authError } = await userClient.auth.getUser();
      if (authError || !data?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = { id: data.user.id };
    }

    const { template_slug, to_email, variables, lead_id, custom_subject, custom_body, cc } = await req.json();

    // Block emails to DNC leads
    if (lead_id) {
      const adminCheck = createClient(supabaseUrl, serviceRoleKey);
      const { data: leadCheck } = await adminCheck.from("leads").select("stage").eq("id", lead_id).single();
      if (leadCheck?.stage === "dnc") {
        return new Response(JSON.stringify({ error: "Lead is DNC — email not sent" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!to_email) {
      return new Response(JSON.stringify({ error: "to_email is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    let subject: string;
    let bodyHtml: string;
    let templateId: string | null = null;

    if (template_slug) {
      const { data: template } = await admin
        .from("email_templates")
        .select("*")
        .eq("slug", template_slug)
        .eq("is_active", true)
        .single();

      if (!template) {
        return new Response(JSON.stringify({ error: `Template not found: ${template_slug}` }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      templateId = template.id;
      subject = template.subject;
      bodyHtml = template.body_html;

      // Replace variables
      const vars = variables || {};
      for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
        subject = subject.replace(regex, String(value));
        bodyHtml = bodyHtml.replace(regex, String(value));
      }
    } else if (custom_subject && custom_body) {
      subject = custom_subject;
      bodyHtml = custom_body;
    } else {
      return new Response(JSON.stringify({ error: "template_slug or custom_subject+custom_body required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get profile id (skipped for service-role calls — no associated user)
    const { data: profile } = user?.id
      ? await admin.from("profiles").select("id").eq("user_id", user.id).single()
      : { data: null };

    // Inject email open tracking pixel
    const trackingBaseUrl = `${supabaseUrl}/functions/v1/track-engagement`;
    if (lead_id) {
      const pixelUrl = `${trackingBaseUrl}?t=email_open&lid=${lead_id}`;
      const pixelTag = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;
      // Insert before </body> or append to end
      if (bodyHtml.includes("</body>")) {
        bodyHtml = bodyHtml.replace("</body>", `${pixelTag}</body>`);
      } else {
        bodyHtml += pixelTag;
      }
    }

    // Send via Resend
    const fromEmail = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to_email],
        ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
        subject,
        html: bodyHtml,
      }),
    });

    const emailResult = await emailRes.json();
    const success = emailRes.ok;

    // Log to email_messages
    const { data: emailMsg } = await admin.from("email_messages").insert({
      lead_id: lead_id || null,
      to_email,
      from_email: fromEmail,
      subject,
      body_html: bodyHtml,
      template_id: templateId,
      status: success ? "sent" : "failed",
      provider_id: emailResult?.id || null,
      sent_by: profile?.id || null,
      sent_at: success ? new Date().toISOString() : null,
    }).select("id").single();

    // Log activity (user_id null for service-role / system-initiated sends)
    if (lead_id) {
      await admin.from("lead_activities").insert({
        lead_id,
        user_id: user?.id ?? null,
        type: "email",
        description: `Email ${success ? "sent" : "failed"}: ${subject}`,
      });
    }

    if (!success) {
      return new Response(
        JSON.stringify({ error: emailResult?.message || "Email send failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: emailResult?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Send email error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { template_slug, to_email, variables, lead_id, custom_subject, custom_body } = await req.json();

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

    // Get profile id
    const { data: profile } = await admin.from("profiles").select("id").eq("user_id", user.id).single();

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
        subject,
        html: bodyHtml,
      }),
    });

    const emailResult = await emailRes.json();
    const success = emailRes.ok;

    // Log to email_messages
    await admin.from("email_messages").insert({
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
    });

    // Log activity
    if (lead_id) {
      await admin.from("lead_activities").insert({
        lead_id,
        user_id: user.id,
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

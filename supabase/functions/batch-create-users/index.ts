import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USERS = [
  { display_name: "Aishwarya Sharma", email: "aishwarya.sharma@nimt.ac.in", phone: "+919599931443", role: "counsellor", campus: "Ghaziabad Campus 3 (Avantika II)" },
  { display_name: "Arun Choudhary", email: "arun.choudhary@nimt.ac.in", phone: "+918130507449", role: "counsellor", campus: "Ghaziabad Campus 3 (Avantika II)" },
  { display_name: "Nikki Bhati", email: "nikki.bhati@nimt.ac.in", phone: "+919667691872", role: "counsellor", campus: "Greater Noida Campus" },
  { display_name: "Ashraf Ali", email: "ashraf.ali@nimt.ac.in", phone: "+919599689503", role: "counsellor", campus: "Greater Noida Campus" },
  { display_name: "Shivam Gupta", email: "shivam.gupta@nimt.ac.in", phone: "+917200586882", role: "counsellor", campus: "Greater Noida Campus" },
  { display_name: "Rahul Bhati", email: "rahul.bhati@nimt.ac.in", phone: "+918171211128", role: "counsellor", campus: "Greater Noida Campus" },
  { display_name: "Ashish Choudhary", email: "ashish.choudhary@nimt.ac.in", phone: "+919534403126", role: "counsellor", campus: "Greater Noida Campus" },
  { display_name: "Ishu Rana", email: "ishu.rana@nimt.ac.in", phone: "+919548588758", role: "counsellor", campus: "Greater Noida Campus" },
];

const DEFAULT_PASSWORD = "Nimt@2026";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM") || "admissions@nimt.ac.in";

    const results: any[] = [];

    for (const u of USERS) {
      try {
        // 1. Create user with password
        const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
          email: u.email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { display_name: u.display_name, full_name: u.display_name },
        });

        if (createErr) {
          results.push({ name: u.display_name, status: "error", error: createErr.message });
          continue;
        }

        // 2. Upsert profile
        await admin.from("profiles").upsert({
          user_id: newUser.user.id,
          display_name: u.display_name,
          phone: u.phone,
          campus: u.campus,
        }, { onConflict: "user_id" });

        // 3. Assign role
        await admin.from("user_roles").insert({ user_id: newUser.user.id, role: u.role });

        // 4. Send WhatsApp (nimt_new_staff template: name, role, campus)
        let waSent = false;
        if (waToken && phoneNumberId) {
          const waPhone = u.phone.replace(/[^0-9]/g, "");
          const roleLabel = u.role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          const waRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: waPhone,
              type: "template",
              template: {
                name: "nimt_new_staff",
                language: { code: "en" },
                components: [{
                  type: "body",
                  parameters: [
                    { type: "text", text: u.display_name },
                    { type: "text", text: roleLabel },
                    { type: "text", text: u.campus },
                  ],
                }],
              },
            }),
          });
          waSent = waRes.ok;
          if (!waRes.ok) {
            const waErr = await waRes.json();
            console.error(`WhatsApp failed for ${u.display_name}:`, waErr?.error?.message);
          }
        }

        // 5. Send welcome email
        let emailSent = false;
        if (resendApiKey) {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: emailFrom,
              to: [u.email],
              subject: `Welcome to NIMT UniOs — Your Login Credentials`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
                <img src="https://uni.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" />
                <h2 style="color:#1e293b;margin:0 0 12px">Welcome, ${u.display_name}!</h2>
                <p style="color:#475569;line-height:1.6">Your account on NIMT UniOs has been created. Here are your login details:</p>
                <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
                  <p style="color:#1e293b;margin:0"><strong>Email:</strong> ${u.email}</p>
                  <p style="color:#1e293b;margin:4px 0 0"><strong>Password:</strong> ${DEFAULT_PASSWORD}</p>
                  <p style="color:#1e293b;margin:4px 0 0"><strong>Role:</strong> Counsellor</p>
                  <p style="color:#1e293b;margin:4px 0 0"><strong>Campus:</strong> ${u.campus}</p>
                </div>
                <p style="margin-top:16px"><a href="https://uni.nimt.ac.in" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Login to UniOs</a></p>
                <p style="color:#94a3b8;font-size:12px;margin-top:24px">Please change your password after first login.</p>
                <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
                <p style="color:#94a3b8;font-size:12px;margin:0">NIMT Educational Institutions — UniOs</p>
              </div>`,
            }),
          });
          emailSent = emailRes.ok;
        }

        results.push({
          name: u.display_name,
          email: u.email,
          campus: u.campus,
          status: "created",
          whatsapp: waSent ? "sent" : "failed",
          email_invite: emailSent ? "sent" : "failed",
        });

        // Small delay between users
        await new Promise(r => setTimeout(r, 300));
      } catch (e: any) {
        results.push({ name: u.display_name, status: "error", error: e.message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

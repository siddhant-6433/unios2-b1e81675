const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF = [
  { name: "Aishwarya Sharma", email: "aishwarya.sharma@nimt.ac.in", role: "Counsellor", campus: "Ghaziabad Campus 3 (Avantika II)" },
  { name: "Arun Choudhary", email: "arun.choudhary@nimt.ac.in", role: "Counsellor", campus: "Ghaziabad Campus 3 (Avantika II)" },
  { name: "Nikki Bhati", email: "nikki.bhati@nimt.ac.in", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Ashraf Ali", email: "ashraf.ali@nimt.ac.in", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Shivam Gupta", email: "shivam.gupta@nimt.ac.in", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Rahul Bhati", email: "rahul.bhati@nimt.ac.in", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Ashish Choudhary", email: "ashish.choudhary@nimt.ac.in", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Ishu Rana", email: "ishu.rana@nimt.ac.in", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Saiyed Faisal", email: "saiyed.faisal@nimt.ac.in", role: "Principal", campus: "Greater Noida Campus" },
];

const PASSWORD = "Nimt@2026";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM") || "NIMT UniOs <admissions@nimt.ac.in>";
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: any[] = [];

    for (const u of STAFF) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: emailFrom,
          to: [u.email],
          subject: "Welcome to NIMT UniOs — Your Login Credentials",
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <img src="https://uni.nimt.ac.in/unios-logo.png" alt="UniOs" style="height:40px;margin-bottom:16px" />
            <h2 style="color:#1e293b;margin:0 0 12px">Welcome, ${u.name}!</h2>
            <p style="color:#475569;line-height:1.6">Your account on <strong>NIMT UniOs</strong> (Admissions CRM) has been created. Here are your login details:</p>
            <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
              <p style="color:#1e293b;margin:0"><strong>Email:</strong> ${u.email}</p>
              <p style="color:#1e293b;margin:4px 0 0"><strong>Password:</strong> ${PASSWORD}</p>
              <p style="color:#1e293b;margin:4px 0 0"><strong>Role:</strong> ${u.role}</p>
              <p style="color:#1e293b;margin:4px 0 0"><strong>Campus:</strong> ${u.campus}</p>
            </div>
            <p style="margin-top:16px"><a href="https://uni.nimt.ac.in" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Login to UniOs</a></p>
            <p style="color:#94a3b8;font-size:12px;margin-top:24px">Please change your password after first login.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
            <p style="color:#94a3b8;font-size:12px;margin:0">NIMT Educational Institutions — UniOs</p>
          </div>`,
        }),
      });
      const data = await res.json();
      results.push({ name: u.name, email: u.email, ok: res.ok, error: data?.message || null });
      await new Promise(r => setTimeout(r, 600));
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

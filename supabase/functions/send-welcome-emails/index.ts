const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USERS = [
  { name: "Nikki Bhati", email: "nikki.bhati@nimt.ac.in", campus: "Greater Noida Campus" },
  { name: "Ashish Choudhary", email: "ashish.choudhary@nimt.ac.in", campus: "Greater Noida Campus" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("EMAIL_FROM") || "NIMT UniOs <admissions@nimt.ac.in>";
    const results: any[] = [];

    for (const u of USERS) {
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
            <p style="color:#475569;line-height:1.6">Your account on NIMT UniOs has been created. Here are your login details:</p>
            <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
              <p style="color:#1e293b;margin:0"><strong>Email:</strong> ${u.email}</p>
              <p style="color:#1e293b;margin:4px 0 0"><strong>Password:</strong> Nimt@2026</p>
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
      const data = await res.json();
      results.push({ name: u.name, email: u.email, ok: res.ok, response: data });
      await new Promise(r => setTimeout(r, 1500));
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

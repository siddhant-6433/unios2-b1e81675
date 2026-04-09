const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF = [
  { name: "Siddhant Singh", phone: "919871763193", role: "Super Admin", campus: "NIMT Educational Institutions" },
  { name: "Siddharth Singh", phone: "919910919892", role: "Super Admin", campus: "NIMT Educational Institutions" },
  { name: "Saiyed Faisal", phone: "919910108405", role: "Principal", campus: "Greater Noida Campus" },
  { name: "Aishwarya Sharma", phone: "919599931443", role: "Counsellor", campus: "Ghaziabad Campus 3 (Avantika II)" },
  { name: "Arun Choudhary", phone: "918130507449", role: "Counsellor", campus: "Ghaziabad Campus 3 (Avantika II)" },
  { name: "Nikki Bhati", phone: "919667691872", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Ashraf Ali", phone: "919599689503", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Shivam Gupta", phone: "917200586882", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Rahul Bhati", phone: "918171211128", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Ashish Choudhary", phone: "919534403126", role: "Counsellor", campus: "Greater Noida Campus" },
  { name: "Ishu Rana", phone: "919548588758", role: "Counsellor", campus: "Greater Noida Campus" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (!waToken || !phoneNumberId) {
      return new Response(JSON.stringify({ error: "WA not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: any[] = [];

    for (const s of STAFF) {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: s.phone,
          type: "template",
          template: {
            name: "nimt_new_staff",
            language: { code: "en" },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: s.name },
                { type: "text", text: s.role },
                { type: "text", text: s.campus },
              ],
            }],
          },
        }),
      });

      const data = await res.json();
      results.push({ name: s.name, phone: s.phone, ok: res.ok, error: data?.error?.message || null });

      await new Promise(r => setTimeout(r, 300));
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

// One-shot function to submit the ai_call_course_info WhatsApp template
Deno.serve(async () => {
  const wabaId = Deno.env.get("WHATSAPP_WABA_ID");
  const waToken = Deno.env.get("WHATSAPP_API_TOKEN");
  if (!wabaId || !waToken) return new Response(JSON.stringify({ error: "WABA not configured" }), { status: 503 });

  const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "ai_call_course_info",
      category: "UTILITY",
      language: "en",
      components: [{
        type: "BODY",
        text: "Hi {{1}}, thank you for speaking with us about {{2}} at NIMT Educational Institutions! 🎓\n\n🏫 Campus: {{3}}\n\n📄 Course Details: {{4}}\n📝 Apply Now: {{5}}\n\nFor questions, reply to this message or call our admissions team.\n\nWe look forward to welcoming you!",
        example: { body_text: [["Rahul", "B.Sc Nursing", "Greater Noida Campus", "https://www.nimt.ac.in/courses/bsc-nursing", "https://uni.nimt.ac.in/apply/nimt"]] },
      }],
    }),
  });
  const result = await res.json();
  return new Response(JSON.stringify({ status: res.status, result }), { headers: { "Content-Type": "application/json" } });
});

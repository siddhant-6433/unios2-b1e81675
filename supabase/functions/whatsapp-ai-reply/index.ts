import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── NIMT Knowledge Base ────────────────────────────────────────────────────

const KNOWLEDGE_BASE = `
NIMT (National Institute of Management and Technology) — founded 1987.
21 Higher Education Programs at 11 Colleges across 5 Campuses in Greater Noida (UP), Ghaziabad (UP), and Kotputli Jaipur (Rajasthan). 36+ programmes total.
Tagline: "Where Ambition Meets Action"

APPROVALS & AFFILIATIONS:
Approved by: AICTE, UGC, Bar Council of India (BCI), NCTE, Indian Nursing Council (INC), Pharmacy Council of India (PCI)
Affiliated to: AKTU, GGSIPU, ABVMU (Atal Bihari Vajpayee Medical University), ALU (Dr. Bhimrao Ambedkar Law University), CCSU, University of Rajasthan

RANKINGS & RECOGNITION:
- #1 in UP — EW Higher Education Rankings
- Ranked 34th B-School — Business India
- AA+ rated — Digital Learning Magazine
- 6 institutions NIRF ranked 2025
- #57 Law in India — India Today 2025
- PGDM ranked #8 in India

PLACEMENTS:
1,200+ corporate partners. 60+ companies visit campus annually.
Highest package: INR 18.75 LPA | Average: INR 5.40 LPA
Top recruiters: Fortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Kotak Mahindra, Infosys, Deloitte, TCS

CAMPUSES:
1. Greater Noida (Main) — Plot No. 41, Knowledge Park-1, Near Pari Chowk, Greater Noida, UP 201310. Houses: PGDM, MBA, BPT, BSc Nursing, BCA, BA LLB, LLB, D Pharma, BMRIT, GNM. On-campus parent hospital for clinical training.
2. Ghaziabad Arthala — Near Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007. NIMT Institute of Technology and Management. BBA, B.Ed, PGDM, MBA.
3. Ghaziabad Avantika — Ansal Avantika Colony, Shastri Nagar, Ghaziabad 201015. NIMT Beacon School (CBSE), B.Ed institutions.
4. Ghaziabad Avantika II — Avantika Extension Colony, Ghaziabad. Residential and day school campus.
5. Kotputli Jaipur — SP-3-1, RIICO Industrial Area, Keshwana, Kotputli, Jaipur 303108. 20-acre campus. Law, Management, Pharmacy, B.Ed. Affiliated to University of Rajasthan.

COURSES:

B.Sc Nursing:
- Duration: 4 Years (8 Semesters) + 6-month paid internship (Rs 10,000/month stipend)
- Campus: Greater Noida, Kotputli (Jaipur)
- Approved by: Indian Nursing Council (INC) | Affiliated to ABVMU
- Eligibility: 10+2 with Physics, Chemistry, Biology and English. Min 45%. Age 17+. Medically fit.
- Entrance: UPCNET / CPNET / merit-based
- Placements: Highest Rs 10 LPA, Average Rs 3 LPA. ~98% placement rate.
- Clinical training at NIMT's own parent hospital + GIMS, Navin Hospital, Manipal Hospital, VIMHANS Delhi, IHBAS Delhi

GNM (General Nursing & Midwifery):
- Duration: 3 Years + 6-month Internship
- Campus: Greater Noida
- UNIQUE: Open to Arts and Commerce students — Science NOT mandatory
- Eligibility: 10+2 from ANY stream. Min 40%. Age 17-35.
- Entrance: UPCNET / merit-based

BPT (Bachelor of Physiotherapy):
- Duration: 4.5 Years (8 Semesters + 6-month Internship)
- Campus: Greater Noida
- Eligibility: 10+2 with PCB. Min 45% (General), 40% (OBC/SC/ST). Age 17+.
- Entrance: CPET / UPCPAT
- Clinical training at NIMT hospital. Rotations: Orthopaedics, Neurology, Surgery, Medicine, Physiotherapy.

MBA:
- Duration: 2 Years (4 Semesters) | AKTU affiliated | AICTE approved
- Campus: Greater Noida, Ghaziabad
- Specialisations: Finance, Marketing, HR, Operations, IT, International Business, Insurance & Banking, Agri Business
- Eligibility: Bachelor's degree, min 50% (45% SC/ST/OBC). Valid CAT/MAT/XAT/CMAT/GMAT/SNAP/NMAT score.
- Placements: Highest INR 18.75 LPA, Average INR 5.40 LPA. Ranked 34th B-School.

PGDM:
- Duration: 2 Years (4 Semesters), Full-time Residential | AICTE approved
- Campus: Greater Noida, Ghaziabad, Kotputli (Jaipur)
- Ranked #8 in India. 60 students per campus — small batches.
- Specialisations: HR, Marketing, Operations, International Business, Insurance & Banking, Foreign Trade, Agri Business
- Eligibility: Bachelor's degree, min 50% (45% reserved). Valid CAT/MAT/XAT/CMAT score.

BA LLB / LLB:
- BA LLB: 5 Years integrated | LLB: 3 Years
- Campus: Greater Noida (main), Kotputli (Jaipur)
- Approved by Bar Council of India (BCI) | #57 Law in India (India Today 2025)
- BA LLB Eligibility: 12th pass, min 45%. Entrance: CLAT, LSAT, ULSAT.
- LLB Eligibility: Graduation any stream, min 45% (40% SC/ST/OBC). Merit-based / CLAT PG.
- Features: Moot Court room, Legal Aid clinic, MoU with CLAT Consortium

B.Ed:
- Duration: 2 Years (4 Semesters) | NCTE recognised
- Campus: Greater Noida (affiliated to CCSU), Ghaziabad Arthala, Kotputli Jaipur (NIMT Mahila B.Ed College — women's, University of Rajasthan)
- Eligibility: Arts/Science/Humanities graduates, min 50% (45% SC/ST). B.E./B.Tech: min 55%.
- Entrance: UP B.Ed JEE (Greater Noida/Ghaziabad), PTET (Kotputli)

BCA:
- Duration: 3 Years (6 Semesters) | Campus: Greater Noida
- Eligibility: 12th with Mathematics, min 45-50%.
- Entrance: Merit-based / JEECUP
- Technologies: C, C++, Java, Python, Web Dev, SQL, Cloud, Mobile Apps, Cybersecurity basics

BBA:
- Duration: 3 Years (6 Semesters) | Campus: Greater Noida, Ghaziabad Arthala
- Specialisations: Finance, Marketing, HR, Strategy & Entrepreneurship, International Business, Supply Chain
- Eligibility: 12th any stream, min 45%.
- Entrance: Merit-based (Class 12 marks). 120 student intake.

BMRIT (B.Sc Medical Radiology & Imaging Technology):
- Duration: 4 Years (including internship) | Campus: Greater Noida
- Eligibility: 10+2 with Biology, min 45%. No entrance exam required.
- Training in X-ray, CT scan, MRI, Ultrasound, Nuclear Medicine at NIMT hospital.

D Pharma:
- Duration: 2 Years + 3-month practical training | Campus: Greater Noida
- Approved by Pharmacy Council of India (PCI)
- Eligibility: 10+2 Science with PCB or PCM, min 50%.
- Entrance: JEECUP / merit-based. Pathway to B Pharma lateral entry.

NIMT Beacon School (K-12):
- CBSE affiliated, Nursery to Grade XII | Campus: Ghaziabad (Avantika / Avantika II)
- Smart classrooms, science labs, computer labs, sports, transport
- Day boarding with lunch: Rs 4,000/month. Boarding options available.
- Admission: Age-appropriate interaction/assessment

Mirai Experiential School (IB World School):
- IB PYP and MYP programmes | Campus: Ghaziabad
- Inquiry-based, experiential learning. Small class sizes. Bilingual (English + Hindi).
- Only IB World School in the region.
- Admission: Age-appropriate interaction

FEE STRUCTURE (First Year / Annual Fee):
- B.Sc Nursing: ₹1,53,000/year | Greater Noida campus
- GNM: ₹1,18,000/year | Greater Noida campus
- BPT (Physiotherapy): ₹92,000/year | Greater Noida campus
- MBA: ₹1,30,000/year | Greater Noida campus
- PGDM: ₹2,25,000/year | Greater Noida & Kotputli campuses
- BA LLB (5-year integrated): ₹1,10,000/year | Greater Noida campus
- LLB (3-year): ₹44,250/year | Greater Noida & Kotputli campuses
- B.Ed: ₹56,000/year (Greater Noida & Ghaziabad) | ₹27,000/year (Kotputli)
- BCA: ₹75,000/year | Greater Noida campus
- BBA: ₹75,000/year | Greater Noida & Ghaziabad campuses
- BMRIT: ₹92,000/year | Greater Noida campus
- D.Pharma: ₹95,000/year | Greater Noida campus
- DPT (Diploma Physiotherapy): ₹62,000/year | Greater Noida campus
- D.El.Ed: ₹45,000/year | Ghaziabad campus
- OTT (Operation Theater Technician): ₹62,000/year | Greater Noida campus
- MPT (Masters Physiotherapy): ₹89,000/year | Greater Noida campus
- MMRIT (M.Sc Radiology): ₹89,000/year | Greater Noida campus
Note: These are first-year fees. Subsequent years may vary. Scholarships available for merit/SC/ST/OBC. Contact admissions for complete fee breakup.

ADMISSIONS:
- Apply online: https://uni.nimt.ac.in/apply/nimt (also: apply.nimt.ac.in)
- Application fee: Rs 500-1,000 (varies by course)
- Application window: January–July | Admission deadline: September | Academic year: Aug/Sep
- Helpline: +91 9555192192

SCHOLARSHIPS:
- Merit-based scholarships for top academic performers
- Special scholarships for SC/ST/OBC categories
- Sports scholarships for national/state level athletes
- Nursing scholarships supported by INC guidelines
- Alumni referral discounts available
- Contact admissions office for current scholarship schemes: +91 9555192192

FACILITIES:
- Modern classrooms with smart boards
- Advanced labs (science, computer, clinical)
- Library with digital access
- On-campus parent hospital (Greater Noida campus) for nursing/paramedical students
- Hostels: 600+ capacity, AC and non-AC options, separate for boys and girls
- Cafeteria, gym, sports grounds
- Wi-Fi campus, transport facility
`;

function buildSystemPrompt(hasName: boolean, hasCourse: boolean): string {
  const introInstructions = `\n\nLEAD ENRICHMENT:
${!hasName ? "The student's name is not yet known. If they mention their name, extract it." : ""}
${!hasCourse ? "The student's course interest is not yet known." : ""}
CRITICAL RULE: If the user's message mentions or asks about a specific course (like "BPT", "MBA", "nursing", "BCA", etc.), IMMEDIATELY answer their question about that course using the knowledge base. Do NOT ask them which course they are interested in — they just told you. Extract the course name and provide the information.
Only ask for missing info (name or course) if the user's message does NOT contain any course reference or name. Never ask for something the user already provided in their message.
When you detect name or course in the user's message, include at the END of your response:
{"extracted_name": "...", "extracted_course": "..."}
Only include fields that are newly detected. If the user said "bpt", include extracted_course. If they said "I'm Priya", include extracted_name.`;

  const classificationInstructions = `

QUERY CLASSIFICATION:
At the very end of every response, include this JSON:
{"query_type": "admission" | "non_admission", "confidence": 0.0 to 1.0}
- "admission": questions about courses, fees, eligibility, placements, campus, hostel, scholarships, application process
- "non_admission": general queries, complaints, feedback, job inquiries, vendor queries, alumni requests
- confidence: 1.0 = answered from knowledge base, 0.5 = inferred, 0.0 = couldn't answer`;

  return `You are an AI admissions assistant for NIMT Educational Institutions (National Institute of Management and Technology). You help prospective students and parents with questions about admissions, courses, fees, campus, eligibility and more.

Use the knowledge base below to answer questions accurately. Be friendly, helpful, and concise — this is WhatsApp, so keep replies short (max 3-4 paragraphs) and use bullet points or line breaks for clarity. Avoid long walls of text.

FORMATTING RULES (WhatsApp):
- Never use markdown links like [text](url). Just paste the plain URL directly.
- Use *bold* with single asterisks for emphasis (WhatsApp format).
- Use line breaks for readability. No HTML tags.

LANGUAGE RULES (follow strictly):
- If the user writes in English → reply in English. This is the default.
- If the user writes in Hindi (Devanagari script) → reply in Hindi.
- If the user writes in Hinglish (Hindi words in English script) → reply in Hinglish.
- When in doubt, lean towards English. English is the default language.
- Match the user's language from their CURRENT message, not previous ones.
- Keep the tone professional but warm regardless of language.

Always end with a helpful call to action (e.g., visit portal, call helpline, or say a counsellor will contact them).

If you don't know something specific, say you'll have a counsellor share the details and provide the helpline number (+91 9555192192).

Do NOT make up information not present in the knowledge base.${introInstructions}${classificationInstructions}

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}`;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, message, lead_name, lead_stage, course_interest, recent_messages } = await req.json();

    if (!phone || !message) {
      return new Response(JSON.stringify({ error: "phone and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const googleApiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY")!;

    // Check if a counsellor manually replied in the last 30 minutes — skip AI if so
    // Auto-replies are tagged template_key="auto_reply"; AI replies tagged "ai_auto_reply"
    // Only untagged outbound messages are genuine counsellor replies
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentCounsellorReply } = await admin
      .from("whatsapp_messages")
      .select("id")
      .eq("phone", phone)
      .eq("direction", "outbound")
      .gte("created_at", thirtyMinsAgo)
      .is("template_key", null)
      .limit(1);

    if (recentCounsellorReply && recentCounsellorReply.length > 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "counsellor_replied_recently" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Find or create lead ──────────────────────────────────────────────────
    const normalizedPhone = phone.replace(/[^0-9]/g, "");
    const { data: existingLeads } = await admin
      .from("leads")
      .select("id, name, course_id")
      .or(`phone.eq.${normalizedPhone},phone.eq.${normalizedPhone.replace(/^91/, "+91")},phone.eq.+${normalizedPhone}`)
      .limit(1);

    const existingLead = existingLeads?.[0] || null;
    let leadId = existingLead?.id || null;
    const hasName = !!(existingLead?.name && existingLead.name.trim().length > 1);
    const hasCourse = !!(existingLead?.course_id || course_interest);

    // Auto-create lead if doesn't exist
    if (!leadId) {
      const { data: newLead } = await admin
        .from("leads")
        .insert({
          phone: normalizedPhone.length === 10 ? `91${normalizedPhone}` : normalizedPhone,
          source: "whatsapp",
          stage: "new_lead",
          name: lead_name || null,
        })
        .select("id")
        .single();
      leadId = newLead?.id || null;
      console.log("Auto-created lead from WhatsApp:", leadId);
    }

    // Build conversation context
    const contextParts: { role: string; parts: { text: string }[] }[] = [];
    if (recent_messages && recent_messages.length > 0) {
      for (const msg of recent_messages.slice(-6)) {
        contextParts.push({
          role: msg.direction === "inbound" ? "user" : "model",
          parts: [{ text: msg.content || "[media]" }],
        });
      }
    }
    const leadContext = lead_name
      ? `[Lead info: Name=${lead_name}, Stage=${lead_stage || "unknown"}, Course interest=${course_interest || "not specified"}]\n\n`
      : "";
    contextParts.push({ role: "user", parts: [{ text: leadContext + message }] });

    // Call Gemini with dynamic system prompt
    const systemPrompt = buildSystemPrompt(hasName, hasCourse);
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: contextParts,
          generationConfig: { temperature: 0.4, maxOutputTokens: 400, topP: 0.9 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini error:", errText);
      return new Response(JSON.stringify({ error: "AI generation failed", detail: errText }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiRes.json();
    const rawReply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawReply) {
      return new Response(JSON.stringify({ error: "empty AI response" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse all JSON blocks from AI response ────────────────────────────
    // Match any JSON object in the response (extracted info, classification, etc.)
    const jsonBlocks = rawReply.match(/\{[^{}]*"(?:extracted_name|extracted_course|query_type|confidence)"[^{}]*\}/g) || [];

    let extractedName: string | null = null;
    let extractedCourse: string | null = null;
    let queryType = "admission";
    let confidence = 0.5;

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (parsed.extracted_name) extractedName = parsed.extracted_name.trim().slice(0, 100);
        if (parsed.extracted_course) extractedCourse = parsed.extracted_course.trim().slice(0, 100);
        if (parsed.query_type) queryType = parsed.query_type;
        if (parsed.confidence !== undefined) confidence = parsed.confidence;
      } catch { /* ignore parse errors */ }
    }

    // Enrich lead with extracted info
    if (leadId) {
      if (extractedName) {
        await admin.from("leads").update({ name: extractedName }).eq("id", leadId);
        console.log("Enriched lead name:", leadId, extractedName);
      }
      if (extractedCourse) {
        await admin.from("lead_notes").insert({
          lead_id: leadId,
          content: `Course interest (from WhatsApp): ${extractedCourse}`,
          user_id: null,
        }).then(() => console.log("Logged course interest:", extractedCourse));
      }
    }

    // Clean AI reply — remove ALL JSON blocks
    const aiReply = rawReply
      .replace(/\{[^{}]*"(?:extracted_name|extracted_course|query_type|confidence)"[^{}]*\}/g, "")
      .trim();

    // ── Route non-admission queries to profile_queries ──────────────────────
    if (queryType === "non_admission" && leadId) {
      await admin.from("profile_queries").insert({
        phone: normalizedPhone,
        lead_id: leadId,
        query_text: message,
        ai_response: aiReply,
        status: "pending",
      });
    }

    // ── Log knowledge gap if low confidence ─────────────────────────────────
    if (confidence < 0.6 && queryType === "admission") {
      await admin.from("knowledge_gaps").insert({
        query_text: message,
        context: { course: course_interest || "unknown", lead_id: leadId },
        source: "whatsapp",
        confidence_score: confidence,
        status: "pending",
      });
    }

    // ── Send via WhatsApp API ───────────────────────────────────────────────
    const waToken = Deno.env.get("WHATSAPP_API_TOKEN")!;
    const pnId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
    const waPhone = phone.replace(/[^0-9]/g, "");

    const waRes = await fetch(`https://graph.facebook.com/v21.0/${pnId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: waPhone,
        type: "text",
        text: { body: aiReply },
      }),
    });

    const waResult = await waRes.json();
    if (!waRes.ok) {
      console.error("WhatsApp send failed:", waResult);
      return new Response(JSON.stringify({ error: "WhatsApp send failed", detail: waResult }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log outbound AI reply
    await admin.from("whatsapp_messages").insert({
      lead_id: leadId,
      wa_message_id: waResult?.messages?.[0]?.id || null,
      direction: "outbound",
      phone,
      message_type: "text",
      content: aiReply,
      status: "sent",
      is_read: true,
      template_key: "ai_auto_reply",
    });

    return new Response(JSON.stringify({ success: true, reply: aiReply, query_type: queryType }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("AI reply error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

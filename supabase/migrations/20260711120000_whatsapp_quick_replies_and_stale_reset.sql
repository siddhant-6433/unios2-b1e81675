-- Quick replies: move from hardcoded array to DB-managed table
-- + reset stale human-mode conversations so AI replies resume

-- ── Quick replies table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  text text NOT NULL,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.whatsapp_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active quick replies"
  ON public.whatsapp_quick_replies FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage quick replies"
  ON public.whatsapp_quick_replies FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('super_admin', 'admission_head', 'campus_admin')
    )
  );

GRANT SELECT ON public.whatsapp_quick_replies TO authenticated;
GRANT ALL ON public.whatsapp_quick_replies TO service_role;

-- ── Seed data: existing 9 + 10 new ────────────────────────────────────────

INSERT INTO public.whatsapp_quick_replies (label, text, sort_order) VALUES
-- Existing 9
('Greeting', E'Hi! 👋 Welcome to NIMT Educational Institutions. How can I help you today?', 1),
('Ask course', E'Which course are you interested in? We offer Engineering, Management, Law, Pharmacy, Nursing, Education and more.', 2),
('Share portal', E'You can apply online at our application portal:\nhttps://uni.nimt.ac.in/apply/nimt', 3),
('Fee info', E'You can view NIMT''s detailed 2026-27 fee structure here:\nhttps://nimt.ac.in/admissions/fees/\n\nPopular first-year fees include B.Sc Nursing ₹1,53,000, GNM ₹1,18,000, BPT ₹92,000, MBA ₹1,30,000, PGDM ₹2,25,000, BBA/BCA ₹75,000 and LLB ₹44,250. Merit scholarships and education loan support are available.\n\nPlease share your course and campus preference, and I can send the exact year-wise breakdown.', 4),
('Schedule visit', E'We''d love to have you visit our campus! 🏫 Please share your preferred date and the campus you''d like to visit.', 5),
('Counsellor connect', E'Our counsellor will connect with you shortly. Thank you for your patience!', 6),
('Documents needed', E'For admission, please keep these documents ready:\n📄 10th & 12th marksheets\n📄 Aadhaar card\n📄 Passport-size photo\n📄 Transfer certificate', 7),
('Thank you', E'Thank you for reaching out! 😊 Feel free to contact us anytime if you have more questions.', 8),
('Campus video', E'🎥 Here''s a look at our campus and facilities:\nhttps://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK', 9),
-- New 10
('Hostel info', E'🏠 *NIMT Hostel Facilities*\n\n• 600+ bed capacity across campuses\n• AC and non-AC rooms available\n• Separate hostels for boys and girls\n• Cafeteria with hygienic meals\n• Gym, sports grounds, Wi-Fi\n• 24/7 security and warden support\n• Transport facility available\n\nWould you like to know the hostel fees or book a campus visit?', 10),
('BPT/BMRIT CAHET', E'📋 *BPT & BMRIT Admission 2026-27*\n\nAdmission is through *CAHET counselling* conducted by ABVMU Lucknow.\n• NEET UG is exempt this year\n• Eligibility: 10+2 PCB + English, min 50% (40% reserved/PwD)\n• Register at the ABVMU counselling portal when open\n\nNeed help with the counselling process? Our team can guide you — call +91 9555192192.', 11),
('Nursing eligibility', E'🏥 *B.Sc Nursing Eligibility*\n\n• 10+2 with Physics, Chemistry, Biology and English\n• Minimum 45% aggregate\n• Age: 17 years or above\n• Entrance: UPCNET / CPNET / merit-based\n• Duration: 4 years + 6-month paid internship (₹10,000/month stipend!)\n\nWant to apply? https://uni.nimt.ac.in/apply/nimt', 12),
('GNM — no science needed', E'✨ *Did you know?* GNM (General Nursing & Midwifery) at NIMT is open to *Arts and Commerce students* too!\n\n• Science is NOT mandatory\n• 10+2 from any stream, min 40%\n• Age: 17-35 years\n• 3 years + 6-month internship\n\nThis is a unique opportunity for non-science students to enter healthcare. Interested?', 13),
('Placement stats', E'💼 *NIMT Placement Highlights*\n\n📈 Highest: INR 18.75 LPA\n📊 Average: INR 5.40 LPA\n🏢 1,200+ corporate partners\n🎯 60+ companies visit campus annually\n\nTop recruiters: Fortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Infosys, Deloitte, TCS\n\nWant course-specific placement details?', 14),
('Scholarship info', E'🎓 *NIMT Scholarships*\n\n🏅 Merit — for top academic performers\n🤝 SC/ST/OBC — as per government norms\n⚽ Sports — national/state level athletes\n🏥 Nursing — supported by INC guidelines\n👥 Alumni referral discount\n\nFor eligibility and current amounts: +91 9555192192\nApply: https://uni.nimt.ac.in/apply/nimt', 15),
('Documents checklist (detailed)', E'📋 *Documents Required for Admission*\n\n✅ 10th marksheet & certificate\n✅ 12th marksheet & certificate\n✅ Graduation marksheet (if applicable)\n✅ Transfer certificate (TC)\n✅ Migration certificate\n✅ Character certificate\n✅ Aadhaar card (front & back)\n✅ 4 passport-size photos\n✅ Category certificate (if SC/ST/OBC)\n✅ Income certificate (for scholarship)\n✅ Medical fitness certificate\n\nPlease carry originals + 2 photocopies of each.', 16),
('Callback offer', E'Noted! 📞 Our admissions counsellor will call you back within 30 minutes to help with your queries.\n\nIf urgent, you can also call us directly: +91 9555192192', 17),
('Hindi greeting', E'नमस्ते! 🙏 NIMT Educational Institutions में आपका स्वागत है।\n\nआप किस कोर्स में रुचि रखते हैं? हम Nursing, BPT, MBA, Law, BCA, BBA, Pharmacy और कई अन्य कोर्स ऑफर करते हैं।\n\nजानकारी के लिए पूछें या कॉल करें: +91 9555192192', 18),
('Admission timeline', E'📅 *NIMT Admission Timeline 2026-27*\n\n• Applications open: January – July\n• Admission deadline: September 2026\n• Academic session starts: August/September\n• Application fee: ₹500-1,000 (varies by course)\n\nApply now: https://uni.nimt.ac.in/apply/nimt\n\nSeats are limited — apply early to secure your spot!', 19);

-- ── Reset stale human-mode conversations ───────────────────────────────────
-- Conversations stuck in human mode with no counsellor reply in 48 hours
-- should be flipped back to AI so students get responses.

UPDATE public.whatsapp_conversation_state cs
SET mode = 'ai',
    state = 'new_unqualified',
    escalation_role = NULL,
    handoff_reason = NULL,
    priority = 'normal',
    updated_at = now()
WHERE cs.mode = 'human'
  AND cs.state IN ('needs_counsellor', 'human_active')
  AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_messages wm
    WHERE wm.phone = cs.phone
      AND wm.direction = 'outbound'
      AND wm.template_key IS NULL
      AND wm.created_at > now() - interval '48 hours'
  );

-- Also reset the legacy ai_mode table
UPDATE public.whatsapp_ai_mode am
SET mode = 'ai',
    updated_at = now()
WHERE am.mode = 'human'
  AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_messages wm
    WHERE wm.phone = am.phone
      AND wm.direction = 'outbound'
      AND wm.template_key IS NULL
      AND wm.created_at > now() - interval '48 hours'
  );

-- ── Buffer worker cron ─────────────────────────────────────────────────────
-- Process pending whatsapp_message_buffers every 2 minutes.
-- This catches buffers orphaned when the orchestrator fails (e.g. Gemini 403)
-- and serves as the retry mechanism. Uses the same cron secret as other jobs.

SELECT cron.schedule(
  'whatsapp-buffer-worker',
  '*/2 * * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-buffer-worker',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{"limit": 50}'::jsonb
    )
  $$
);

-- ── Followup template for older unanswered messages ────────────────────────
-- Messages older than 24h where WhatsApp window has expired need a template.
-- Insert scheduled sends for the nimt_followup_v2 template.

INSERT INTO public.whatsapp_scheduled_sends (phone, template_key, lead_id, params, send_at, status)
SELECT
  wm.phone,
  'nimt_followup_v2',
  wm.lead_id,
  jsonb_build_array(
    COALESCE(l.name, 'there'),
    'today'
  ),
  now(),
  'pending'
FROM whatsapp_messages wm
LEFT JOIN leads l ON l.id = wm.lead_id
LEFT JOIN whatsapp_conversation_state cs
  ON cs.phone = regexp_replace(wm.phone, '[^0-9]', '', 'g')
  AND cs.business_number = COALESCE(wm.business_phone_number_id, '')
WHERE wm.direction = 'inbound'
  AND wm.message_type = 'text'
  AND wm.content IS NOT NULL AND wm.content != ''
  AND wm.created_at > now() - interval '7 days'
  AND wm.created_at < now() - interval '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_messages om
    WHERE om.phone = wm.phone
      AND om.direction = 'outbound'
      AND om.created_at > wm.created_at
  )
  AND (cs.mode IS NULL OR cs.mode = 'ai')
  AND (l.stage IS NULL OR l.stage NOT IN ('dnc', 'not_interested'))
  AND (l.person_role IS NULL OR l.person_role = 'lead')
  AND wm.lead_id IS NOT NULL
  -- Avoid duplicate scheduled sends
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_scheduled_sends ss
    WHERE ss.phone = wm.phone
      AND ss.template_key = 'nimt_followup_v2'
      AND ss.created_at > now() - interval '7 days'
  )
ON CONFLICT DO NOTHING;

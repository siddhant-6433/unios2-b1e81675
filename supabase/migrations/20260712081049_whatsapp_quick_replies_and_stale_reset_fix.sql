-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712081049 name=whatsapp_quick_replies_and_stale_reset_fix applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP POLICY IF EXISTS "Admins can manage quick replies" ON public.whatsapp_quick_replies;
CREATE POLICY "Admins can manage quick replies"
  ON public.whatsapp_quick_replies FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
  );

INSERT INTO public.whatsapp_quick_replies (label, text, sort_order) VALUES
('Greeting', E'Hi! Welcome to NIMT Educational Institutions. How can I help you today?', 1),
('Ask course', E'Which course are you interested in? We offer Engineering, Management, Law, Pharmacy, Nursing, Education and more.', 2),
('Share portal', E'You can apply online at our application portal:\nhttps://uni.nimt.ac.in/apply/nimt', 3),
('Fee info', E'You can view NIMT''s detailed 2026-27 fee structure here:\nhttps://nimt.ac.in/admissions/fees/', 4),
('Schedule visit', E'We''d love to have you visit our campus! Please share your preferred date and the campus you''d like to visit.', 5),
('Counsellor connect', E'Our counsellor will connect with you shortly. Thank you for your patience!', 6),
('Documents needed', E'For admission, please keep these documents ready:\n- 10th & 12th marksheets\n- Aadhaar card\n- Passport-size photo\n- Transfer certificate', 7),
('Thank you', E'Thank you for reaching out! Feel free to contact us anytime if you have more questions.', 8),
('Campus video', E'Here''s a look at our campus and facilities:\nhttps://youtu.be/CyLpFGx67u4?si=7CepKXL3Dm2GfmaK', 9),
('Hostel info', E'*NIMT Hostel Facilities*\n\n- 600+ bed capacity across campuses\n- AC and non-AC rooms available\n- Separate hostels for boys and girls\n- Cafeteria with hygienic meals\n- Gym, sports grounds, Wi-Fi\n- 24/7 security and warden support\n\nWould you like to know the hostel fees or book a campus visit?', 10),
('BPT/BMRIT CAHET', E'*BPT & BMRIT Admission 2026-27*\n\nAdmission is through *CAHET counselling* conducted by ABVMU Lucknow.\n- NEET UG is exempt this year\n- Eligibility: 10+2 PCB + English, min 50%%\n\nNeed help? Call +91 9555192192.', 11),
('Nursing eligibility', E'*B.Sc Nursing Eligibility*\n\n- 10+2 with Physics, Chemistry, Biology and English\n- Minimum 45%% aggregate\n- Age: 17 years or above\n- Duration: 4 years + 6-month paid internship\n\nWant to apply? https://uni.nimt.ac.in/apply/nimt', 12),
('GNM no science needed', E'*Did you know?* GNM at NIMT is open to Arts and Commerce students too!\n\n- Science is NOT mandatory\n- 10+2 from any stream, min 40%%\n- Age: 17-35 years\n- 3 years + 6-month internship\n\nInterested?', 13),
('Placement stats', E'*NIMT Placement Highlights*\n\nHighest: INR 18.75 LPA\nAverage: INR 5.40 LPA\n1,200+ corporate partners\n60+ companies visit campus annually\n\nWant course-specific placement details?', 14),
('Scholarship info', E'*NIMT Scholarships*\n\nMerit, SC/ST/OBC, Sports, Nursing (INC), Alumni referral\n\nFor eligibility: +91 9555192192\nApply: https://uni.nimt.ac.in/apply/nimt', 15),
('Documents checklist detailed', E'*Documents Required for Admission*\n\n- 10th marksheet & certificate\n- 12th marksheet & certificate\n- Graduation marksheet (if applicable)\n- Transfer certificate (TC)\n- Migration certificate\n- Character certificate\n- Aadhaar card\n- 4 passport-size photos\n- Category certificate (if SC/ST/OBC)\n- Income certificate (for scholarship)\n- Medical fitness certificate\n\nPlease carry originals + 2 photocopies of each.', 16),
('Callback offer', E'Noted! Our admissions counsellor will call you back within 30 minutes.\n\nIf urgent, call us directly: +91 9555192192', 17),
('Hindi greeting', E'नमस्ते! NIMT Educational Institutions में आपका स्वागत है।\n\nआप किस कोर्स में रुचि रखते हैं?\n\nजानकारी के लिए कॉल करें: +91 9555192192', 18),
('Admission timeline', E'*NIMT Admission Timeline 2026-27*\n\n- Applications open: January - July\n- Admission deadline: September 2026\n- Application fee: Rs 500-1,000\n\nApply now: https://uni.nimt.ac.in/apply/nimt', 19)
ON CONFLICT DO NOTHING;

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

INSERT INTO public.whatsapp_scheduled_sends (phone, template_key, lead_id, params, send_at, status)
SELECT
  wm.phone,
  'nimt_followup_v2',
  wm.lead_id,
  jsonb_build_array(COALESCE(l.name, 'there'), 'today'),
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
    WHERE om.phone = wm.phone AND om.direction = 'outbound' AND om.created_at > wm.created_at
  )
  AND (cs.mode IS NULL OR cs.mode = 'ai')
  AND (l.stage IS NULL OR l.stage NOT IN ('dnc', 'not_interested'))
  AND (l.person_role IS NULL OR l.person_role = 'lead')
  AND wm.lead_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_scheduled_sends ss
    WHERE ss.phone = wm.phone AND ss.template_key = 'nimt_followup_v2' AND ss.created_at > now() - interval '7 days'
  )
ON CONFLICT DO NOTHING;

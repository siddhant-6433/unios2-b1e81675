-- Hiring communications: a sender address per template, and the HR email set.
--
-- Every email in this system currently leaves from one global address —
-- send-email reads EMAIL_FROM and defaults to admissions@nimt.ac.in — so an
-- interview invite would arrive from Admissions. Putting the sender on the
-- template makes it configuration rather than another env var, and keeps
-- admissions mail exactly where it is.

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS from_email text;

COMMENT ON COLUMN public.email_templates.from_email IS
  'Overrides EMAIL_FROM for this template. HR mail leaves from hr@nimt.ac.in so a '
  'candidate replying reaches HR rather than Admissions.';

-- The category CHECK predates HR having any mail of its own; inserting with a new
-- category value without widening it fails the whole statement.
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_category_check;
ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_category_check
  CHECK (category = ANY (ARRAY['offer_letter','fee_receipt','admission_confirmation',
                               'general','reminder','notification','hr']));

-- Everything HR sends comes from HR.
UPDATE public.email_templates
   SET from_email = 'hr@nimt.ac.in'
 WHERE category = 'hr' AND from_email IS NULL;

-- ── The hiring email set ───────────────────────────────────────────────
-- One per stage a candidate actually experiences. Sourced gets a real
-- acknowledgement (today they get one WhatsApp line and nothing else), Interview
-- carries the scheduled time, Preboarding is the offer, Archived is a decline that
-- reads like a person wrote it.
INSERT INTO public.email_templates (name, slug, subject, body_html, variables, category, is_active, from_email)
VALUES
(
  'Hiring — application received',
  'hiring-acknowledgement',
  'We have your application, {{candidate_name}}',
  '<p>Dear {{candidate_name}},</p>
<p>Thank you for your interest in {{role}} at NIMT Educational Institutions. Your application has reached our HR team and is being reviewed.</p>
<p>If your profile matches what we are looking for, we will be in touch to arrange a conversation. Either way we will let you know — you will not be left waiting.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
  ARRAY['candidate_name','role'], 'hr', true, 'hr@nimt.ac.in'
),
(
  'Hiring — interview invitation',
  'hiring-interview-invite',
  'Interview for {{role}} — {{interview_when}}',
  '<p>Dear {{candidate_name}},</p>
<p>We would like to meet you regarding the {{role}} position.</p>
<p><strong>When:</strong> {{interview_when}}<br/>
<strong>Where:</strong> {{interview_where}}<br/>
<strong>Round:</strong> {{round_name}}</p>
<p>Please bring a copy of your CV and any relevant certificates. If this time does not suit you, reply to this email and we will find another.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
  ARRAY['candidate_name','role','interview_when','interview_where','round_name'], 'hr', true, 'hr@nimt.ac.in'
),
(
  'Hiring — offer',
  'hiring-offer',
  'Offer of employment — {{role}}',
  '<p>Dear {{candidate_name}},</p>
<p>Following your interviews, we are pleased to offer you the position of <strong>{{role}}</strong> at NIMT Educational Institutions.</p>
<p><strong>Proposed joining date:</strong> {{joining_date}}</p>
<p>Your formal appointment letter and the documents we will need from you follow separately. If you have questions about the offer, reply to this email and HR will help.</p>
<p>We hope you will join us.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
  ARRAY['candidate_name','role','joining_date'], 'hr', true, 'hr@nimt.ac.in'
),
(
  'Hiring — not proceeding',
  'hiring-regret',
  'Your application for {{role}}',
  '<p>Dear {{candidate_name}},</p>
<p>Thank you for taking the time to apply for {{role}} at NIMT Educational Institutions, and for your patience through our process.</p>
<p>On this occasion we will not be taking your application further. This is not a reflection of your ability — we often have more strong candidates than positions.</p>
<p>We would be glad to hear from you again for future openings.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
  ARRAY['candidate_name','role'], 'hr', true, 'hr@nimt.ac.in'
)
ON CONFLICT (slug) DO UPDATE
  SET subject    = EXCLUDED.subject,
      body_html  = EXCLUDED.body_html,
      variables  = EXCLUDED.variables,
      category   = EXCLUDED.category,
      from_email = EXCLUDED.from_email,
      is_active  = true,
      updated_at = now();

-- ── What was actually sent ─────────────────────────────────────────────
-- So HR can see, on the candidate, that the regret mail went out — and so a stage
-- moved twice does not send the same message twice.
CREATE TABLE IF NOT EXISTS public.hiring_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES public.job_applicants(id) ON DELETE CASCADE,
  stage        text NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('whatsapp','email')),
  template_key text NOT NULL,
  status       text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
  detail       text,
  sent_by      uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hiring_notifications_applicant_idx
  ON public.hiring_notifications (applicant_id, created_at DESC);

-- One successful send per applicant per stage per channel. A second stage move
-- must not re-send a rejection somebody has already received.
CREATE UNIQUE INDEX IF NOT EXISTS hiring_notifications_once_idx
  ON public.hiring_notifications (applicant_id, stage, channel)
  WHERE status = 'sent';

ALTER TABLE public.hiring_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR reads hiring notifications" ON public.hiring_notifications;
CREATE POLICY "HR reads hiring notifications"
  ON public.hiring_notifications FOR SELECT TO authenticated
  USING ('hr:view' = ANY (public.get_user_permissions(auth.uid())));

DROP POLICY IF EXISTS "HR writes hiring notifications" ON public.hiring_notifications;
CREATE POLICY "HR writes hiring notifications"
  ON public.hiring_notifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')
         OR 'hr:recruitment_edit' = ANY (public.get_user_permissions(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin')
         OR 'hr:recruitment_edit' = ANY (public.get_user_permissions(auth.uid())));

GRANT SELECT, INSERT, UPDATE ON public.hiring_notifications TO authenticated;
GRANT ALL ON public.hiring_notifications TO service_role;

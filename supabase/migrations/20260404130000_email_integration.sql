-- Sprint 4 Feature 4: Email Integration

-- Email templates
CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  variables text[] DEFAULT '{}',
  category text DEFAULT 'general' CHECK (category IN ('offer_letter', 'fee_receipt', 'admission_confirmation', 'general', 'reminder')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage email_templates"
  ON public.email_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Email log
CREATE TABLE public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  from_email text DEFAULT 'admissions@nimt.ac.in',
  subject text NOT NULL,
  body_html text NOT NULL,
  template_id uuid REFERENCES public.email_templates(id),
  status text DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  provider_id text,
  sent_by uuid REFERENCES public.profiles(id),
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_email_messages_lead ON public.email_messages(lead_id, created_at DESC);

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage email_messages"
  ON public.email_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default templates
INSERT INTO public.email_templates (name, slug, subject, body_html, variables, category) VALUES
(
  'Offer Letter',
  'offer-letter',
  'Offer of Admission — {{course_name}}',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>Dear {{student_name}},</h2><p>We are pleased to offer you admission to <strong>{{course_name}}</strong> at <strong>{{campus_name}}</strong>.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><td style="padding:8px;border:1px solid #ddd">Total Fee</td><td style="padding:8px;border:1px solid #ddd;text-align:right"><strong>₹{{total_fee}}</strong></td></tr><tr><td style="padding:8px;border:1px solid #ddd">Scholarship</td><td style="padding:8px;border:1px solid #ddd;text-align:right">₹{{scholarship}}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Net Fee</td><td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">₹{{net_fee}}</td></tr></table><p>Please accept this offer by <strong>{{deadline}}</strong>.</p><p>Regards,<br>Admissions Office</p></div>',
  ARRAY['student_name','course_name','campus_name','total_fee','scholarship','net_fee','deadline'],
  'offer_letter'
),
(
  'Fee Receipt',
  'fee-receipt',
  'Payment Receipt — ₹{{amount}}',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>Dear {{student_name}},</h2><p>We have received your payment.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><td style="padding:8px;border:1px solid #ddd">Amount</td><td style="padding:8px;border:1px solid #ddd;text-align:right"><strong>₹{{amount}}</strong></td></tr><tr><td style="padding:8px;border:1px solid #ddd">Reference</td><td style="padding:8px;border:1px solid #ddd;text-align:right">{{payment_ref}}</td></tr><tr><td style="padding:8px;border:1px solid #ddd">Date</td><td style="padding:8px;border:1px solid #ddd;text-align:right">{{payment_date}}</td></tr></table><p>Thank you.</p></div>',
  ARRAY['student_name','amount','payment_ref','payment_date'],
  'fee_receipt'
),
(
  'Admission Confirmation',
  'admission-confirmation',
  'Welcome to {{institution_name}} — Admission Confirmed',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2>Dear {{student_name}},</h2><p>Congratulations! Your admission to <strong>{{course_name}}</strong> at <strong>{{institution_name}}</strong> is confirmed.</p><p>Your Admission Number: <strong>{{admission_no}}</strong></p><p>Welcome to the family!</p><p>Regards,<br>Admissions Office</p></div>',
  ARRAY['student_name','course_name','institution_name','admission_no'],
  'admission_confirmation'
);

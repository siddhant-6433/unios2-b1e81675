-- Email template for payment links sent to candidates/students.
-- Used by create-payment-link (send_channel email/both) via send-email.
INSERT INTO public.email_templates (name, slug, subject, body_html, variables, category) VALUES
(
  'Payment Link',
  'payment-link',
  'Payment request — {{purpose_label}}',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">' ||
  '<h2 style="color:#0f172a">Payment request</h2>' ||
  '<p>Dear {{student_name}},</p>' ||
  '<p>Please use the secure link below to complete your payment of <strong>Rs. {{amount}}</strong> towards <strong>{{purpose_label}}</strong>.</p>' ||
  '<p style="margin:24px 0"><a href="{{pay_url}}" style="background:#0035C5;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Pay Now</a></p>' ||
  '<p style="color:#475569;font-size:13px">Or copy this link: {{pay_url}}</p>' ||
  '<p style="color:#475569;font-size:13px">{{note}}</p>' ||
  '<p style="color:#94a3b8;font-size:12px">A receipt will be issued automatically once the payment is confirmed. This link expires after its validity period.</p>' ||
  '<p>NIMT Educational Institutions</p>' ||
  '</div>',
  ARRAY['student_name','amount','purpose_label','pay_url','note'],
  'notification'
)
ON CONFLICT (slug) DO NOTHING;

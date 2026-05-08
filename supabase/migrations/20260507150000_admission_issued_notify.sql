-- Admission-issued notification: when leads.admission_no transitions
-- NULL → set, fire fn_notify_event('admission_issued') so:
--   • student gets a welcome email (existing claim-link trigger handles WA)
--   • finance@nimt.ac.in gets an internal notice
--   • counsellor + super_admin get the same internal email

-- 1. Trigger function — defers to the existing fn_notify_event helper
CREATE OR REPLACE FUNCTION public.fn_trg_admission_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.admission_no IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.admission_no IS NOT DISTINCT FROM NEW.admission_no THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_notify_event(
    'admission_issued',
    NEW.id,
    jsonb_build_object('admission_no', NEW.admission_no)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admission_issued ON public.leads;
CREATE TRIGGER trg_notify_admission_issued
  AFTER UPDATE OF admission_no ON public.leads
  FOR EACH ROW
  WHEN (OLD.admission_no IS DISTINCT FROM NEW.admission_no AND NEW.admission_no IS NOT NULL)
  EXECUTE FUNCTION public.fn_trg_admission_issued();

-- 2. Email templates — use the same schema (name, slug, subject, body_html,
--    variables, category) as the lifecycle_notifications migration.
INSERT INTO public.email_templates (name, slug, subject, body_html, variables, category) VALUES
(
  'Student Welcome — Admission Issued',
  'student-admitted-welcome',
  'Welcome to {{course_name}} — Admission No {{admission_no}}',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.55">' ||
  '<h1 style="color:#1f6feb;font-size:22px;margin:0 0 16px">Welcome to NIMT, {{student_name}}!</h1>' ||
  '<p>Congratulations — your admission to <strong>{{course_name}}</strong> at <strong>{{campus_name}}</strong> is confirmed.</p>' ||
  '<table style="border-collapse:collapse;margin:16px 0;font-size:14px">' ||
  '<tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600">Admission No</td><td style="padding:6px 12px;background:#f3f4f6">{{admission_no}}</td></tr>' ||
  '<tr><td style="padding:6px 12px">Programme</td><td style="padding:6px 12px">{{course_name}}</td></tr>' ||
  '<tr><td style="padding:6px 12px;background:#f3f4f6">Campus</td><td style="padding:6px 12px;background:#f3f4f6">{{campus_name}}</td></tr>' ||
  '</table>' ||
  '<p style="margin:24px 0"><a href="{{portal_url}}" style="background:#1f6feb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open Student Portal →</a></p>' ||
  '<p style="font-size:13px;color:#6b7280;margin-top:32px">Use the portal to track your fee ledger, upload remaining documents, and access your timetable once it is published.</p>' ||
  '<p style="font-size:13px;color:#6b7280">— NIMT Admissions Team</p>' ||
  '</div>',
  ARRAY['student_name','admission_no','course_name','campus_name','portal_url','lead_url'],
  'admission_confirmation'
),
(
  'Admission Issued (Internal)',
  'admission-issued-internal',
  'Admission issued — {{admission_no}} ({{student_name}})',
  '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">' ||
  '<h2 style="color:#0f172a">Admission issued</h2>' ||
  '<p><strong>{{student_name}}</strong> has been issued admission number <strong>{{admission_no}}</strong> for <strong>{{course_name}}</strong> at {{campus_name}}.</p>' ||
  '<p><a href="{{lead_url}}" style="color:#0047FF">Open lead in CRM →</a></p>' ||
  '</div>',
  ARRAY['student_name','admission_no','course_name','campus_name','lead_url','portal_url'],
  'admission_confirmation'
)
ON CONFLICT (slug) DO UPDATE
  SET subject   = EXCLUDED.subject,
      body_html = EXCLUDED.body_html,
      variables = EXCLUDED.variables;

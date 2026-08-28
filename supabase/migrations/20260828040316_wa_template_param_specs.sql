-- Single source of truth for a template's ordered body params. The frontend
-- (WA_BULK_TEMPLATES) and server (whatsapp-campaign-send TEMPLATES map) each
-- hand-maintained their own param list; they drifted from each other and from
-- Meta's real placeholder_count (lead_welcome/visit_reminder said 2 but Meta is
-- 3; cnet_not_qualified said 1 but Meta is 2 -> a guaranteed 132000). param_specs
-- is an ordered array of { name, source: 'auto'|'static', map?, placeholder?, help? }.
-- 'auto' params are filled per-lead server-side via resolveMappedCampaignField(map);
-- 'static' params come from the campaign's static_params[name]. Templates without
-- a param_specs row fall back to the old hardcoded logic (limited blast radius).

ALTER TABLE public.whatsapp_template_settings
  ADD COLUMN IF NOT EXISTS param_specs jsonb;

-- Seed the marketing templates, aligned to Meta placeholder_count (verified).
-- display_name/category left as-is; only param_specs is set.
UPDATE public.whatsapp_template_settings s SET param_specs = v.specs
FROM (VALUES
  ('lead_welcome', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"course_name","source":"auto","map":"course_name"},{"name":"lead_source","source":"auto","map":"lead_source"}]'::jsonb),
  ('course_details', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"course_name","source":"auto","map":"course_name"}]'::jsonb),
  ('visit_confirmation', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"visit_date","source":"static","placeholder":"e.g. Sun, 1 Jun 11:00 AM"},{"name":"campus_name","source":"auto","map":"campus_name"}]'::jsonb),
  ('visit_reminder_24hr', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"visit_date","source":"static","placeholder":"e.g. Tomorrow, 11:00 AM"},{"name":"campus_name","source":"auto","map":"campus_name"}]'::jsonb),
  ('fee_reminder', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"amount","source":"static","placeholder":"e.g. 5,000"},{"name":"due_date","source":"static","placeholder":"e.g. 5 Jun 2026"}]'::jsonb),
  ('application_received', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"application_id","source":"static","placeholder":"e.g. NIMT-2026-001"}]'::jsonb),
  ('bpt_bmrit_cahet_deadline', '[]'::jsonb),
  ('cuet_2026_counselling_open', '[]'::jsonb),
  ('cuet_counselling_booking', '[]'::jsonb)
) AS v(template_key, specs)
WHERE s.template_key = v.template_key;

-- Create settings rows for any of the above that don't exist yet (so the spec sticks).
INSERT INTO public.whatsapp_template_settings (template_key, display_name, category, visibility, param_specs)
SELECT v.template_key, replace(v.template_key,'_',' '), 'general', 'hidden', v.specs
FROM (VALUES
  ('lead_welcome', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"course_name","source":"auto","map":"course_name"},{"name":"lead_source","source":"auto","map":"lead_source"}]'::jsonb),
  ('course_details', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"course_name","source":"auto","map":"course_name"}]'::jsonb),
  ('visit_confirmation', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"visit_date","source":"static","placeholder":"e.g. Sun, 1 Jun 11:00 AM"},{"name":"campus_name","source":"auto","map":"campus_name"}]'::jsonb),
  ('visit_reminder_24hr', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"visit_date","source":"static","placeholder":"e.g. Tomorrow, 11:00 AM"},{"name":"campus_name","source":"auto","map":"campus_name"}]'::jsonb),
  ('fee_reminder', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"amount","source":"static","placeholder":"e.g. 5,000"},{"name":"due_date","source":"static","placeholder":"e.g. 5 Jun 2026"}]'::jsonb),
  ('application_received', '[{"name":"student_name","source":"auto","map":"student_name"},{"name":"application_id","source":"static","placeholder":"e.g. NIMT-2026-001"}]'::jsonb),
  ('bpt_bmrit_cahet_deadline', '[]'::jsonb),
  ('cuet_2026_counselling_open', '[]'::jsonb),
  ('cuet_counselling_booking', '[]'::jsonb)
) AS v(template_key, specs)
WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_template_settings s WHERE s.template_key = v.template_key);

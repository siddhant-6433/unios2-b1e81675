-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260821054744 name=wa_course_detail_templates_picker applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

update public.whatsapp_template_settings s
set show_in_lead_picker = true,
    display_name = v.display_name,
    category = 'course_details',
    media_url = 'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-headers/' || s.template_key || '.png'
from (values
  ('bpt_course_details__nimt',      'BPT — Course Details'),
  ('bmrit_course_details',          'BMRIT — Course Details'),
  ('mmrit_course_details',          'MMRIT — Course Details'),
  ('mpt_course_details',            'MPT — Course Details'),
  ('d_aott_course_details',         'D.AOTT — Course Details'),
  ('gnm_course_details',            'GNM — Course Details'),
  ('b_sc__nursing_course_details',  'B.Sc Nursing — Course Details'),
  ('dpharma_course_details',        'D.Pharma — Course Details'),
  ('bca_course_details',            'BCA — Course Details'),
  ('bba_course_details',            'BBA — Course Details'),
  ('mba_course_details',            'MBA — Course Details'),
  ('pgdm_course_details',           'PGDM — Course Details'),
  ('bed_course_details',            'B.Ed — Course Details'),
  ('d_el_ed_course_details',        'D.El.Ed — Course Details'),
  ('llb_course_details',            'LLB — Course Details'),
  ('ballb_course_details',          'BA LLB — Course Details')
) as v(template_key, display_name)
where s.template_key = v.template_key;

update public.whatsapp_template_settings
set show_in_lead_picker = true,
    display_name = 'Alumni Post',
    media_url = 'https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/whatsapp-media/template-headers/alumni_post.png'
where template_key = 'alumni_post';

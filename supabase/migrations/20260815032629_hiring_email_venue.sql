-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260815032629 name=hiring_email_venue applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

UPDATE public.email_templates
   SET body_html = '<p>Dear {{candidate_name}},</p>
<p>We would like to meet you regarding the {{role}} position.</p>
<table cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px">
  <tr><td style="padding:2px 12px 2px 0;color:#666">When</td><td><strong>{{interview_when}}</strong></td></tr>
  <tr><td style="padding:2px 12px 2px 0;color:#666">Where</td><td><strong>{{interview_where}}</strong><br/>{{interview_address}}</td></tr>
  <tr><td style="padding:2px 12px 2px 0;color:#666">Round</td><td>{{round_name}}</td></tr>
</table>
<p>{{map_link}}</p>
<p>Please bring a copy of your CV and any relevant certificates. If this time does not suit you, reply to this email and we will find another.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
       variables = ARRAY['candidate_name','role','interview_when','interview_where',
                         'interview_address','map_link','round_name'],
       updated_at = now()
 WHERE slug = 'hiring-interview-invite';

UPDATE public.email_templates
   SET body_html = '<p>Dear {{candidate_name}},</p>
<p>Following your interviews, we are pleased to offer you the position of <strong>{{role}}</strong> at NIMT Educational Institutions.</p>
<table cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px">
  <tr><td style="padding:2px 12px 2px 0;color:#666">Location</td><td><strong>{{interview_where}}</strong><br/>{{interview_address}}</td></tr>
  <tr><td style="padding:2px 12px 2px 0;color:#666">Proposed joining date</td><td><strong>{{joining_date}}</strong></td></tr>
</table>
<p>Your formal appointment letter and the documents we will need from you follow separately. If you have questions about the offer, reply to this email and HR will help.</p>
<p>We hope you will join us.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
       variables = ARRAY['candidate_name','role','joining_date','interview_where','interview_address'],
       updated_at = now()
 WHERE slug = 'hiring-offer';

CREATE OR REPLACE VIEW public.hiring_venues AS
  SELECT c.id,
         c.name,
         NULLIF(concat_ws(', ', NULLIF(c.address, ''), NULLIF(c.city, '')), '') AS address,
         c.google_maps_url AS map_url,
         'campus'::text AS kind
  FROM public.campuses c
  UNION ALL
  SELECT l.id, l.name, NULLIF(l.address, ''), NULL::text, 'office'::text
  FROM public.hr_locations l
  WHERE l.is_active AND l.campus_id IS NULL;

COMMENT ON VIEW public.hiring_venues IS
  'Places an interview can be held — campuses and the offices that are not campuses.';

GRANT SELECT ON public.hiring_venues TO authenticated, service_role;

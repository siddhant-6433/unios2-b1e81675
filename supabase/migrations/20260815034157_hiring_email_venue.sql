-- Put the actual address in the hiring emails.
--
-- The interview invite said "Where: NIMT Greater Noida Campus" and stopped there,
-- which is not enough to travel to. Every campus already carries a full address and
-- a Google Maps URL, so the email can just say where to go.
--
-- WhatsApp deliberately keeps the short campus name: its template is a fixed
-- 4-parameter UTILITY message and a full postal address in a placeholder reads
-- badly on a phone. The email is where the detail belongs — which is what "add the
-- campus location to the email as well" asks for.

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

-- An offer should say which campus the person would actually be working at.
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

-- Venues HR can pick from when scheduling: the five campuses plus the two offices
-- that are not campuses (Preet Vihar, Seralis Lab). One list, so the picker does
-- not have to know that distinction exists.
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

-- ── Two defects found by reading a real email back ─────────────────────
-- 1. The address duplicated the city: campuses.address already ends with the city,
--    so concat_ws appended it again — "…Greater Noida, UP 201310, Greater Noida".
-- 2. Gmail's plain-text conversion collapses <td> boundaries with no separator, so
--    the table rendered as "WhenMon 18 Aug" / "WhereGreater Noida Campus". Labelled
--    paragraphs degrade correctly in both HTML and plain text, which matters when
--    the candidate is reading on a phone.
CREATE OR REPLACE VIEW public.hiring_venues AS
  SELECT c.id,
         c.name,
         NULLIF(
           CASE
             WHEN c.city IS NULL OR c.city = '' THEN c.address
             WHEN c.address ILIKE '%' || c.city || '%' THEN c.address
             ELSE concat_ws(', ', NULLIF(c.address, ''), c.city)
           END, '') AS address,
         c.google_maps_url AS map_url,
         'campus'::text AS kind
  FROM public.campuses c
  UNION ALL
  SELECT l.id, l.name, NULLIF(l.address, ''), NULL::text, 'office'::text
  FROM public.hr_locations l
  WHERE l.is_active AND l.campus_id IS NULL;

UPDATE public.email_templates
   SET body_html = '<p>Dear {{candidate_name}},</p>
<p>We would like to meet you regarding the {{role}} position.</p>
<p><strong>When:</strong> {{interview_when}}</p>
<p><strong>Where:</strong> {{interview_where}}<br/>{{interview_address}}</p>
<p><strong>Round:</strong> {{round_name}}</p>
<p>{{map_link}}</p>
<p>Please bring a copy of your CV and any relevant certificates. If this time does not suit you, reply to this email and we will find another.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
       updated_at = now()
 WHERE slug = 'hiring-interview-invite';

UPDATE public.email_templates
   SET body_html = '<p>Dear {{candidate_name}},</p>
<p>Following your interviews, we are pleased to offer you the position of <strong>{{role}}</strong> at NIMT Educational Institutions.</p>
<p><strong>Location:</strong> {{interview_where}}<br/>{{interview_address}}</p>
<p><strong>Proposed joining date:</strong> {{joining_date}}</p>
<p>Your formal appointment letter and the documents we will need from you follow separately. If you have questions about the offer, reply to this email and HR will help.</p>
<p>We hope you will join us.</p>
<p>Warm regards,<br/>HR Team<br/>NIMT Educational Institutions</p>',
       updated_at = now()
 WHERE slug = 'hiring-offer';

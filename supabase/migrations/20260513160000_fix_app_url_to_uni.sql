-- Fix app.nimt.ac.in → uni.nimt.ac.in in campuses.apply_url and email templates

UPDATE public.campuses
SET apply_url = REPLACE(apply_url, 'app.nimt.ac.in', 'uni.nimt.ac.in')
WHERE apply_url LIKE '%app.nimt.ac.in%';

UPDATE public.email_templates
SET body_html = REPLACE(body_html, 'app.nimt.ac.in', 'uni.nimt.ac.in')
WHERE body_html LIKE '%app.nimt.ac.in%';

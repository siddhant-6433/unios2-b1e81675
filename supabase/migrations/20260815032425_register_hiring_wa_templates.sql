-- Mirror the four approved hiring templates into whatsapp_templates.
--
-- submit-wa-templates posts straight to Meta and never writes this table — only the
-- UI submission path in whatsapp-templates does. So Meta had them approved while
-- the app had never heard of them, which leaves the template pickers blind to them
-- and any arity validation with nothing to check against.
--
-- Note this alone does NOT make them sendable: whatsapp-send's dynamic fallback
-- accepts only zero-placeholder templates, and these carry 2-4, so they also had to
-- be registered in its TEMPLATES map. Both were needed.
INSERT INTO public.whatsapp_templates
  (name, language, category, status, header_format, has_media, placeholder_count, components, submitted_at, status_updated_at)
VALUES
 ('hiring_application_received','en','UTILITY','APPROVED',NULL,false,2,
  '[{"type":"BODY","text":"Dear {{1}}, thank you for your interest in the {{2}} role at NIMT. Your application has reached our HR team and is being reviewed. We will be in touch either way — you will not be left waiting. For queries, reply here or email hr@nimt.ac.in."}]'::jsonb, now(), now()),
 ('hiring_interview_invite','en','UTILITY','APPROVED',NULL,false,4,
  '[{"type":"BODY","text":"Dear {{1}}, we would like to meet you for the {{2}} role. Interview: {{3}} at {{4}}. Please bring your CV and relevant certificates. If this time does not suit you, reply here and HR will arrange another."}]'::jsonb, now(), now()),
 ('hiring_offer_extended','en','UTILITY','APPROVED',NULL,false,3,
  '[{"type":"BODY","text":"Dear {{1}}, we are pleased to offer you the position of {{2}} at NIMT, with a proposed joining date of {{3}}. Your appointment letter and the documents we need follow by email from hr@nimt.ac.in. Reply here if you have any questions."}]'::jsonb, now(), now()),
 ('hiring_not_proceeding','en','UTILITY','APPROVED',NULL,false,2,
  '[{"type":"BODY","text":"Dear {{1}}, thank you for applying for the {{2}} role at NIMT and for your patience through our process. On this occasion we will not be taking your application further. We would be glad to hear from you for future openings."}]'::jsonb, now(), now())
ON CONFLICT (name, language) DO UPDATE
  SET status            = EXCLUDED.status,
      category          = EXCLUDED.category,
      placeholder_count = EXCLUDED.placeholder_count,
      components        = EXCLUDED.components,
      status_updated_at = now();

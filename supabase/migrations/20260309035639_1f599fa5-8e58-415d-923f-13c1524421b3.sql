ALTER TABLE public.lead_activities
DROP CONSTRAINT IF EXISTS lead_activities_type_check;

ALTER TABLE public.lead_activities
ADD CONSTRAINT lead_activities_type_check
CHECK (
  type = ANY (
    ARRAY[
      'note'::text,
      'call'::text,
      'whatsapp'::text,
      'email'::text,
      'visit'::text,
      'status_change'::text,
      'stage_change'::text,
      'system'::text,
      'lead_created'::text,
      'ai_call'::text,
      'followup'::text,
      'offer'::text,
      'interview'::text,
      'conversion'::text,
      'application_progress'::text,
      'info_update'::text
    ]
  )
);
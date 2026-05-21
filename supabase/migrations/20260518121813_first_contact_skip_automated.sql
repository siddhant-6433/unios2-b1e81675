-- Fix: fn_auto_first_contact treated automated system WA messages as the
-- counsellor's first manual contact, so freshly claimed leads disappeared
-- from "New Leads to Contact" the moment the lead-assigned automation fired
-- "Automated WhatsApp sent — counsellor lead assigned". Same effect on the
-- pipeline + overdue counters.
--
-- Symptom reported 2026-05-18 by Nikki Bhati (counsellor): "I have assigned
-- the leads myself, but they are not showing in new leads. Also not in the
-- pipeline. Not even in overdue." Audit found 1,053 leads org-wide in the
-- new_lead stage whose first_contact_at was populated only by automated
-- activity rows — they were invisible to the counsellor dashboard query
--   stage='new_lead' AND first_contact_at IS NULL
-- (see src/hooks/useActionCenter.ts q2).
--
-- whatsapp-send/index.ts prefixes the description with "Automated " when
-- called from a system path (no user_id). Manual call dispositions and
-- WhatsApp sends from staff don't carry that prefix. We use the prefix
-- (not user_id IS NULL) as the discriminator because manual-call inserts
-- legitimately have user_id NULL too — see the 394 "Manual call initiated
-- by Rahul Bhati via CRM" rows in the last 7 days.

CREATE OR REPLACE FUNCTION fn_auto_first_contact()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type NOT IN ('call', 'whatsapp') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.description, '') ILIKE 'Automated %' THEN RETURN NEW; END IF;

  UPDATE public.leads
  SET first_contact_at = now()
  WHERE id = NEW.lead_id
    AND first_contact_at IS NULL
    AND counsellor_id IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One-time backfill: re-surface leads whose first_contact_at was set only
-- by automated activity. Scoped to stage='new_lead' to avoid disturbing
-- leads that have already progressed (counsellor_call etc. — where a real
-- contact almost certainly happened even if the activity rows don't show it).
UPDATE public.leads l
SET first_contact_at = NULL
WHERE first_contact_at IS NOT NULL
  AND l.stage = 'new_lead'
  AND NOT EXISTS (
    SELECT 1 FROM public.lead_activities a
    WHERE a.lead_id = l.id
      AND a.type IN ('call', 'whatsapp')
      AND NOT (COALESCE(a.description, '') ILIKE 'Automated %')
  );

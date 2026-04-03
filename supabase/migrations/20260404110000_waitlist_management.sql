-- Sprint 4 Feature 2: Waitlist Management

-- Add waitlisted stage
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'waitlisted' BEFORE 'rejected';

-- Waitlist entries table
CREATE TABLE public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id),
  campus_id uuid REFERENCES public.campuses(id),
  position integer NOT NULL,
  status text DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'expired', 'declined')),
  promoted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(lead_id, course_id)
);

CREATE INDEX idx_waitlist_course ON public.waitlist_entries(course_id, position) WHERE status = 'waiting';

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage waitlist"
  ON public.waitlist_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Function: add lead to waitlist with auto-position
CREATE OR REPLACE FUNCTION public.add_to_waitlist(p_lead_id uuid, p_course_id uuid, p_campus_id uuid)
RETURNS integer AS $$
DECLARE
  next_pos integer;
BEGIN
  SELECT COALESCE(MAX(position), 0) + 1 INTO next_pos
  FROM public.waitlist_entries
  WHERE course_id = p_course_id AND status = 'waiting'
    AND (p_campus_id IS NULL OR campus_id = p_campus_id);

  INSERT INTO public.waitlist_entries (lead_id, course_id, campus_id, position)
  VALUES (p_lead_id, p_course_id, p_campus_id, next_pos)
  ON CONFLICT (lead_id, course_id) DO UPDATE SET position = next_pos, status = 'waiting', promoted_at = NULL;

  UPDATE public.leads SET stage = 'waitlisted' WHERE id = p_lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
  VALUES (p_lead_id, 'stage_change', 'Waitlisted — seats full (position ' || next_pos || ')', 'waitlisted');

  RETURN next_pos;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: promote next lead from waitlist
CREATE OR REPLACE FUNCTION public.promote_from_waitlist(p_course_id uuid, p_campus_id uuid DEFAULT NULL)
RETURNS uuid AS $$
DECLARE
  entry record;
BEGIN
  SELECT * INTO entry
  FROM public.waitlist_entries
  WHERE course_id = p_course_id AND status = 'waiting'
    AND (p_campus_id IS NULL OR campus_id = p_campus_id)
  ORDER BY position
  LIMIT 1;

  IF entry IS NULL THEN RETURN NULL; END IF;

  UPDATE public.waitlist_entries SET status = 'promoted', promoted_at = now() WHERE id = entry.id;
  UPDATE public.leads SET stage = 'offer_sent' WHERE id = entry.lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description, old_stage, new_stage)
  VALUES (entry.lead_id, 'stage_change', 'Promoted from waitlist position ' || entry.position, 'waitlisted', 'offer_sent');

  RETURN entry.lead_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

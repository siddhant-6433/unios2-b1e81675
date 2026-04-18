-- Phase B: Alumni verification approval workflow + TAT tracking

-- 1. Add review workflow columns
ALTER TABLE public.alumni_verification_requests
  ADD COLUMN IF NOT EXISTS employee_reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS employee_review_notes text,
  ADD COLUMN IF NOT EXISTS employee_review_result text CHECK (employee_review_result IN ('recommended_approve', 'recommended_reject')),
  ADD COLUMN IF NOT EXISTS employee_review_doc_url text,
  ADD COLUMN IF NOT EXISTS employee_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS admin_approval_notes text,
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS batch_number text;

-- 2. Auto-set due_date (5 business days) when status changes to 'paid'
CREATE OR REPLACE FUNCTION public.set_alumni_due_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') AND NEW.due_date IS NULL THEN
    NEW.due_date := (CURRENT_DATE + interval '5 days')::date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alumni_due_date
  BEFORE UPDATE ON public.alumni_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_alumni_due_date();

-- Also set on insert if paid directly
CREATE OR REPLACE FUNCTION public.set_alumni_due_date_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.due_date IS NULL THEN
    NEW.due_date := (CURRENT_DATE + interval '5 days')::date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alumni_due_date_insert
  BEFORE INSERT ON public.alumni_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_alumni_due_date_insert();

-- 3. View: pending alumni requests with TAT info
CREATE OR REPLACE VIEW public.alumni_pending_summary AS
SELECT
  avr.id,
  avr.request_number,
  avr.request_type,
  avr.status,
  avr.alumni_name,
  avr.course,
  avr.year_of_passing,
  avr.employer_name,
  avr.contact_email,
  avr.fee_amount,
  avr.paid_at,
  avr.due_date,
  avr.employee_review_result,
  avr.created_at,
  CASE
    WHEN avr.due_date IS NOT NULL AND avr.due_date < CURRENT_DATE THEN true
    ELSE false
  END AS is_overdue,
  CASE
    WHEN avr.due_date IS NOT NULL THEN avr.due_date - CURRENT_DATE
    ELSE NULL
  END AS days_remaining
FROM public.alumni_verification_requests avr
WHERE avr.status IN ('paid', 'under_review')
ORDER BY avr.due_date ASC NULLS LAST;

GRANT SELECT ON public.alumni_pending_summary TO authenticated;

-- 4. Set due_date for existing paid requests that don't have one
UPDATE public.alumni_verification_requests
SET due_date = (paid_at::date + interval '5 days')::date
WHERE status IN ('paid', 'under_review') AND due_date IS NULL AND paid_at IS NOT NULL;

-- Stamp which course a generated receipt PDF currently prints, so a later
-- course migration can find receipts that still show the previous programme.

ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS receipt_course_id uuid REFERENCES public.courses(id);

COMMENT ON COLUMN public.lead_payments.receipt_course_id IS
  'Course printed on the generated receipt PDF. Updated when the PDF is (re)generated after a course migration.';

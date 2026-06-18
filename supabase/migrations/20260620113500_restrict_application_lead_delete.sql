-- Applications cannot progress through admission without their lead row.
-- The previous ON DELETE SET NULL behavior created orphaned applications that
-- show "Lead has been deleted" and block offer/payment/admission actions.
DO $$
BEGIN
  ALTER TABLE public.applications
    DROP CONSTRAINT IF EXISTS applications_lead_id_fkey;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'applications_lead_id_fkey'
      AND conrelid = 'public.applications'::regclass
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_lead_id_fkey
      FOREIGN KEY (lead_id)
      REFERENCES public.leads(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

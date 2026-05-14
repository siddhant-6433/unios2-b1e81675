-- Tighten feedback_responses RLS.
--
-- Prior state:
--   "Anyone can manage feedback"           ALL    {anon,authenticated}  qual=true with_check=true
--   "Authenticated can read feedback"      SELECT {authenticated}        qual=true
--
-- The "ALL qual=true with_check=true" for anon meant any anonymous client
-- could read AND delete the entire feedback_responses table. The
-- authenticated-side broad SELECT let any logged-in user (student, parent,
-- consultant) read every feedback row.
--
-- The table is written exclusively from edge functions running with
-- service_role (whatsapp-webhook, feedback-sender-cron). No frontend reads
-- or writes today, so authenticated INSERT/UPDATE/DELETE are unnecessary.
-- Scope SELECT to staff roles that would view feedback aggregates from
-- admin pages later.

DROP POLICY IF EXISTS "Anyone can manage feedback"      ON public.feedback_responses;
DROP POLICY IF EXISTS "Authenticated can read feedback" ON public.feedback_responses;

CREATE POLICY "Staff read feedback_responses"
  ON public.feedback_responses FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
  );

CREATE POLICY "Super admin can delete feedback_responses"
  ON public.feedback_responses FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

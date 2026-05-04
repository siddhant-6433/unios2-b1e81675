-- Same omission as 20260605010000 — RLS policies were in place but the
-- underlying table-level GRANT to the authenticated role was missing,
-- so super_admins hit "permission denied for table offer_letters" when
-- clicking Issue Offer Letter.
--
-- student_magic_tokens (created in 20260604100000) is in the same boat;
-- granting now to avoid the next round-trip.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_letters         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_magic_tokens  TO authenticated;

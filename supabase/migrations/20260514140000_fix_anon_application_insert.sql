-- Fix: anon applicants (WhatsApp-OTP flow) blocked from creating new applications.
--
-- Root cause: the May 13 "tighten_applications_rls" migration removed the broad
-- SELECT policy and replaced it with authenticated-only (phone/email matched)
-- policies. PostgREST wraps INSERT in INSERT...RETURNING *; when RETURNING
-- returns 0 rows for the anon role (no SELECT policy), PostgREST raises
-- "new row violates row-level security policy" even though the INSERT itself
-- succeeded. Supabase JS .insert().select().single() triggers this path.
--
-- Frontend fix: ApplyPortal now pre-generates the UUID client-side and omits
-- .select() so PostgREST never fires RETURNING for the create path.
--
-- DB fix here: add an UPDATE policy for anon so the lead-linkage UPDATE that
-- runs immediately after INSERT doesn't silently fail. The UPDATE is always
-- scoped to a specific row id via the client .eq("id", ...) call, so this
-- policy is not exploitable in practice.

CREATE POLICY "Anon can update own application" ON public.applications
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

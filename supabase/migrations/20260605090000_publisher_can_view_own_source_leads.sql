-- Publisher portal RLS: let publisher accounts read leads from their own source.
--
-- Symptom: Logged in as a publisher (e.g. CRM CollegeHai), the portal showed
-- "0 total / no leads found" even though `leads.source = 'collegehai'` had
-- 3,313 rows. PublisherPortal.tsx queries `leads` filtered by `source =
-- pub.source`, but the leads table only had SELECT policies for staff +
-- consultants. The publisher role wasn't granted any read path → RLS
-- silently returned 0 rows.
--
-- This adds a tightly-scoped SELECT policy: a publisher user can read leads
-- whose `source` matches one of the sources they own in `public.publishers`
-- (where the publisher row's user_id = auth.uid() and is_active = true).
--
-- Notes:
--   * `leads.source` is a `lead_source` enum; `publishers.source` is text.
--     Cast the enum to text for the IN check.
--   * Publishers still cannot UPDATE/INSERT/DELETE leads — those policies
--     remain limited to staff/super_admin, so this is read-only access.

DROP POLICY IF EXISTS "Publishers can view leads from their source" ON public.leads;

CREATE POLICY "Publishers can view leads from their source"
ON public.leads
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'publisher'::app_role)
  AND source::text IN (
    SELECT source FROM public.publishers
    WHERE user_id = auth.uid() AND is_active = true
  )
);

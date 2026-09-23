-- Per-user data access grants: which institutions and courses a staff member
-- can see, assigned from Admin → Users → Data Access.
--
-- Campus access already lives on profiles.campus (comma-separated names/codes)
-- and is resolved by user_assigned_campus_ids(). This migration adds the
-- institution/course half of the same model and uses it to scope principals.
--
-- Scoping contract after this migration:
--   super_admin   → everything
--   admission_head→ everything (org-wide)
--   campus_admin  → assigned campus(es)
--   principal     → assigned campus(es) OR assigned institution(s) OR assigned course(s)
--
-- The two grant tables already exist on production (they back teacher scoping).
-- CREATE TABLE IF NOT EXISTS keeps this migration a no-op there while making a
-- fresh environment reproducible.

-- ── 1. Grant tables ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_institution_access (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  role           public.app_role NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  granted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, institution_id, role)
);

CREATE TABLE IF NOT EXISTS public.user_course_access (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  mode       text NOT NULL DEFAULT 'allow',
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, course_id, role)
);

CREATE INDEX IF NOT EXISTS user_institution_access_user_idx ON public.user_institution_access (user_id);
CREATE INDEX IF NOT EXISTS user_institution_access_inst_idx ON public.user_institution_access (institution_id);
CREATE INDEX IF NOT EXISTS user_course_access_user_idx       ON public.user_course_access (user_id);
CREATE INDEX IF NOT EXISTS user_course_access_course_idx     ON public.user_course_access (course_id);

ALTER TABLE public.user_institution_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_course_access      ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_institution_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_course_access      TO authenticated;

DROP POLICY IF EXISTS "Admins manage user institution access" ON public.user_institution_access;
CREATE POLICY "Admins manage user institution access" ON public.user_institution_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users read own institution access" ON public.user_institution_access;
CREATE POLICY "Users read own institution access" ON public.user_institution_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage user course access" ON public.user_course_access;
CREATE POLICY "Admins manage user course access" ON public.user_course_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users read own course access" ON public.user_course_access;
CREATE POLICY "Users read own course access" ON public.user_course_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 2. Scope helpers ────────────────────────────────────────────────────────
-- SECURITY DEFINER so the grant lookup is not itself filtered by the grant
-- tables' RLS. They only ever answer a yes/no for an explicit (user, record).
CREATE OR REPLACE FUNCTION public.user_can_access_course_scope(_user_id uuid, _course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _course_id IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM public.user_course_access uca
         WHERE uca.user_id = _user_id
           AND uca.course_id = _course_id
           AND COALESCE(uca.mode, 'allow') <> 'deny'
       )
       OR EXISTS (
         SELECT 1
         FROM public.user_institution_access uia
         JOIN public.departments d ON d.institution_id = uia.institution_id
         JOIN public.courses c     ON c.department_id = d.id
         WHERE uia.user_id = _user_id
           AND c.id = _course_id
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_lead_scope(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id = _lead_id
      AND (
        public.user_can_access_assigned_campus(_user_id, l.campus_id)
        OR public.user_can_access_course_scope(_user_id, l.course_id)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_course_scope(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_lead_scope(uuid, uuid)   TO authenticated;

-- ── 3. Principal scoping policies (additive, principal only) ────────────────
-- Existing campus-admin/principal campus policies stay; these ADD principal
-- access via institution/course grants. Postgres ORs permissive policies.

-- leads
DROP POLICY IF EXISTS "Principal can view scoped leads" ON public.leads;
CREATE POLICY "Principal can view scoped leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Principal can update scoped leads" ON public.leads;
CREATE POLICY "Principal can update scoped leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), id)
  );

-- campus_visits
DROP POLICY IF EXISTS "Principal can manage scoped visits" ON public.campus_visits;
CREATE POLICY "Principal can manage scoped visits" ON public.campus_visits
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

-- lead_followups
DROP POLICY IF EXISTS "Principal can manage scoped followups" ON public.lead_followups;
CREATE POLICY "Principal can manage scoped followups" ON public.lead_followups
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

-- lead_notes
DROP POLICY IF EXISTS "Principal can manage scoped lead notes" ON public.lead_notes;
CREATE POLICY "Principal can manage scoped lead notes" ON public.lead_notes
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

-- applications
DROP POLICY IF EXISTS "Principal can view scoped applications" ON public.applications;
CREATE POLICY "Principal can view scoped applications" ON public.applications
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Principal can update scoped applications" ON public.applications;
CREATE POLICY "Principal can update scoped applications" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

-- students (course + campus scoped)
DROP POLICY IF EXISTS "Principal can view scoped students" ON public.students;
CREATE POLICY "Principal can view scoped students" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND (
      public.user_can_access_course_scope(auth.uid(), course_id)
      OR public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

DROP POLICY IF EXISTS "Principal can update scoped students" ON public.students;
CREATE POLICY "Principal can update scoped students" ON public.students
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND (
      public.user_can_access_course_scope(auth.uid(), course_id)
      OR public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND (
      public.user_can_access_course_scope(auth.uid(), course_id)
      OR public.user_can_access_assigned_campus(auth.uid(), campus_id)
    )
  );

-- offer_letters (approval workflow for principals)
DROP POLICY IF EXISTS "Principal can view scoped offers" ON public.offer_letters;
CREATE POLICY "Principal can view scoped offers" ON public.offer_letters
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Principal can update scoped offers" ON public.offer_letters;
CREATE POLICY "Principal can update scoped offers" ON public.offer_letters
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

-- offer_waivers (scope via the parent offer letter)
DROP POLICY IF EXISTS "Principal can view scoped offer waivers" ON public.offer_waivers;
CREATE POLICY "Principal can view scoped offer waivers" ON public.offer_waivers
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.offer_letters ol
      WHERE ol.id = offer_waivers.offer_letter_id
        AND public.user_can_access_lead_scope(auth.uid(), ol.lead_id)
    )
  );

-- lead_payments
DROP POLICY IF EXISTS "Principal can read scoped lead payments" ON public.lead_payments;
CREATE POLICY "Principal can read scoped lead payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::app_role)
    AND public.user_can_access_lead_scope(auth.uid(), lead_id)
  );

NOTIFY pgrst, 'reload schema';

-- jd_category_mappings
-- Persists JustDial category keyword → course mappings.
-- The edge function inserts unknown categories as 'pending'.
-- Super admins resolve them from the dashboard.

CREATE TABLE IF NOT EXISTS public.jd_category_mappings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text        UNIQUE NOT NULL,           -- raw JD keyword (case-preserved)
  course_id   uuid        REFERENCES public.courses(id) ON DELETE SET NULL,
  is_school   boolean     NOT NULL DEFAULT false,    -- school type: course not applicable
  status      text        NOT NULL DEFAULT 'pending' -- 'pending' | 'resolved' | 'ignored'
                          CHECK (status IN ('pending', 'resolved', 'ignored')),
  resolved_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jd_cat_status   ON public.jd_category_mappings (status);
CREATE INDEX IF NOT EXISTS idx_jd_cat_category ON public.jd_category_mappings (lower(category));

-- RLS: super_admin can read/write; other authenticated users read-only
ALTER TABLE public.jd_category_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_full_access" ON public.jd_category_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "authenticated_read" ON public.jd_category_mappings
  FOR SELECT TO authenticated USING (true);

-- Edge function (service role) needs read + upsert
GRANT SELECT, INSERT, UPDATE ON public.jd_category_mappings TO service_role;

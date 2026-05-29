-- =====================================================
-- Video Approval & Billing System
-- =====================================================
-- Adds: video_editor role, video_editors registry, videos with social-link
-- tracking + approval workflow, monthly billing (flat per-video rate, only
-- counts videos posted across all three platforms — Instagram, LinkedIn,
-- YouTube — per business rule).

-- 1. Role enum (video editor is an external consultant, not an employee)
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'video_editor';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Brand enum (one row per brand for billing aggregation)
DO $$ BEGIN
  CREATE TYPE public.video_brand AS ENUM (
    'nimt_educational_institutions',
    'nimt_beacon_school',
    'mirai_experiential_school',
    'seralis_lab'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Content type — mirrors spreadsheet column markers ("video", "POST", "Repost", "Repost with Edit")
DO $$ BEGIN
  CREATE TYPE public.video_content_type AS ENUM (
    'video', 'post', 'repost', 'repost_with_edit'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Status workflow: pending_approval → approved → published (auto when all 3 URLs filled)
--                                     ↘ rejected (editor can resubmit, returns to pending_approval)
DO $$ BEGIN
  CREATE TYPE public.video_status AS ENUM (
    'pending_approval', 'approved', 'rejected', 'published'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Editors registry (analog of public.consultants)
CREATE TABLE IF NOT EXISTS public.video_editors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text,
  phone text,
  per_video_rate numeric(10,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_editors_user ON public.video_editors(user_id) WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_video_editors_updated_at ON public.video_editors;
CREATE TRIGGER trg_video_editors_updated_at BEFORE UPDATE ON public.video_editors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Videos table
CREATE TABLE IF NOT EXISTS public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id uuid NOT NULL REFERENCES public.video_editors(id) ON DELETE CASCADE,
  brand video_brand NOT NULL,
  title text NOT NULL,
  content_type video_content_type NOT NULL DEFAULT 'video',
  drive_url text NOT NULL,
  status video_status NOT NULL DEFAULT 'pending_approval',
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  -- Social links — editor fills these in AFTER approval. All three required for billing.
  instagram_url text,
  instagram_posted_on date,
  linkedin_url text,
  linkedin_posted_on date,
  youtube_url text,
  youtube_posted_on date,
  -- Derived columns maintained by the videos_before_change trigger below.
  -- GENERATED ALWAYS AS would be cleaner, but Postgres rejects the
  -- expressions on this version (btrim and date_trunc with text/date args
  -- are not marked immutable). The trigger keeps both columns in sync with
  -- the rest of the row on every insert/update.
  is_billable boolean NOT NULL DEFAULT false,
  posted_month date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_videos_editor_status ON public.videos(editor_id, status);
CREATE INDEX IF NOT EXISTS idx_videos_brand_month ON public.videos(brand, posted_month) WHERE is_billable;
CREATE INDEX IF NOT EXISTS idx_videos_pending ON public.videos(status, created_at) WHERE status = 'pending_approval';

-- 7. Combined BEFORE trigger: enforce editor guard + auto-publish + updated_at.
--    Single trigger so we don't have to worry about firing order.
CREATE OR REPLACE FUNCTION public.videos_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  all_posted boolean;
BEGIN
  -- (a) Editor guard — non-super-admins cannot touch approval fields or
  -- arbitrarily move status. They can only resubmit (which auto-resets a
  -- rejected video back to pending_approval) and fill platform links.
  IF NOT is_super AND auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending_approval';
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.rejection_reason := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.approved_by := OLD.approved_by;
      NEW.approved_at := OLD.approved_at;
      NEW.rejection_reason := OLD.rejection_reason;
      -- If editor changes title/drive_url on a rejected video, treat as resubmit.
      IF OLD.status = 'rejected'
         AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.drive_url IS DISTINCT FROM OLD.drive_url) THEN
        NEW.status := 'pending_approval';
      ELSIF OLD.status IN ('approved','published') THEN
        -- Editor may edit social link fields; status will be recomputed below.
        IF NEW.status NOT IN ('approved','published') THEN
          NEW.status := OLD.status;
        END IF;
      ELSE
        NEW.status := OLD.status;
      END IF;
    END IF;
  END IF;

  -- (b) Auto-publish: when approved AND all three platforms have URLs, mark published.
  --     If a URL is cleared while published, demote back to approved.
  IF NEW.status IN ('approved','published') THEN
    IF NEW.instagram_url IS NOT NULL AND NEW.instagram_url <> ''
       AND NEW.linkedin_url IS NOT NULL AND NEW.linkedin_url <> ''
       AND NEW.youtube_url  IS NOT NULL AND NEW.youtube_url  <> ''
    THEN
      NEW.status := 'published';
    ELSE
      NEW.status := 'approved';
    END IF;
  END IF;

  -- (c) Maintain derived columns (is_billable, posted_month).
  all_posted :=
    NEW.instagram_posted_on IS NOT NULL
    AND NEW.linkedin_posted_on IS NOT NULL
    AND NEW.youtube_posted_on IS NOT NULL;

  NEW.is_billable :=
    NEW.status IN ('approved','published')
    AND NEW.instagram_url IS NOT NULL AND NEW.instagram_url <> ''
    AND NEW.linkedin_url IS NOT NULL AND NEW.linkedin_url <> ''
    AND NEW.youtube_url IS NOT NULL AND NEW.youtube_url <> '';

  NEW.posted_month := CASE
    WHEN all_posted THEN date_trunc('month',
      GREATEST(NEW.instagram_posted_on, NEW.linkedin_posted_on, NEW.youtube_posted_on)
    )::date
    ELSE NULL
  END;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_videos_before_change ON public.videos;
CREATE TRIGGER trg_videos_before_change BEFORE INSERT OR UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.videos_before_change();

-- 8. Bills table — one row per (editor, brand, month).
CREATE TABLE IF NOT EXISTS public.video_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id uuid NOT NULL REFERENCES public.video_editors(id) ON DELETE RESTRICT,
  brand video_brand NOT NULL,
  bill_month date NOT NULL,  -- first day of month
  video_count int NOT NULL,
  per_video_rate numeric(10,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  generated_by uuid REFERENCES auth.users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz,
  notes text,
  UNIQUE(editor_id, brand, bill_month)
);
CREATE INDEX IF NOT EXISTS idx_video_bills_editor_month ON public.video_bills(editor_id, bill_month);

-- 9. RPC: generate (or regenerate) a bill for a given editor/brand/month.
--    Recomputes from the current set of billable videos so re-runs are safe.
CREATE OR REPLACE FUNCTION public.generate_video_bill(
  _editor uuid,
  _brand public.video_brand,
  _month date
) RETURNS public.video_bills
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate numeric(10,2);
  v_count int;
  v_bill public.video_bills;
  v_month_start date := date_trunc('month', _month)::date;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admin can generate video bills';
  END IF;

  SELECT per_video_rate INTO v_rate FROM public.video_editors WHERE id = _editor;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Editor not found: %', _editor;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.videos
   WHERE editor_id = _editor
     AND brand = _brand
     AND is_billable = true
     AND posted_month = v_month_start;

  INSERT INTO public.video_bills (
    editor_id, brand, bill_month, video_count, per_video_rate, total_amount, generated_by
  ) VALUES (
    _editor, _brand, v_month_start, v_count, v_rate, v_count * v_rate, auth.uid()
  )
  ON CONFLICT (editor_id, brand, bill_month) DO UPDATE
     SET video_count    = EXCLUDED.video_count,
         per_video_rate = EXCLUDED.per_video_rate,
         total_amount   = EXCLUDED.total_amount,
         generated_at   = now(),
         generated_by   = EXCLUDED.generated_by
  RETURNING * INTO v_bill;

  RETURN v_bill;
END;
$$;

-- 10. RLS
ALTER TABLE public.video_editors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_bills   ENABLE ROW LEVEL SECURITY;

-- video_editors
DROP POLICY IF EXISTS video_editors_super_admin ON public.video_editors;
CREATE POLICY video_editors_super_admin ON public.video_editors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS video_editors_self_read ON public.video_editors;
CREATE POLICY video_editors_self_read ON public.video_editors FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- videos
DROP POLICY IF EXISTS videos_super_admin ON public.videos;
CREATE POLICY videos_super_admin ON public.videos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS videos_editor_manage_own ON public.videos;
CREATE POLICY videos_editor_manage_own ON public.videos FOR ALL TO authenticated
  USING (editor_id IN (SELECT id FROM public.video_editors WHERE user_id = auth.uid()))
  WITH CHECK (editor_id IN (SELECT id FROM public.video_editors WHERE user_id = auth.uid()));

-- video_bills
DROP POLICY IF EXISTS video_bills_super_admin ON public.video_bills;
CREATE POLICY video_bills_super_admin ON public.video_bills FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS video_bills_editor_read ON public.video_bills;
CREATE POLICY video_bills_editor_read ON public.video_bills FOR SELECT TO authenticated
  USING (editor_id IN (SELECT id FROM public.video_editors WHERE user_id = auth.uid()));

-- 11. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_editors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.videos        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_bills   TO authenticated;
GRANT ALL ON public.video_editors TO service_role;
GRANT ALL ON public.videos        TO service_role;
GRANT ALL ON public.video_bills   TO service_role;
REVOKE EXECUTE ON FUNCTION public.generate_video_bill(uuid, public.video_brand, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_video_bill(uuid, public.video_brand, date) TO authenticated;
-- The trigger function is never user-callable via REST. Strip the default
-- PUBLIC grant so the linter doesn't keep flagging it.
REVOKE EXECUTE ON FUNCTION public.videos_before_change() FROM PUBLIC, anon, authenticated;

-- 12. Permissions seed
INSERT INTO public.permissions (module, action, description) VALUES
  ('video_editor',  'view', 'View video editor portal (own videos)'),
  ('video_editor',  'edit', 'Submit and edit own videos'),
  ('video_approval','view', 'View video approval queue'),
  ('video_approval','approve', 'Approve or reject videos'),
  ('video_bills',   'view', 'View video bills'),
  ('video_bills',   'edit', 'Generate and mark bills paid')
ON CONFLICT (module, action) DO NOTHING;

-- Grant view+edit of editor portal to video_editor role
DO $$
DECLARE v_perm uuid;
BEGIN
  SELECT id INTO v_perm FROM public.permissions WHERE module='video_editor' AND action='view';
  INSERT INTO public.role_permissions (role, permission_id) VALUES ('video_editor'::app_role, v_perm) ON CONFLICT DO NOTHING;
  SELECT id INTO v_perm FROM public.permissions WHERE module='video_editor' AND action='edit';
  INSERT INTO public.role_permissions (role, permission_id) VALUES ('video_editor'::app_role, v_perm) ON CONFLICT DO NOTHING;
END $$;
-- (super_admin gets everything by code shortcut in RequirePermission)

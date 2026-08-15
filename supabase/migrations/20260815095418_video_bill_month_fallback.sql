-- Video bill month: never leave a billable video without a bill month.
--
-- Bug: is_billable is gated on the three platform URLs, but posted_month was
-- only computed when all three posting DATES were present. Editors who filled
-- the links but not the dates left videos billable-but-monthless, so they never
-- surfaced on the Video Bills page and could never be generated/paid.
--
-- Fix: bill month = exact latest posting month when all three dates exist
-- (precise, honours the original rule), otherwise the ADMIN APPROVAL month —
-- a system-controlled, editor-unforgeable anchor (approval is a super-admin
-- action). This keeps billing fraud-resistant without trusting editor-typed
-- dates, and guarantees a billable video always has a month.

CREATE OR REPLACE FUNCTION public.videos_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  all_posted boolean;
BEGIN
  -- (a) Editor guard — non-super-admins cannot touch approval fields or
  -- arbitrarily move status.
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
      IF OLD.status = 'rejected'
         AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.drive_url IS DISTINCT FROM OLD.drive_url) THEN
        NEW.status := 'pending_approval';
      ELSIF OLD.status IN ('approved','published') THEN
        IF NEW.status NOT IN ('approved','published') THEN
          NEW.status := OLD.status;
        END IF;
      ELSE
        NEW.status := OLD.status;
      END IF;
    END IF;
  END IF;

  -- (b) Auto-publish when approved AND all three platforms have URLs.
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

  -- (c) Derived columns.
  all_posted :=
    NEW.instagram_posted_on IS NOT NULL
    AND NEW.linkedin_posted_on IS NOT NULL
    AND NEW.youtube_posted_on IS NOT NULL;

  NEW.is_billable :=
    NEW.status IN ('approved','published')
    AND NEW.instagram_url IS NOT NULL AND NEW.instagram_url <> ''
    AND NEW.linkedin_url IS NOT NULL AND NEW.linkedin_url <> ''
    AND NEW.youtube_url IS NOT NULL AND NEW.youtube_url <> '';

  -- Bill month: precise posting month when the three dates exist, else the
  -- admin approval month (fraud-proof fallback), else created month. Never
  -- null for a billable video.
  NEW.posted_month := CASE
    WHEN NOT NEW.is_billable THEN NULL
    WHEN all_posted THEN date_trunc('month',
      GREATEST(NEW.instagram_posted_on, NEW.linkedin_posted_on, NEW.youtube_posted_on)
    )::date
    ELSE date_trunc('month', COALESCE(NEW.approved_at, NEW.created_at))::date
  END;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Backfill: recompute the month for every billable video that currently has
-- none (the 78 with links but no posting dates → approval month).
UPDATE public.videos
   SET posted_month = date_trunc('month', COALESCE(approved_at, created_at))::date
 WHERE is_billable = true AND posted_month IS NULL;

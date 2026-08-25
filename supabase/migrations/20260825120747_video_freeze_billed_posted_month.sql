-- Once a video is claimed by an approved/paid bill, freeze its posted_month
-- and video_bill_id. No refetch, manual edit, or backfill can move it.
-- Draft bills are still mutable (delete the draft to unclaim).

CREATE OR REPLACE FUNCTION public.videos_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  v_anchor timestamptz;
  v_bill_status text;
  v_frozen boolean := false;
BEGIN
  -- ── Freeze guard: if claimed by a non-draft bill, lock billing fields ──
  IF TG_OP = 'UPDATE' AND OLD.video_bill_id IS NOT NULL THEN
    SELECT status INTO v_bill_status
      FROM public.video_bills WHERE id = OLD.video_bill_id;
    IF v_bill_status IS NOT NULL AND v_bill_status <> 'draft' THEN
      NEW.posted_month   := OLD.posted_month;
      NEW.video_bill_id  := OLD.video_bill_id;
      v_frozen := true;
    END IF;
  END IF;

  -- ── (a) Editor guard ──
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

  -- ── (b) Auto-publish ──
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

  -- ── (c) Derived columns ──
  NEW.is_billable :=
    NEW.status IN ('approved','published')
    AND NEW.instagram_url IS NOT NULL AND NEW.instagram_url <> ''
    AND NEW.linkedin_url IS NOT NULL AND NEW.linkedin_url <> ''
    AND NEW.youtube_url IS NOT NULL AND NEW.youtube_url <> '';

  -- Billing anchor: earliest of all three platform-derived dates.
  -- Skip recompute when frozen by the guard above.
  IF NOT v_frozen THEN
    v_anchor := LEAST(NEW.instagram_posted_on, NEW.youtube_posted_on, NEW.linkedin_posted_on);
    NEW.posted_month := CASE
      WHEN NOT NEW.is_billable THEN NULL
      WHEN v_anchor IS NOT NULL THEN date_trunc('month', v_anchor)::date
      ELSE date_trunc('month', COALESCE(NEW.approved_at, NEW.created_at))::date
    END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

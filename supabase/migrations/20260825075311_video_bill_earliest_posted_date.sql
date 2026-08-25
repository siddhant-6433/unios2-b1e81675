-- Use the EARLIEST platform posting date for billing month, not the latest.
-- ponytail: one-word fix (GREATEST→LEAST); everything else reads posted_month.

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

  -- Use LEAST = first posted date (earliest across all platforms).
  NEW.posted_month := CASE
    WHEN all_posted THEN date_trunc('month',
      LEAST(NEW.instagram_posted_on, NEW.linkedin_posted_on, NEW.youtube_posted_on)
    )::date
    ELSE NULL
  END;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Backfill: recompute posted_month for all existing videos.
UPDATE public.videos SET updated_at = now();

-- Unclaim videos whose posted_month shifted away from their bill's month.
UPDATE public.videos v
   SET video_bill_id = NULL
  FROM public.video_bills b
 WHERE v.video_bill_id = b.id
   AND v.posted_month <> b.bill_month;

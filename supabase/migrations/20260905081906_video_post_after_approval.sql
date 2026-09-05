-- Video social links: posting timestamp must be at or after approval timestamp.
--
-- Editors were attaching Instagram *draft* / preview permalinks (and posts that
-- went live before the reviewer signed off). Status flipped to published and
-- the row became billable as soon as three URLs existed, even when the platform
-- timestamp was missing or earlier than videos.approved_at.
--
-- Rule: published + billable only when all three platform timestamps exist AND
-- each is >= approved_at. Calendar-day equality is not enough — 09:00 before
-- an 11:00 approval on the same day is rejected.

CREATE OR REPLACE FUNCTION public.videos_before_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  all_urls boolean;
  all_posted boolean;
  all_after_approval boolean;
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

  all_urls :=
    NEW.instagram_url IS NOT NULL AND NEW.instagram_url <> ''
    AND NEW.linkedin_url IS NOT NULL AND NEW.linkedin_url <> ''
    AND NEW.youtube_url  IS NOT NULL AND NEW.youtube_url  <> '';

  all_posted :=
    NEW.instagram_posted_on IS NOT NULL
    AND NEW.linkedin_posted_on IS NOT NULL
    AND NEW.youtube_posted_on IS NOT NULL;

  -- Timestamp-level check (not calendar day). Missing dates fail closed so
  -- unpublished Instagram drafts cannot count as posted.
  all_after_approval :=
    NEW.approved_at IS NOT NULL
    AND all_posted
    AND NEW.instagram_posted_on >= NEW.approved_at
    AND NEW.linkedin_posted_on  >= NEW.approved_at
    AND NEW.youtube_posted_on   >= NEW.approved_at;

  -- (b) Auto-publish only when all three live posts are timestamped at/after
  --     approval. URLs alone (draft permalinks) stay on 'approved'.
  IF NEW.status IN ('approved','published') THEN
    IF all_urls AND all_after_approval THEN
      NEW.status := 'published';
    ELSE
      NEW.status := 'approved';
    END IF;
  END IF;

  -- (c) Derived columns.
  NEW.is_billable :=
    NEW.status IN ('approved','published')
    AND all_urls
    AND all_after_approval;

  NEW.posted_month := CASE
    WHEN NOT NEW.is_billable THEN NULL
    ELSE date_trunc('month',
      LEAST(NEW.instagram_posted_on, NEW.linkedin_posted_on, NEW.youtube_posted_on)
    )::date
  END;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Recompute status / is_billable / posted_month for every row.
UPDATE public.videos SET updated_at = now();

-- Drop draft-bill claims that no longer match (pre-approval / draft-link rows
-- just lost is_billable). Leave paid/approved bills untouched as history.
UPDATE public.videos v
   SET video_bill_id = NULL
  FROM public.video_bills b
 WHERE v.video_bill_id = b.id
   AND b.status = 'draft'
   AND (v.is_billable = false OR v.posted_month IS DISTINCT FROM b.bill_month);

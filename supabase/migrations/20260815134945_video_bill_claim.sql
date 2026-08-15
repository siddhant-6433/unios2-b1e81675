-- Video bills: claim each billable video to exactly one bill so it can never be
-- billed twice. Late-posted videos in an already-billed month form a NEW,
-- separate bill for just the unbilled ones.

-- 1. Claim link + allow multiple bills per (editor, brand, month).
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS video_bill_id uuid REFERENCES public.video_bills(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_videos_bill ON public.videos(video_bill_id);

-- The old one-bill-per-month uniqueness blocks second bills. Drop it; the
-- rewritten generate_video_bill no longer upserts on it.
ALTER TABLE public.video_bills DROP CONSTRAINT IF EXISTS video_bills_editor_id_brand_bill_month_key;

-- 2. Rewrite generate: bill only UNCLAIMED billable videos, new bill each call.
--    Atomic + concurrency-safe — the claiming UPDATE row-locks the videos, so a
--    concurrent generate for the same key claims 0 and rolls back.
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
  v_bill_id uuid;
  v_month_start date := date_trunc('month', _month)::date;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admin can generate video bills';
  END IF;

  SELECT per_video_rate INTO v_rate FROM public.video_editors WHERE id = _editor;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Editor not found: %', _editor;
  END IF;

  -- Reserve the bill id first so we can stamp it onto the claimed videos.
  INSERT INTO public.video_bills (
    editor_id, brand, bill_month, video_count, per_video_rate, total_amount, generated_by
  ) VALUES (
    _editor, _brand, v_month_start, 0, v_rate, 0, auth.uid()
  )
  RETURNING id INTO v_bill_id;

  -- Claim every unbilled billable video for this key.
  UPDATE public.videos
     SET video_bill_id = v_bill_id
   WHERE editor_id = _editor
     AND brand = _brand
     AND is_billable = true
     AND posted_month = v_month_start
     AND video_bill_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No new billable videos to bill for this editor/brand/month';
  END IF;

  UPDATE public.video_bills
     SET video_count = v_count, total_amount = v_count * v_rate
   WHERE id = v_bill_id
  RETURNING * INTO v_bill;

  RETURN v_bill;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_video_bill(uuid, public.video_brand, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generate_video_bill(uuid, public.video_brand, date) TO authenticated;

-- 3. Delete a DRAFT bill (super_admin). The FK (ON DELETE SET NULL) unclaims its
--    videos automatically, returning them to the unbilled pool. Approved/paid
--    bills are immutable and cannot be deleted here.
CREATE OR REPLACE FUNCTION public.delete_video_bill(_bill uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admin can delete video bills';
  END IF;
  SELECT status INTO v_status FROM public.video_bills WHERE id = _bill;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft bills can be deleted (this one is %)', v_status;
  END IF;
  DELETE FROM public.video_bills WHERE id = _bill;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_video_bill(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_video_bill(uuid) TO authenticated;

-- 4. Backfill: claim each existing bill's month of billable videos (earliest
--    bill first, though today there's only one bill per key).
UPDATE public.videos v
   SET video_bill_id = b.id
  FROM public.video_bills b
 WHERE v.video_bill_id IS NULL
   AND v.is_billable = true
   AND v.editor_id = b.editor_id
   AND v.brand = b.brand
   AND v.posted_month = b.bill_month;

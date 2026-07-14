-- Revision tracking and super-admin deletion for fee proposals.

ALTER TABLE public.fee_proposals
  ADD COLUMN IF NOT EXISTS revision_group_id uuid,
  ADD COLUMN IF NOT EXISTS revision_number integer,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.fee_proposals(id);

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (PARTITION BY lead_id ORDER BY created_at, id) AS group_id,
    row_number() OVER (PARTITION BY lead_id ORDER BY created_at, id) AS revision_no,
    row_number() OVER (PARTITION BY lead_id ORDER BY created_at DESC, id DESC) AS newest_rank
  FROM public.fee_proposals
)
UPDATE public.fee_proposals fp
SET
  revision_group_id = COALESCE(fp.revision_group_id, ranked.group_id),
  revision_number = COALESCE(fp.revision_number, ranked.revision_no),
  is_current = ranked.newest_rank = 1,
  superseded_at = CASE
    WHEN ranked.newest_rank = 1 THEN fp.superseded_at
    ELSE COALESCE(fp.superseded_at, fp.updated_at, fp.created_at)
  END
FROM ranked
WHERE ranked.id = fp.id;

ALTER TABLE public.fee_proposals
  ALTER COLUMN revision_group_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN revision_group_id SET NOT NULL,
  ALTER COLUMN revision_number SET DEFAULT 1,
  ALTER COLUMN revision_number SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_proposals_current
  ON public.fee_proposals (lead_id, is_current, created_at DESC);

COMMENT ON COLUMN public.fee_proposals.revision_group_id IS
  'Stable ID shared by all revisions of a proposal chain.';
COMMENT ON COLUMN public.fee_proposals.revision_number IS
  'Human-facing revision number inside revision_group_id.';
COMMENT ON COLUMN public.fee_proposals.is_current IS
  'Only current approved proposals should be shared with parents/applicants.';

DROP POLICY IF EXISTS "Admissions staff can view fee proposals" ON public.fee_proposals;
CREATE POLICY "Admissions staff can view fee proposals"
  ON public.fee_proposals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Admissions staff can create fee proposals" ON public.fee_proposals;
CREATE POLICY "Admissions staff can create fee proposals"
  ON public.fee_proposals FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'counsellor')
  );

DROP POLICY IF EXISTS "Super admins can delete fee proposals" ON public.fee_proposals;
CREATE POLICY "Super admins can delete fee proposals"
  ON public.fee_proposals FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

GRANT DELETE ON public.fee_proposals TO authenticated;

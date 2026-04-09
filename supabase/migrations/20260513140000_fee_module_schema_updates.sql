-- Step 1: Fee module schema updates
-- - Add transport_zone to students
-- - Add fee_structure_item_id to fee_ledger
-- - Create NB-DBA (Day Boarding) fee code
-- - Add 2-level concession approval columns

-- =====================================================
-- 1. students: transport zone
-- =====================================================
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS transport_zone text;

COMMENT ON COLUMN public.students.transport_zone IS 'zone_1 | zone_2 | zone_3 — matches NB-TR1/TR2/TR3 fee codes';

-- =====================================================
-- 2. fee_ledger: trace back to fee_structure_item
-- =====================================================
ALTER TABLE public.fee_ledger
  ADD COLUMN IF NOT EXISTS fee_structure_item_id uuid REFERENCES public.fee_structure_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fee_ledger.fee_structure_item_id IS 'Which template item generated this row (for re-provisioning)';

-- =====================================================
-- 3. NB-DBA fee code — Day Boarding
-- =====================================================
INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('NB-DBA', 'Beacon Day Boarding', 'hostel', true)
ON CONFLICT (code) DO NOTHING;

-- Day boarding amounts per band will be added via the admin panel later.
-- The edge function will pick up whatever fee_structure_items exist for NB-DBA.

-- =====================================================
-- 4. concessions: 2-level approval workflow
-- =====================================================

-- Drop the old CHECK constraint on status if it exists
DO $$
BEGIN
  -- Try to drop any existing check constraint on status
  BEGIN
    ALTER TABLE public.concessions DROP CONSTRAINT IF EXISTS concessions_status_check;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;

-- Add new approval columns
ALTER TABLE public.concessions
  ADD COLUMN IF NOT EXISTS approved_by_principal uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS principal_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_super_admin uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS super_admin_decision_at timestamptz;

-- New status CHECK with 2-level statuses
ALTER TABLE public.concessions
  ADD CONSTRAINT concessions_status_check
  CHECK (status IN ('pending_principal', 'pending_super_admin', 'approved', 'rejected'));

-- Update any existing rows with old status values to 'pending_principal'
UPDATE public.concessions
SET status = 'pending_principal'
WHERE status NOT IN ('pending_principal', 'pending_super_admin', 'approved', 'rejected');

-- =====================================================
-- 5. RLS policies for concessions
-- =====================================================
ALTER TABLE public.concessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate
DROP POLICY IF EXISTS "concessions_select" ON public.concessions;
DROP POLICY IF EXISTS "concessions_insert" ON public.concessions;
DROP POLICY IF EXISTS "concessions_update" ON public.concessions;

-- Anyone authenticated can read (counsellors see their own, principals/super_admins see all)
CREATE POLICY "concessions_select" ON public.concessions
  FOR SELECT TO authenticated USING (true);

-- Counsellors + super_admin can insert
CREATE POLICY "concessions_insert" ON public.concessions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('counsellor', 'super_admin', 'campus_admin', 'accountant')
    )
  );

-- Principal + super_admin can update (approve/reject)
CREATE POLICY "concessions_update" ON public.concessions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('principal', 'super_admin')
    )
  );

-- =====================================================
-- 6. Grants for service_role
-- =====================================================
GRANT ALL ON public.concessions TO service_role;
GRANT ALL ON public.fee_ledger TO service_role;
GRANT ALL ON public.fee_structure_items TO service_role;
GRANT ALL ON public.fee_structures TO service_role;
GRANT ALL ON public.fee_codes TO service_role;
GRANT SELECT ON public.students TO service_role;

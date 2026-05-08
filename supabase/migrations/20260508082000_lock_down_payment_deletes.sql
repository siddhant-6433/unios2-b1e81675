-- Restrict DELETE on every financial table to super_admin only.
--
-- Audit: today the lead_payments + fee_ledger policies use `FOR ALL`,
-- which means any user with a role can delete a payment row. The audit
-- log catches it after the fact, but the action itself shouldn't be
-- possible for non-super_admins. This migration replaces every
-- permissive FOR ALL policy on payment-bearing tables with explicit
-- per-op policies (SELECT/INSERT/UPDATE permissive, DELETE locked).
--
-- payments table already has only SELECT + INSERT policies — no
-- UPDATE/DELETE policy means RLS rejects those by default, so it's
-- already correctly locked. We add explicit super_admin policies for
-- super_admins anyway so legitimate cases don't fail.

-- ────────── lead_payments ─────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can manage lead_payments" ON public.lead_payments;
DROP POLICY IF EXISTS "Staff can manage lead_payments" ON public.lead_payments;

CREATE POLICY "Staff can read lead_payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Staff can insert lead_payments" ON public.lead_payments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Staff can update lead_payments" ON public.lead_payments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

CREATE POLICY "Only super_admin can delete lead_payments" ON public.lead_payments
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ────────── payments ─────────────────────────────────────────────
-- Existing SELECT + INSERT policies stay. Add explicit UPDATE for
-- accountants (they edit payment metadata like notes occasionally) and
-- super_admin-only DELETE.
DROP POLICY IF EXISTS "Finance staff can update payments" ON public.payments;
DROP POLICY IF EXISTS "Only super_admin can delete payments" ON public.payments;

CREATE POLICY "Finance staff can update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Only super_admin can delete payments" ON public.payments
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ────────── fee_ledger ───────────────────────────────────────────
-- Replace the broad "Finance staff can manage ledger" FOR ALL policy
-- with per-op rules. Update permitted (concession edits, paid_amount
-- corrections); delete super_admin only.
DROP POLICY IF EXISTS "Finance staff can manage ledger" ON public.fee_ledger;

CREATE POLICY "Finance staff can insert ledger" ON public.fee_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Finance staff can update ledger" ON public.fee_ledger
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Only super_admin can delete fee_ledger" ON public.fee_ledger
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ────────── fee_ledger_payments ──────────────────────────────────
-- Link rows: insert/select for finance, delete super_admin only.
DROP POLICY IF EXISTS "Finance staff can insert ledger payments" ON public.fee_ledger_payments;
DROP POLICY IF EXISTS "Only super_admin can delete fee_ledger_payments" ON public.fee_ledger_payments;

CREATE POLICY "Finance staff can insert ledger payments" ON public.fee_ledger_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Only super_admin can delete fee_ledger_payments" ON public.fee_ledger_payments
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ────────── concessions ──────────────────────────────────────────
-- concessions_select / _insert / _update already exist. Add explicit
-- super_admin-only DELETE.
DROP POLICY IF EXISTS "Only super_admin can delete concessions" ON public.concessions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='concessions') THEN
    EXECUTE 'CREATE POLICY "Only super_admin can delete concessions" ON public.concessions
              FOR DELETE TO authenticated
              USING (public.has_role(auth.uid(), ''super_admin''))';
  END IF;
END $$;

-- ────────── offer_waivers ────────────────────────────────────────
DROP POLICY IF EXISTS "Only super_admin can delete offer_waivers" ON public.offer_waivers;

CREATE POLICY "Only super_admin can delete offer_waivers" ON public.offer_waivers
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ────────── applications.payment-bearing rows ────────────────────
-- Block deletion of applications that have already been paid. A
-- super_admin can still delete unpaid drafts, but a paid application
-- (real money received) is immutable. Combined with the audit trigger
-- already firing on payment_status changes, this gives full coverage.
DROP POLICY IF EXISTS "Block delete of paid applications" ON public.applications;
DROP POLICY IF EXISTS "Only super_admin can delete applications" ON public.applications;

CREATE POLICY "Only super_admin can delete applications" ON public.applications
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    AND payment_status IS DISTINCT FROM 'paid'
  );

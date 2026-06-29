-- Academic partner minimum guarantee terms, partner-scoped student listing,
-- and seeding of the NIMT <> STETHO agreement payout + minimum guarantee.

-- 1. Minimum guarantee + lock-in terms on the partner record.
ALTER TABLE public.academic_partners
  ADD COLUMN IF NOT EXISTS minimum_guarantee_year1 numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_guarantee_year1 >= 0),
  ADD COLUMN IF NOT EXISTS minimum_guarantee_year2 numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_guarantee_year2 >= 0),
  ADD COLUMN IF NOT EXISTS minimum_guarantee_year3 numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_guarantee_year3 >= 0),
  ADD COLUMN IF NOT EXISTS lock_in_years integer NOT NULL DEFAULT 3 CHECK (lock_in_years >= 0),
  ADD COLUMN IF NOT EXISTS lock_in_start_date date;

-- 2. Dashboard view now also surfaces the minimum guarantee + lock-in terms.
--    New columns are appended at the end so CREATE OR REPLACE keeps the existing
--    column order and types intact.
CREATE OR REPLACE VIEW public.academic_partner_dashboard AS
SELECT
  ap.id AS partner_id,
  ap.user_id,
  ap.name AS partner_name,
  ap.organization,
  ap.phone,
  ap.email,
  ap.status,
  ap.default_payout_percentage,
  (SELECT COUNT(DISTINCT apa.course_id)
     FROM public.academic_partner_assignments apa
    WHERE apa.partner_id = ap.id AND apa.is_active = true) AS assigned_courses,
  (SELECT COUNT(DISTINCT apa.batch_id)
     FROM public.academic_partner_assignments apa
    WHERE apa.partner_id = ap.id AND apa.batch_id IS NOT NULL AND apa.is_active = true) AS assigned_batches,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id) AS total_leads,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id AND l.stage = 'admitted') AS conversions,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id AND l.stage NOT IN ('rejected', 'admitted')) AS pipeline,
  (SELECT COUNT(DISTINCT s.id)
     FROM public.students s
    WHERE EXISTS (
      SELECT 1 FROM public.academic_partner_assignments apa
      WHERE apa.partner_id = ap.id
        AND apa.is_active = true
        AND apa.course_id = s.course_id
        AND (apa.batch_id IS NULL OR apa.batch_id = s.batch_id)
    )) AS total_candidates,
  COALESCE((SELECT SUM(fl.paid_amount)
     FROM public.fee_ledger fl
     JOIN public.students s ON s.id = fl.student_id
     JOIN public.leads l ON l.id = s.lead_id AND l.academic_partner_id = ap.id
    ), 0)::numeric(12,2) AS total_fee_collected,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status IN ('pending', 'approved', 'paid')), 0)::numeric(12,2) AS total_payout,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status IN ('pending', 'approved')), 0)::numeric(12,2) AS pending_payout,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status = 'paid'), 0)::numeric(12,2) AS paid_payout,
  ap.minimum_guarantee_year1,
  ap.minimum_guarantee_year2,
  ap.minimum_guarantee_year3,
  ap.lock_in_years,
  ap.lock_in_start_date
FROM public.academic_partners ap;

GRANT SELECT ON public.academic_partner_dashboard TO authenticated;

-- 3. Partner-scoped student list (students whose owning lead belongs to the
--    partner). security_invoker keeps the existing RLS on students/fee_ledger,
--    so admins see all rows and academic partners only see their own scope.
DROP VIEW IF EXISTS public.academic_partner_students;
CREATE VIEW public.academic_partner_students
WITH (security_invoker = on) AS
SELECT
  l.academic_partner_id AS partner_id,
  s.id AS student_id,
  s.lead_id,
  TRIM(BOTH ' ' FROM COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS student_name,
  s.admission_no,
  s.status,
  s.course_id,
  c.name AS course_name,
  s.batch_id,
  b.name AS batch_name,
  s.created_at,
  COALESCE(SUM(fl.total_amount), 0)::numeric(14,2) AS fee_total,
  COALESCE(SUM(fl.paid_amount), 0)::numeric(14,2) AS fee_paid,
  COALESCE(SUM(fl.balance), 0)::numeric(14,2) AS fee_balance
FROM public.students s
JOIN public.leads l ON l.id = s.lead_id AND l.academic_partner_id IS NOT NULL
LEFT JOIN public.courses c ON c.id = s.course_id
LEFT JOIN public.batches b ON b.id = s.batch_id
LEFT JOIN public.fee_ledger fl ON fl.student_id = s.id
GROUP BY l.academic_partner_id, s.id, s.lead_id, s.first_name, s.last_name, s.admission_no, s.status, s.course_id, c.name, s.batch_id, b.name, s.created_at;

GRANT SELECT ON public.academic_partner_students TO authenticated;

-- 4. Seed the NIMT <> STETHO agreement terms (idempotent, only if the partner
--    record exists). Academic revenue share: NIMT 57% / STETHO 43%.
--    Minimum guarantee over the 3-year lock-in per the signed MOU.
UPDATE public.academic_partners
SET
  default_payout_percentage = 43,
  minimum_guarantee_year1 = 960000,
  minimum_guarantee_year2 = 2992374,
  minimum_guarantee_year3 = 4453357,
  lock_in_years = 3,
  updated_at = now()
WHERE pan_number = 'ABTCS6641J'
   OR name ILIKE '%stetho%'
   OR organization ILIKE '%stetho%'
   OR organization ILIKE '%stethion%';

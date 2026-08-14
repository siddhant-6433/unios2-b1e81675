-- Keep annual CTC alongside the monthly figure payroll runs on.
--
-- NIMT's salary records are annual CTC ("3,00,000/yr"); payroll needs a monthly
-- gross. Storing only the derived monthly value would lose the number everyone
-- actually negotiates and quotes, and would make reconciliation against the source
-- sheet impossible. Both are kept, monthly_gross stays the single figure the
-- calculation engine reads.
--
-- NOTE: CTC and gross are not the same thing. CTC usually includes the employer's
-- PF/ESI contribution, so monthly_gross = ctc/12 slightly overstates gross wherever
-- those contributions apply. It is the right starting point for a like-for-like
-- import, and the per-employee figure can be corrected once a month is reconciled
-- against the payroll spreadsheet.
ALTER TABLE public.employee_salaries
  ADD COLUMN IF NOT EXISTS annual_ctc numeric(14,2),
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.employee_salaries.annual_ctc IS
  'Annual cost to company as recorded at source. monthly_gross is what payroll uses.';
COMMENT ON COLUMN public.employee_salaries.source IS
  'Where this record came from, e.g. keka_ctc_import — so an import can be re-run or undone.';

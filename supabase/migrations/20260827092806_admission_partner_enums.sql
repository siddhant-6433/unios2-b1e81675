-- Admission Partner role — enum values.
--
-- Adds the `admission_partner` app_role (a narrower cousin of academic_partner:
-- sources admissions, no academics/teaching) and a matching lead_source so
-- partner-entered leads are attributable and filterable.
--
-- Enum ADD VALUE cannot be used in the same transaction that declares it, so
-- these live in their own migration ahead of 20260827070718_admission_partner_role.
-- IF NOT EXISTS keeps it idempotent across re-runs / ledger drift.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admission_partner';
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'admission_partner';

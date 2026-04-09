-- NIMT School Arthala (GZ1-BSA) only offers grades up to Grade VIII.
-- Remove Grade IX–XII which were incorrectly added.
DELETE FROM public.courses WHERE code IN ('BSA-G9', 'BSA-G10', 'BSA-G11', 'BSA-G12');

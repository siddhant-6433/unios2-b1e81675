-- Mark PGDM Ghaziabad as inactive (admissions not open)
UPDATE public.courses SET is_active = false WHERE code = 'PGDM-GZ';

-- Rename Beacon institutions to proper display names
UPDATE public.institutions
SET name = 'NIMT School Arthala'
WHERE code = 'GZ1-BSA';

UPDATE public.institutions
SET name = 'NIMT B School Avantika II Ghaziabad (Aff to CBSE)'
WHERE code = 'GZ3-BSAV';

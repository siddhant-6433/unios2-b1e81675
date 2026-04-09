-- Rename Ghaziabad campuses to include locality names for clarity
UPDATE public.campuses SET name = 'Ghaziabad Campus 1 (Arthala)'   WHERE code = 'GZ1';
UPDATE public.campuses SET name = 'Ghaziabad Campus 2 (Avantika)'  WHERE code = 'GZ2';
UPDATE public.campuses SET name = 'Ghaziabad Campus 3 (Avantika II)' WHERE code = 'GZ3';

-- Fix BPT course type: should be semester, not annual.
UPDATE public.courses
SET type = 'semester'
WHERE code = 'BPT-GN';

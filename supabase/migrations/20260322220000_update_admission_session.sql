-- Set 2026-27 as the only active session and remove 2025-26
DELETE FROM public.admission_sessions WHERE name = '2025-26';

UPDATE public.admission_sessions
SET is_active = true
WHERE name = 'Academic Year 2026-27';

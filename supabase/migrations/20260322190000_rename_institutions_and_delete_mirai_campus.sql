-- ── Rename institution codes ────────────────────────────────
UPDATE public.institutions SET code = 'GZ1-CEDS' WHERE code = 'GZ-EDU';
UPDATE public.institutions SET code = 'GZ1-MES'  WHERE code = 'MES';
UPDATE public.institutions SET code = 'GZ1-BSA'  WHERE code = 'BSA';
UPDATE public.institutions SET code = 'GZ1-ITM'  WHERE code = 'GZ-ITM';

-- ── Delete empty MIRAI-EXP campus ───────────────────────────
DELETE FROM public.campuses WHERE code = 'MIRAI-EXP';

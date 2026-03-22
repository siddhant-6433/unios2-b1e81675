-- ============================================================
-- Restructure Ghaziabad campuses and clean up duplicate data
-- ============================================================

-- ── 1. Rename GZ → GZ1 ──────────────────────────────────────
UPDATE public.campuses
SET name = 'Ghaziabad Campus 1', code = 'GZ1'
WHERE code = 'GZ';

-- ── 2. Create Ghaziabad Campus 2 (GZ2) ──────────────────────
INSERT INTO public.campuses (id, name, code, city, state)
VALUES (
  'c0000002-0000-0000-0000-000000000001',
  'Ghaziabad Campus 2', 'GZ2', 'Ghaziabad', 'Uttar Pradesh'
)
ON CONFLICT (code) DO NOTHING;

-- ── 3. Move GZ-EDU institution to GZ2 ───────────────────────
-- (was under GZ / now GZ1 → move to GZ2)
UPDATE public.institutions
SET campus_id = 'c0000002-0000-0000-0000-000000000001'
WHERE code = 'GZ-EDU';

-- ── 4. Move MES (Mirai Experiential School) to GZ2 ──────────
UPDATE public.institutions
SET campus_id = 'c0000002-0000-0000-0000-000000000001'
WHERE code = 'MES';

-- ── 5. Rename NSAVT → GZ3 ───────────────────────────────────
UPDATE public.campuses
SET name = 'Ghaziabad Campus 3', code = 'GZ3'
WHERE code = 'NSAVT';

-- ── 6. Move BSA institution to GZ1 ──────────────────────────
-- BSA is currently under NSART; move it before NSART is deleted
UPDATE public.institutions
SET campus_id = 'c0000001-0000-0000-0000-000000000002'
WHERE code = 'BSA';

-- ── 7. Delete NIMTGZB campus (cascades → institutions → depts → courses) ──
DELETE FROM public.campuses WHERE code = 'NIMTGZB';

-- ── 8. Delete NIMTGN campus ─────────────────────────────────
DELETE FROM public.campuses WHERE code = 'NIMTGN';

-- ── 9. Delete NIMTKTP campus ────────────────────────────────
DELETE FROM public.campuses WHERE code = 'NIMTKTP';

-- ── 10. Delete NSART campus (BSA already moved out) ─────────
DELETE FROM public.campuses WHERE code = 'NSART';

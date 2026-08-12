-- The cashier's sidebar should be a cash counter, not the whole college.
--
-- accountant was granted attendance:view and exams:view, so Attendance and
-- Exams sat in the sidebar next to Finance. Neither is any part of collecting
-- fees, and the sidebar is permission-driven (src/components/layout/AppSidebar.tsx
-- gates those two items on exactly these permissions), so the fix belongs in
-- role_permissions rather than a hardcoded role exclusion in the nav — the
-- grants also let the role open /attendance and /exams directly.
--
-- Leaves accountant with: dashboard, search, students, documents, finance:*,
-- fee_ledger:reallocate and staff_incentives:* — everything the counter needs.
--
-- Reversible per person: if one accountant genuinely needs attendance, grant it
-- through user_permission_overrides instead of handing it back to the role.

DELETE FROM public.role_permissions rp
 USING public.permissions p
 WHERE p.id = rp.permission_id
   AND rp.role = 'accountant'
   AND p.module IN ('attendance', 'exams')
   AND p.action = 'view';

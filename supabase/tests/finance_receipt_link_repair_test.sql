-- pgTAP coverage for the audited confirmed-receipt student-link repair.
-- Run with: supabase test db
BEGIN;
SELECT plan(32);

CREATE TEMP TABLE _receipt_repair_ids AS
SELECT
  '00000000-0000-0000-0000-00000000f001'::uuid AS actor,
  '00000000-0000-0000-0000-00000000f002'::uuid AS denied_actor,
  '00000000-0000-0000-0000-00000000f010'::uuid AS campus,
  '00000000-0000-0000-0000-00000000f011'::uuid AS other_campus,
  '00000000-0000-0000-0000-00000000f020'::uuid AS institution,
  '00000000-0000-0000-0000-00000000f021'::uuid AS other_institution,
  '00000000-0000-0000-0000-00000000f030'::uuid AS department,
  '00000000-0000-0000-0000-00000000f031'::uuid AS other_department,
  '00000000-0000-0000-0000-00000000f040'::uuid AS course,
  '00000000-0000-0000-0000-00000000f041'::uuid AS other_course,
  '00000000-0000-0000-0000-00000000f050'::uuid AS lead,
  '00000000-0000-0000-0000-00000000f060'::uuid AS target_student,
  '00000000-0000-0000-0000-00000000f061'::uuid AS wrong_course_student,
  '00000000-0000-0000-0000-00000000f062'::uuid AS wrong_campus_student,
  '00000000-0000-0000-0000-00000000f063'::uuid AS corrected_student,
  '00000000-0000-0000-0000-00000000f064'::uuid AS wrong_identity_student,
  '00000000-0000-0000-0000-00000000f065'::uuid AS other_lead_student,
  '00000000-0000-0000-0000-00000000f066'::uuid AS second_lead_student,
  '00000000-0000-0000-0000-00000000f070'::uuid AS payment,
  '00000000-0000-0000-0000-00000000f071'::uuid AS dated_payment,
  '00000000-0000-0000-0000-00000000f072'::uuid AS course_selection_payment,
  '00000000-0000-0000-0000-00000000f073'::uuid AS allocated_payment,
  '00000000-0000-0000-0000-00000000f074'::uuid AS other_lead,
  '00000000-0000-0000-0000-00000000f075'::uuid AS no_course_lead,
  '00000000-0000-0000-0000-00000000f080'::uuid AS fee_code,
  '00000000-0000-0000-0000-00000000f081'::uuid AS fee_ledger;

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ((SELECT actor FROM _receipt_repair_ids), 'authenticated', 'authenticated', 'receipt-repair-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ((SELECT denied_actor FROM _receipt_repair_ids), 'authenticated', 'authenticated', 'receipt-repair-denied@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.campuses (id, name, code) VALUES
  ((SELECT campus FROM _receipt_repair_ids), 'Receipt Repair Test', 'RPR'),
  ((SELECT other_campus FROM _receipt_repair_ids), 'Receipt Repair Other', 'RPO');
INSERT INTO public.institutions (id, campus_id, name, code, type) VALUES
  ((SELECT institution FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids), 'Repair Institution', 'RPI', 'school'),
  ((SELECT other_institution FROM _receipt_repair_ids), (SELECT other_campus FROM _receipt_repair_ids), 'Other Institution', 'RPOI', 'school');
INSERT INTO public.departments (id, institution_id, name, code) VALUES
  ((SELECT department FROM _receipt_repair_ids), (SELECT institution FROM _receipt_repair_ids), 'Repair Department', 'RPD'),
  ((SELECT other_department FROM _receipt_repair_ids), (SELECT other_institution FROM _receipt_repair_ids), 'Other Department', 'RPO');
INSERT INTO public.courses (id, department_id, name, code) VALUES
  ((SELECT course FROM _receipt_repair_ids), (SELECT department FROM _receipt_repair_ids), 'Repair Course', 'RPC'),
  ((SELECT other_course FROM _receipt_repair_ids), (SELECT department FROM _receipt_repair_ids), 'Other Course', 'ROC');
INSERT INTO public.fee_codes (id, code, name, category, is_recurring) VALUES
  ((SELECT fee_code FROM _receipt_repair_ids), 'RPR-TEST-CODE', 'Repair Test Fee', 'other', false);

INSERT INTO public.profiles (user_id, display_name, campus) VALUES
  ((SELECT actor FROM _receipt_repair_ids), 'Receipt Repair Test', 'Receipt Repair Test'),
  ((SELECT denied_actor FROM _receipt_repair_ids), 'Receipt Repair Denied', 'Receipt Repair Test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ((SELECT actor FROM _receipt_repair_ids), 'accountant'),
  ((SELECT denied_actor FROM _receipt_repair_ids), 'student');
INSERT INTO public.permissions (module, action) VALUES ('finance', 'create') ON CONFLICT (module, action) DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'accountant', id FROM public.permissions WHERE module = 'finance' AND action = 'create'
ON CONFLICT DO NOTHING;

INSERT INTO public.leads (id, name, phone, stage, course_id, campus_id, application_id) VALUES
  ((SELECT lead FROM _receipt_repair_ids), 'Repair Student', '9999900001', 'admitted', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids), 'APP-REPAIR-TEST'),
  ((SELECT other_lead FROM _receipt_repair_ids), 'Repair Student', '9999900002', 'admitted', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids), NULL),
  ((SELECT no_course_lead FROM _receipt_repair_ids), 'Repair Student', '9999900003', 'admitted', NULL, (SELECT campus FROM _receipt_repair_ids), 'APP-COURSE-TEST');
INSERT INTO public.applications (application_id, lead_id, full_name, phone, course_selections) VALUES
  ('APP-REPAIR-TEST', (SELECT lead FROM _receipt_repair_ids), 'Repair Student', '9999900001', '[]'::jsonb),
  ('APP-COURSE-TEST', (SELECT no_course_lead FROM _receipt_repair_ids), 'Repair Student', '9999900003', jsonb_build_array(jsonb_build_object('course_id', (SELECT course FROM _receipt_repair_ids)::text, 'course_name', 'Repair Course')));
INSERT INTO public.students (id, lead_id, name, admission_no, course_id, campus_id) VALUES
  ((SELECT target_student FROM _receipt_repair_ids), (SELECT lead FROM _receipt_repair_ids), 'Repair Student', 'RPR-001', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids)),
  ((SELECT wrong_course_student FROM _receipt_repair_ids), NULL, 'Repair Student', 'RPR-002', (SELECT other_course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids)),
  ((SELECT wrong_campus_student FROM _receipt_repair_ids), NULL, 'Repair Student', 'RPO-001', (SELECT course FROM _receipt_repair_ids), (SELECT other_campus FROM _receipt_repair_ids)),
  ((SELECT corrected_student FROM _receipt_repair_ids), NULL, 'Repair Student', 'RPR-003', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids)),
  ((SELECT wrong_identity_student FROM _receipt_repair_ids), NULL, 'Unrelated Student', 'RPR-004', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids)),
  ((SELECT other_lead_student FROM _receipt_repair_ids), (SELECT other_lead FROM _receipt_repair_ids), 'Repair Student', 'RPR-005', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids)),
  ((SELECT second_lead_student FROM _receipt_repair_ids), (SELECT lead FROM _receipt_repair_ids), 'Repair Student', 'RPR-006', (SELECT course FROM _receipt_repair_ids), (SELECT campus FROM _receipt_repair_ids));

-- Keep the fixture insert from emitting local notification or ledger side effects.
ALTER TABLE public.lead_payments DISABLE TRIGGER USER;
INSERT INTO public.lead_payments (id, lead_id, type, amount, payment_mode, transaction_ref, receipt_no, status, payment_date, application_id)
VALUES
  ((SELECT payment FROM _receipt_repair_ids), (SELECT lead FROM _receipt_repair_ids), 'other', 500, 'upi', 'RPR-REF-001', 'N-RPR-001', 'confirmed', NULL, 'APP-REPAIR-TEST'),
  ((SELECT dated_payment FROM _receipt_repair_ids), (SELECT lead FROM _receipt_repair_ids), 'other', 250, 'upi', 'RPR-REF-002', 'N-RPR-002', 'confirmed', '2026-10-14T10:00:00Z', 'APP-REPAIR-TEST'),
  ((SELECT course_selection_payment FROM _receipt_repair_ids), (SELECT no_course_lead FROM _receipt_repair_ids), 'other', 100, 'upi', 'RPR-REF-003', 'N-RPR-003', 'confirmed', NULL, 'APP-COURSE-TEST'),
  ((SELECT allocated_payment FROM _receipt_repair_ids), (SELECT lead FROM _receipt_repair_ids), 'other', 75, 'upi', 'RPR-REF-004', 'N-RPR-004', 'confirmed', NULL, 'APP-REPAIR-TEST');
ALTER TABLE public.lead_payments ENABLE TRIGGER USER;

INSERT INTO public.fee_ledger (id, student_id, fee_code_id, term, total_amount, due_date)
VALUES ((SELECT fee_ledger FROM _receipt_repair_ids), (SELECT target_student FROM _receipt_repair_ids), (SELECT fee_code FROM _receipt_repair_ids), 'Repair Test', 75, '2026-11-01');
INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount)
VALUES ((SELECT fee_ledger FROM _receipt_repair_ids), (SELECT allocated_payment FROM _receipt_repair_ids), 75);

CREATE TEMP TABLE _before_payment AS
  SELECT to_jsonb(lp) - 'student_id' AS facts
    FROM public.lead_payments lp
   WHERE lp.id = (SELECT payment FROM _receipt_repair_ids);
CREATE TEMP TABLE _before_allocations AS
  SELECT count(*)::bigint AS allocation_count FROM public.fee_ledger_payments;
CREATE TEMP TABLE _before_operational_side_effects AS
SELECT
  (SELECT count(*)::bigint FROM public.notifications WHERE lead_id = (SELECT lead FROM _receipt_repair_ids)) AS notifications,
  (SELECT count(*)::bigint FROM public.consultant_payouts WHERE lead_id = (SELECT lead FROM _receipt_repair_ids)) AS payouts,
  (SELECT count(*)::bigint FROM public.incentive_ledger WHERE lead_id = (SELECT lead FROM _receipt_repair_ids)) AS incentives;

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lead_payments', 'UPDATE'),
  'authenticated browser sessions cannot directly update lead_payments'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT throws_ok(
  $$UPDATE public.lead_payments SET student_id = '00000000-0000-0000-0000-00000000f060' WHERE id = '00000000-0000-0000-0000-00000000f070'$$,
  '42501', NULL,
  'direct link update is denied even when an audit-reason setting is supplied'
);
SELECT set_config('app.audit_reason', 'spoofed browser reason', true);
SELECT throws_ok(
  $$UPDATE public.lead_payments SET student_id = '00000000-0000-0000-0000-00000000f060' WHERE id = '00000000-0000-0000-0000-00000000f070'$$,
  '42501', NULL,
  'a caller cannot bypass the audited repair RPC by setting the reason GUC'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f060', NULL, 'APP-OTHER', 'Verified bank record')$$,
  '40001', NULL,
  'application identity is rechecked against the payment before repair'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f061', NULL, 'APP-REPAIR-TEST', 'Verified bank record')$$,
  '22023', NULL,
  'a target with a different course is rejected'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f065', NULL, 'APP-REPAIR-TEST', 'Verified bank record')$$,
  '22023', NULL,
  'a same-name target linked to another lead is rejected'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f072', '00000000-0000-0000-0000-00000000f061', NULL, 'APP-COURSE-TEST', 'Verified bank record')$$,
  '22023', NULL,
  'a null-course lead still enforces application-selected course ids'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f073', '00000000-0000-0000-0000-00000000f063', NULL, 'APP-REPAIR-TEST', 'Verified bank record')$$,
  '22023', NULL,
  'a receipt allocated to another student ledger cannot be relinked'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f064', NULL, 'APP-REPAIR-TEST', 'Verified bank record')$$,
  '22023', NULL,
  'an unlinked student whose name does not match the application is rejected'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f062', NULL, 'APP-REPAIR-TEST', 'Verified bank record')$$,
  '42501', NULL,
  'a target outside the actor assigned campuses is rejected'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f060', NULL, 'APP-REPAIR-TEST', 'short')$$,
  '22023', NULL,
  'repair requires a meaningful reason'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f002', true);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f060', NULL, 'APP-REPAIR-TEST', 'Verified original bank transaction')$$,
  '42501', NULL,
  'staff without finance:create cannot repair a receipt'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f001', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.repair_confirmed_lead_payment_student_link(
    '00000000-0000-0000-0000-00000000f070',
    '00000000-0000-0000-0000-00000000f060',
    NULL,
    'APP-REPAIR-TEST',
    'Verified original bank transaction'
  )->>'receipt_no',
  'N-RPR-001',
  'repair atomically links the existing confirmed receipt'
);
SELECT throws_ok(
  $$SELECT public.repair_confirmed_lead_payment_student_link('00000000-0000-0000-0000-00000000f070', '00000000-0000-0000-0000-00000000f060', NULL, 'APP-REPAIR-TEST', 'Retry stale repair')$$,
  '40001', NULL,
  'a second stale repair receives an optimistic conflict'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.v_all_payments WHERE id = '00000000-0000-0000-0000-00000000f070' AND source = 'lead'),
  1::bigint,
  'Finance can read the repaired receipt through the caller-scoped view'
);
SELECT is(
  public.repair_confirmed_lead_payment_student_link(
    '00000000-0000-0000-0000-00000000f070',
    '00000000-0000-0000-0000-00000000f063',
    '00000000-0000-0000-0000-00000000f060',
    'APP-REPAIR-TEST',
    'Corrected the verified student link'
  )->>'receipt_no',
  'N-RPR-001',
  'Finance can correct a prior link with another audited repair'
);
RESET ROLE;

SELECT is(
  (SELECT student_id FROM public.lead_payments WHERE id = (SELECT payment FROM _receipt_repair_ids)),
  (SELECT corrected_student FROM _receipt_repair_ids),
  'the original payment now points to the corrected verified student'
);
SELECT is(
  (SELECT reason FROM public.lead_payments_audit WHERE lead_payment_id = (SELECT payment FROM _receipt_repair_ids) AND action = 'UPDATE' AND before_row->>'student_id' IS NULL),
  'Verified original bank transaction',
  'the first repair audit row records the operator reason'
);
SELECT is(
  (SELECT reason FROM public.lead_payments_audit WHERE lead_payment_id = (SELECT payment FROM _receipt_repair_ids) AND action = 'UPDATE' AND before_row->>'student_id' = '00000000-0000-0000-0000-00000000f060'),
  'Corrected the verified student link',
  'the correction audit row records its own reason'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.lead_payments_audit WHERE lead_payment_id = (SELECT payment FROM _receipt_repair_ids) AND action = 'UPDATE'),
  2::bigint,
  'each student-link repair appends its own audit row'
);
SELECT is(
  (SELECT changed_fields FROM public.lead_payments_audit WHERE lead_payment_id = (SELECT payment FROM _receipt_repair_ids) AND action = 'UPDATE' AND before_row->>'student_id' = '00000000-0000-0000-0000-00000000f060'),
  ARRAY['student_id']::text[],
  'the audit row identifies student_id as the only repaired payment field'
);
SELECT is(
  (SELECT to_jsonb(lp) - 'student_id' FROM public.lead_payments lp WHERE lp.id = (SELECT payment FROM _receipt_repair_ids)),
  (SELECT facts FROM _before_payment),
  'receipt number, status, amount, date, reference, lead, and other payment facts remain unchanged'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.fee_ledger_payments),
  (SELECT allocation_count FROM _before_allocations),
  'repair does not apply or remove fee allocations'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.lead_payments WHERE transaction_ref = 'RPR-REF-001'),
  1::bigint,
  'repair does not create a second payment row'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.notifications WHERE lead_id = (SELECT lead FROM _receipt_repair_ids)),
  (SELECT notifications FROM _before_operational_side_effects),
  'repair does not create a payment notification'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.consultant_payouts WHERE lead_id = (SELECT lead FROM _receipt_repair_ids)),
  (SELECT payouts FROM _before_operational_side_effects),
  'repair does not create or recalculate consultant payouts'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.incentive_ledger WHERE lead_id = (SELECT lead FROM _receipt_repair_ids)),
  (SELECT incentives FROM _before_operational_side_effects),
  'repair does not accrue or reverse staff incentives'
);
SELECT is(
  (SELECT student_id FROM public.v_all_payments WHERE id = (SELECT payment FROM _receipt_repair_ids) AND source = 'lead'),
  (SELECT corrected_student FROM _receipt_repair_ids),
  'the shared confirmed-payment view resolves the same receipt to its student'
);
SELECT is(
  (SELECT id FROM public.v_all_payments WHERE lead_id = (SELECT lead FROM _receipt_repair_ids) AND source = 'lead' ORDER BY paid_at DESC NULLS LAST, id DESC LIMIT 1),
  (SELECT dated_payment FROM _receipt_repair_ids),
  'dated receipts remain ahead of null-date receipts in descending view order'
);
SELECT is(
  (SELECT count(*)::bigint FROM public.v_all_payments WHERE id = (SELECT dated_payment FROM _receipt_repair_ids) AND source = 'lead'),
  1::bigint,
  'the shared view emits one row per receipt when a lead has multiple linked students'
);
SELECT is(
  (SELECT student_id FROM public.v_all_payments WHERE id = (SELECT dated_payment FROM _receipt_repair_ids) AND source = 'lead'),
  NULL::uuid,
  'an unlinked receipt for a multi-student lead remains unassigned instead of being guessed'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f002', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::bigint FROM public.v_all_payments WHERE id = '00000000-0000-0000-0000-00000000f070' AND source = 'lead'),
  0::bigint,
  'a student without access to this receipt cannot read it through the shared view'
);
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

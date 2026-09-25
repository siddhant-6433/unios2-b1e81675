# HR module — deploy notes

Everything below is code-only and ships with the branch. The two things that
**cannot** be done from the repo are the Supabase Auth redirect allow-list and
the migration/edge deploy themselves.

## 1. Migrations

Apply through the normal pipeline (do **not** hand-push):

```bash
npm run db:migrations:apply     # on main
```

The HR work is ~15 migrations, all with real, unique timestamps (the pre-commit
hook restamps new ones). They are safe to run in order; most are additive /
defensive (`IF NOT EXISTS`, guarded `DO` blocks).

Notable ones (newest first): `hr_cleanup_hygiene`, `hr_expense_approval_workflow`,
`hr_reporting_structure`, `hr_engagement_helpdesk`, `hr_performance_management`,
`hr_expenses_reimbursements`, `hr_comp_off`, `hr_leave_encashment`,
`hr_custom_fields`, `hr_payroll_payslips_adjustments`, `hr_interview_feedback`,
`hr_assets_and_org`, `hr_attendance_automation_cron`, `hr_leave_engine_completion`,
`hr_security_hardening`, `hr_schema_drift_locations`.

## 2. Edge functions

Deploy the new functions; the rest already exist.

```bash
supabase functions deploy zoho-expense-bill-sync   # expense → Zoho vendor bill
supabase functions deploy hiring-notify            # candidate emails (uses send-email/Resend)
supabase functions deploy apply-job                # public careers intake (verify_jwt off)
```

- `zoho-expense-bill-sync` reuses `_shared/zoho.ts` and the `ZOHO_*` secrets.
- `hiring-notify` uses the seeded `hiring-acknowledgement|interview-invite|offer|regret`
  email templates via the existing `send-email` function (needs `RESEND_API_KEY`, already set).
- `apply-job` is public (`verify_jwt = false`, added to `supabase/config.toml`) and needs the
  existing `R2_*` secrets to store resumes. It creates `job_applicants` with the service role,
  so no anon INSERT policy is required.

## 3. Zoho

- The Zoho company is already linked (secrets present).
- **No TDS** on employee reimbursements — the bill line carries the full claim amount.
- Optional: pin the expense account for reimbursement bills with
  `ZOHO_EXPENSE_ACCOUNT_ID` / `ZOHO_EXPENSE_ACCOUNT_NAME`. If unset it falls back
  to `ZOHO_PAYOUT_ACCOUNT_ID` / `_NAME`, then to `zohoResolveExpenseAccount()`.
- Employees are created/matched as **one Zoho vendor each** (`employee_profiles.zoho_vendor_id`).
  Bank details come from `employee_bank_details` and are pushed to the vendor on
  first bill (`zohoAddVendorBankAccount`), so **set each employee's bank details
  before their first claim is synced**.
- Proof files must be publicly fetchable by the function (they are: S3
  `unios-selfies` on mobile, R2 on web). It attaches them to the Zoho bill.

## 4. Supabase Auth — redirect URLs (needed for mobile/web Google sign-in)

Mobile web (and the Expo web preview) now signs in **in the same window** with
`redirectTo = window.location.origin`. Add these to
**Authentication → URL Configuration → Redirect URLs**:

- `http://localhost:8090` (local Expo web)
- the production staff web origin (e.g. `https://uni.nimt.ac.in`)
- the native scheme targets: `unios://` (family app) and `uniosstaff://` (staff app)

Without this, Google returns `redirect not allowed`.

## 5. Post-deploy verification

1. **Team structure:** set a reporting manager on `/hr-team`; the employee's
   profile shows “Reports to”.
2. **Expense proof:** submit without a proof → blocked; with a proof → L1 gets a
   notification.
3. **Two-stage:** L1 approves → super admin sees it in “Final approval” →
   approves → “Send to Zoho” creates the bill; the Zoho badge appears.
4. **Reimbursement:** mark reimbursed via payroll **and** via Zoho (records a
   vendor payment).
5. **Attendance:** approve a regularisation on a multi-punch day and confirm the
   first-in / last-out correction (`employee_attendance_daily`).
6. **Depreciation:** `/hr-assets` shows cost vs. book value.
7. **Org chart / interview feedback / payslips / comp-off / encashment / custom
   fields** render and their RPCs respond.

## 6. Mobile

No native config change this round, so no rebuild is required. In the dev
workflow: `cd mobile && APP_VARIANT=staff EXPO_PUBLIC_APP_VARIANT=staff npx expo start --web`.

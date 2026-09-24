# Expense Claims — Approval Workflow Plan

Status: **Plan for approval**
Goal: turn the HR expense claim into a proof-backed, two-stage approval that ends in a Zoho Books vendor bill — mirroring the video-portal approval + Zoho bill flow.

---

## 1. Where we are today

`public.expense_claims` (shipped in `hr_expenses_reimbursements`):

| column | notes |
|---|---|
| id, employee_profile_id, submitted_by | who claimed |
| category_id, title, amount, currency, expense_date, description | the claim |
| `receipt_url` | **optional**, single file, never enforced |
| `status` | `draft → submitted → approved → reimbursed` (+ `rejected`, `cancelled`) — **one approval only** |
| decided_by / decided_at / decision_note | single decider |
| reimbursed_at, payroll_cycle_id | paid via payroll |
| — | **no** Zoho linkage |

RPCs today: `decide_expense_claim(_claim_id,_approve,_note)`, `mark_expense_reimbursed`, `expense_reimbursement_totals`, `hr_expense_summary`. Permission: `hr:expenses_approve` (super_admin, campus_admin, principal, hr_executive). `expense_claim_audit` is an append-only log written by a trigger.

**Reference flow — video portal + vendor bills**
- `videos.video_status`: `pending_approval → approved → published`, ↘ `rejected` (edit/resubmit returns to `pending_approval`), with `rejection_reason`, `approved_by/at`. UI: `src/pages/VideoApprovals.tsx`.
- `video_bills`: `draft → approved → paid`, plus Zoho refs (`zoho_bill_id`, `zoho_bill_number`, `zoho_payment_id`, `zoho_synced_at`, `zoho_sync_error`).
- `supabase/functions/zoho-video-bill-sync`: `create_bill` (ensure vendor → create Bill → store ids) and `record_payment`. Shared helpers in `supabase/functions/_shared/zoho.ts` (`zohoApi`, `zohoResolveExpenseAccount`, `zohoFindVendorByPhone`, `zohoAttach`).

---

## 2. Target workflow

```
draft ──submit──▶ submitted ──L1 approve──▶ pending_superadmin ──L2 approve──▶ approved ──sync──▶ synced_to_zoho ──pay──▶ reimbursed
                     │                              │
                     ├─ send_for_correction ◀────────┤         (either level, with a note)
                     │        │
                     │        └──employee resubmits──▶ submitted
                     └─ reject (terminal, either level, with a reason)
```

| Status | Meaning | Who acts next |
|---|---|---|
| `draft` | employee still editing | employee |
| `submitted` | with L1 (reporting manager / principal) | L1 |
| `changes_requested` | sent back for correction, with note | employee (edit → resubmit) |
| `pending_superadmin` | L1 approved | super_admin |
| `approved` | L2 approved, ready to bill | super_admin / system |
| `synced_to_zoho` | Zoho Bill created (bill id stored) | finance (pay) |
| `reimbursed` | paid (Zoho vendor payment recorded) | — |
| `rejected` | terminal | — |
| `cancelled` | employee withdrew | — |

**Actions per actor**
- **L1 (team lead / principal):** `Approve`, `Send for correction` (note), `Reject` (reason).
- **L2 (super_admin):** `Approve & send to Zoho`, `Send for correction` (note), `Reject` (reason). (Send-to-Zoho can be automatic on approve, with a manual retry button.)
- **Employee:** `Save draft`, `Submit`, edit + `Resubmit` when `changes_requested`, `Cancel`.

---

## 3. Data model changes

New migration `hr_expense_approval_workflow`:

1. **Status set** — replace the CHECK on `expense_claims.status` with:
   `('draft','submitted','changes_requested','pending_superadmin','approved','synced_to_zoho','reimbursed','rejected','cancelled')` (keep old values valid for existing rows).
2. **Stage columns** (mirror video portal):
   - `submitted_at timestamptz`
   - `l1_reviewer uuid`, `l1_status text` (`pending|approved|changes_requested|rejected`), `l1_at`, `l1_note`
   - `l2_reviewer uuid`, `l2_status`, `l2_at`, `l2_note`
   - `correction_note text`, `correction_requested_by uuid`, `correction_at`
   - `rejection_reason text`, `rejected_by uuid`, `rejected_at`
3. **Proof attachments** — new `expense_claim_attachments` (id, claim_id, file_url, file_path, file_name, mime_type, file_size, uploaded_by, uploaded_at). Keep `receipt_url` as the "primary proof" for backward compatibility. Attachments are append-only; employee may add while `draft/changes_requested`, HR never mutates.
4. **Zoho refs** (mirror `video_bills`):
   - `zoho_bill_id`, `zoho_bill_number`, `zoho_payment_id`, `zoho_synced_at`, `zoho_sync_error`.
   - `employee_profiles.zoho_vendor_id text` (the employee as a Zoho vendor), mirroring `video_editors.zoho_vendor_id`.
5. **Audit** — extend `expense_claim_audit` actions (`submitted`, `l1_approved`, `changes_requested`, `l1_rejected`, `l2_approved`, `l2_rejected`, `zoho_synced`, `zoho_sync_failed`, `reimbursed`). Add a `stage` column for filtering.

Indexes: `(status, created_at desc)` partial per stage; `(employee_profile_id, status)`.

---

## 4. Proof of expense — mandatory attach

- Upload path: reuse the existing uploader — mobile `s3-upload` (camera/gallery), web `r2-upload`. Store `file_path`/`file_url`; attach to the claim.
- **Enforcement (server-side, not just UI):** a `BEFORE UPDATE`/`BEFORE INSERT` trigger (or `submit_expense_claim` RPC) that raises unless `receipt_url IS NOT NULL OR EXISTS(attachment)` when the category's `requires_receipt` is true (default true; "Other" can be flagged as not required).
- UI: “Attach proof (required)” with camera / gallery / file picker, multi-file, thumbnails, and a clear error if missing on submit. Drafts may be saved without proof; **submit** requires it.
- Zoho: pass the primary proof (and any extras) as bill attachments via `zohoAttach`.

---

## 5. RPCs

Replace `decide_expense_claim` with a small explicit state machine (each `SECURITY DEFINER`, permission-checked, append-only audit + notification):

| RPC | Caller | Effect |
|---|---|---|
| `submit_expense_claim(_id)` | owner | validates proof; `draft/changes_requested → submitted`; clears old review notes; sets `submitted_at`; notifies L1 |
| `l1_decide_expense(_id, _action, _note)` | L1 (`hr:expenses_approve` + is the employee's manager/principal) | `approved → pending_superadmin`; `changes_requested →` employee; `rejected → rejected`; notifies employee + super admins |
| `l2_decide_expense(_id, _action, _note)` | super_admin | `approved` (then Zoho sync); `changes_requested`; `rejected`; notifies |
| `sync_expense_to_zoho(_id)` | super_admin / service_role | invokes `zoho-expense-bill-sync create_bill`; `approved → synced_to_zoho`; stores ids or `zoho_sync_error` |
| `mark_expense_reimbursed(_id, _cycle_id)` | payroll | `synced_to_zoho → reimbursed`; records `record_payment` in Zoho |
| `expense_claim_attachments` insert | owner | while draft/changes_requested |

`l1_decide_expense` derives L1 as the employee's reporting manager (`employee_profiles.reports_to`) with a fallback to a role-based approver (`principal` / `campus_admin` for the campus, else any `hr:expenses_approve` holder) — see open questions.

Keep `hr_expense_summary` and add stage-aware counts for the review queue.

---

## 6. RLS / permissions

- `expense_claims`: employee sees their own; L1 sees claims where they are the reviewer OR `hr:expenses_approve`; super_admin sees all. Writes only via the RPCs (revoke direct UPDATE except while `draft/changes_requested` by the owner).
- `expense_claim_attachments`: owner (draft/changes_requested) + reviewers read.
- New permission `hr:expenses_final_approve` → super_admin only (keeps L1 (`hr:expenses_approve`) distinct from L2).
- Reuse `hr:payroll_run` for reimbursement marking.

---

## 7. Zoho integration

New edge function `zoho-expense-bill-sync` (clone of `zoho-video-bill-sync`, staff auth, super_admin/service_role):

- `create_bill`: ensure the employee is a Zoho **vendor** (match by phone/email via `zohoFindVendorByPhone`, else create; store `employee_profiles.zoho_vendor_id`); create a Bill under the configured expense account (`zohoResolveExpenseAccount`); attach the proof (`zohoAttach`); store `zoho_bill_id`/`zoho_bill_number`.
- `record_payment`: create a Vendor Payment when the claim is marked reimbursed.
- `retry`/`relink`: for `zoho_sync_error` (mirror `VideoBills.tsx` relink).
- Secrets: existing `ZOHO_*` (already used by the video/consultant syncs).

Line item: description = title + category + employee name + `expense_date`; amount = claim amount.

---

## 8. Notifications

Reuse `notifications` (`expense_submitted`, `expense_decided` already allowed; add `expense_correction_requested`, `expense_pending_final`, `expense_synced`, `expense_sync_failed`). Links: `/hr-expenses` for approvers, `/my-hr` (web) / mobile Me tab for the employee.

---

## 9. UI changes

**Mobile (`mobile/`)**
- `expenses.tsx`: mandatory “Attach proof” on the new-claim form (camera/gallery + upload); status timeline; when `changes_requested`, show the note and a **Resubmit** action; when `rejected`, show the reason.
- Me tab HR → Expenses already routes here.

**Web HR (`ExpenseReviewPanel.tsx`, `/hr-expenses`)**
- Queue split by stage: “With me (L1)” / “Final approval (L2)” / “Sent to Zoho” / “Reimbursed” / “Rejected”.
- Row actions: **Approve**, **Send for correction** (note dialog), **Reject** (reason dialog) — for L1 and L2 as appropriate; **Send to Zoho** / **Retry** for super_admin; **Mark reimbursed** for payroll.
- Claim detail drawer: proof preview (image/PDF), stage history from `expense_claim_audit`, Zoho badge (bill number / sync error).
- `MyExpensesPanel.tsx` (self): show the correction note and a Resubmit button.

Video-portal parity: the same three verbs (approve / send for correction / reject) the portal uses, and the same Zoho bill badge/relink UX.

---

## 10. Rollout

1. Migration `hr_expense_approval_workflow` (statuses, stage columns, attachments, Zoho refs, new permission, RPCs, RLS, notifications).
2. Edge function `zoho-expense-bill-sync`.
3. Web `ExpenseReviewPanel` + `MyExpensesPanel` updates.
4. Mobile `expenses.tsx` proof + resubmit.
5. Backfill: existing `approved` claims → `synced_to_zoho` if they should be billed; otherwise leave as-is and document.

## 11. Test plan

- Unit: the state machine (pure helper `src/lib/expenseWorkflow.ts`) — every action from every status, invalid transitions rejected.
- Guard/migration tests: new RPCs exist, permission gating, attachments table, mandatory-proof trigger, Zoho refs columns (pattern of `hr-phase*-guardrails`).
- RLS: employee cannot self-approve; L1 cannot do L2; only super_admin approves final.
- E2E (web): submit without proof → blocked; with proof → L1 approve → L2 approve → Zoho bill created (test org) → mark reimbursed.
- Mobile: attach proof + resubmit after correction.

## 12. Open questions (need product decisions)

1. **Who is “team lead”?** Use `employee_profiles.reports_to` (per-employee manager) or role-based (`principal` / `campus_admin` per campus)? Or both (manager first, escalate to principal)?
2. **Threshold routing** — must *every* claim go to superadmin, or only above ₹X (small claims approved by L1 only)?
3. **Zoho vendor per employee** — one vendor per employee (recommended) or reuse a generic “Staff Reimbursements” vendor?
4. **Tax/accounting** — which Zoho expense account / COA, GST/TDS treatment, and whether advances already recovered should net off the bill.
5. **Reimbursement path** — via payroll (current `mark_expense_reimbursed`) or a direct Zoho payment only?
6. **Multiple proofs** — is one receipt enough, or do we need multi-file + a specific “proof type” (bill/invoice/photo)?

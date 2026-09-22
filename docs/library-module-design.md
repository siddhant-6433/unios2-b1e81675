# UniOs Library module — design & finalisation

_Companion to `docs/library-software-analysis.md`. Branch: `library-module`._

## 1. Executive summary

The library module is sound in concept — bib/copy split, reviewed digitization queue,
accessioning, circulation rules, authority control, enrichment — but it was **not
usable in production** because of two structural defects:

1. **The librarian role had no capabilities by itself.** Every branch-scoped RLS policy
   consulted `library_staff_assignments`, and production had **zero** assignments, so
   the one librarian could not see or do anything.
2. **The digitization queue was client-fetched with `.limit(200)`** while production had
   **8,207** staged rows, and approval was strictly one record at a time.

The result: 8,206 imported books sat in `needs_review`, only **1** was ever approved,
and the librarian saw "no books, no imports".

This branch fixes the access model, adds set-based accession approval with duplicate
handling, pages/filters the queue on the server, gives each stakeholder a fit-for-purpose
view, and documents the target design.

## 2. Diagnosis (production evidence)

Read-only queries against `deylhigsisuexszsmypq`:

| Table | Count | Note |
|---|---|---|
| `library_branches` | 4 | Law, Nursing, Management (Greater Noida) + Learning Resource Center (Ghaziabad) |
| `library_digitization_records` | **8,207** | 8,206 `needs_review`, 1 `approved` |
| `library_digitization_batches` | 7 | Nursing imported **twice** (two 2,781-row batches) |
| `library_books` / `library_items` | **1 / 1** | approval at scale never happened |
| `library_staff_assignments` | **0** | root cause of invisibility |
| `library_members` / `library_loans` | 0 / 0 | circulation never started |
| `library_settings` | 1 | only Nursing; three branches relied on code defaults |

Helper probe for the librarian (`lalit.kumar@nimt.ac.in`, Greater Noida campus):

```
library_user_has_any_assignment(uid,'digitize') = false
library_user_has_any_assignment(uid,'catalog')  = false
library_user_has_any_assignment(uid,'view')     = false
```

`library_digitization_records` SELECT required `..._can_access_branch(uid, branch, 'digitize')`
→ **0 rows visible**. The client additionally set `assignmentScopedUser = true` for any
librarian, which emptied `selectableBranches` → the catalog was empty too.

The Nursing double-import left **5,561 rows for 2,781 distinct accessions** — 2,780
duplicates that would each fail approval with *"Accession number already exists"*.

## 3. Personas and jobs to be done

| Persona | Job to be done | Success looks like |
|---|---|---|
| **Super admin** | Configure libraries, enrichment, roles; trust the data. | Sees every branch, every setting, can run/repair anything. |
| **Principal / campus admin** | Oversight: is the library healthy, is the register complete? | Campus-wide dashboard, queue and circulation visibility, reports — read-mostly. |
| **Librarian** | Run the library: import registers, approve, catalog, issue/return, fine, inventory. | Every action works the day the account exists, scoped to their campus. |
| **Faculty** | Find a title, borrow, hold, know what I have out. | Catalog search + my loans + holds, no staff console. |
| **Student** | Find a title, know availability, borrow, avoid fines. | Catalog search + my loans + holds (+ fine status), mobile-first. |
| **Parent** | Understand the child's library position. | Phase 2. |

## 4. Target permission model

### 4.1 Principle

- **Role grants a baseline, assignments refine it.**
- `librarian` is a *first-class role*: by default it operates every branch on the user's
  **campus** (`profiles.campus`).
- An **explicit `library_staff_assignments` row overrides the baseline** — this preserves
  the ability to restrict (e.g. an `auditor` with `can_digitize = false`) or to grant
  cross-campus access.

This is implemented in SQL by `library_user_has_explicit_assignment`, consulted by both
`library_user_can_access_branch` and `library_user_has_any_assignment`.

### 4.2 Matrix (effective access)

| Capability | super_admin | principal / campus_admin | librarian (no assignment) | librarian (assigned) | faculty | student |
|---|---|---|---|---|---|---|
| View branches/settings | all | own campus | — | own branches | — | — |
| Browse catalog | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Add/edit books/items | ✓ | — | ✓ (campus) | per `can_catalog` | — | — |
| Issue / return | ✓ | — | ✓ (campus) | per `can_circulate` | — | — |
| Inventory | ✓ | — | ✓ (campus) | per `can_inventory` | — | — |
| Digitization queue *write* | ✓ | — | ✓ (campus) | per `can_digitize` | — | — |
| Digitization queue *read* | ✓ | ✓ (oversight) | ✓ | per flags / `manager` | — | — |
| Approve to catalog (accession) | ✓ | — | ✓ | `can_catalog` or `can_manage_settings` | — | — |
| Manage settings / staff | ✓ | ✓ (own campus) | — | per `can_manage_settings` / `manager` | — | — |
| Reports / export | ✓ | ✓ | ✓ | per flags | — | — |
| Place hold / see own loans | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **Approval is branch-scoped and requires `catalog`.** Principals intentionally get
> read oversight of the queue but not write approval; the librarian owns accessioning.

## 5. Information architecture

### 5.1 Staff console (super admin / campus admin / librarian / principal)

Tabs are **only rendered when the role can use them** (`tabVisibility`):

| Tab | Visible to | Purpose |
|---|---|---|
| Dashboard | all staff | Loans, overdue, due today, pending approvals, catalog size, lost/damaged |
| Catalog | all staff (+ patrons) | Add book+copy; search copies |
| Issue / Return | `circulate` | Issue by admission no., return, active loans |
| Inventory | `inventory` | Shelf audit (status/shelf/rack) + catalog search |
| Digitization | `digitize`/oversight | Capture, Excel/CSV import, labels, **paged review queue**, bulk approve |
| Authors / Publishers | `catalog` | Authority merge/rename |
| Members | `circulate`/settings | Patron list |
| Reports | `export` | Overdue, lost/damaged, catalog CSV |
| Settings | `manage_settings` | Enrichment cron, libraries, loan rules, served institutions, borrowing access, librarians |

### 5.2 Patron view (faculty / teacher / student)

`isPatronOnly` (only `library:view`) renders `PatronLibrary` instead of the console:
catalog search grouped by title with availability, a working **Hold** button, **My Loans**,
and **My Holds**. The student mobile screen already provides scanner-free discovery.

## 6. Core flows

### 6.1 Legacy register import → catalog (the critical path)

```
Excel/CSV  ─▶  parse + header detect + forward-fill
           ─▶  server duplicate gate (library_existing_accessions)
           ─▶  create batch + staging rows (needs_review | matched | duplicate)
           ─▶  enrich (Google Books / Open Library) + cover capture
           ─▶  review queue (paged, searchable, status/enrichment filters)
           ─▶  Flag duplicates (library_mark_duplicate_accessions)
           ─▶  Bulk approve (library_bulk_approve_digitization, batches of 100)
                 └─ per row: resolve/insert book → sync authors/publisher
                             → mint/keep accession → insert library_items
                             → record status=approved, approved_item_id
           ─▶  catalog copies + printable Code‑39 labels
```

Guarantees:
- Nothing enters the catalog without review/approval.
- Accession number comes from the register if present, else generated per institution.
- Re-importing the same register is caught server-side (no repeat of the Nursing case).
- Intra-institution duplicate accessions are flagged `duplicate`, not silently approved.
- Each row is atomic; a failure is recorded in `notes` and skipped, never aborts the batch.

### 6.2 Circulation
Issue by admission no. → validate member active, course enabled for the branch, no unpaid
dues, under borrowing limit → set item `issued`, due date from `library_settings`.
Return → mark returned, assess overdue fine → post to `fee_ledger` (`LIB-FINE`).

### 6.3 Holds / self-service
`library_place_hold(book_id)` resolves or lazily creates the caller's `library_members`
row (student link when possible, else staff/faculty from profile), then creates/reuses an
`active` hold. Staff fulfil holds on the circulation desk (phase 2: auto-ready on return).

## 7. Data model (effective)

Core (unchanged): `library_branches`, `library_books`, `library_items`, `library_members`,
`library_loans`, `library_holds`, `library_fines`, `library_digitization_batches`,
`library_digitization_records`, `library_audit_events`, `library_settings`,
`library_staff_assignments`, `library_branch_courses`, `library_branch_institutions`,
`library_authors` / `library_book_authors`, `library_publishers`.

New in this branch (`20260922171823_library_librarian_access_and_bulk_approval.sql`):

| Object | Purpose |
|---|---|
| `library_user_has_explicit_assignment(uuid)` | Role-baseline vs assignment-override switch |
| `library_can_view_digitization(uuid, uuid)` | digitize capability OR principal/campus-admin oversight |
| `library_digitization_summary(uuid[])` | Server-side counts by status + enrichment |
| `library_list_digitization_records(uuid[], text[], text, text, int, int)` | Paged, filtered, searched queue |
| `library_existing_accessions(uuid, text[])` | Import-time duplicate gate |
| `library_mark_duplicate_accessions(uuid[])` | Flag intra-institution repeats + already-catalogued |
| `library_bulk_approve_digitization(uuid[], uuid[], uuid, int)` | Batched approval minting accessions |
| `library_delete_digitization_batch(uuid)` | Remove a mistaken import batch |
| `library_place_hold(uuid)` | Patron hold with lazy member resolution |
| Settings backfill + accession index | Loan rules for legacy branches; faster dedupe |

Rewritten: `library_user_can_access_branch`, `library_user_has_any_assignment`, and the
digitization SELECT policies (adding principal oversight).

## 8. Delivery in this branch

**Database** — one migration, `20260922171823_library_librarian_access_and_bulk_approval.sql`:
role baseline + assignment override, principal oversight, paged queue + summary, import
duplicate gate, duplicate marking, bulk approval, batch delete, patron holds, settings
backfill, index.

**Frontend** — `src/pages/Library.tsx`:
- Librarian scoping only applies when they hold explicit assignments.
- Digitization queue is server-paged/searched/filtered; dashboard pending count comes
  from the summary, so 8,000+ rows are visible and actionable.
- **Flag duplicates** and **Approve all pending / Approve selected** with live progress.
- Import pre-checks existing accessions against the server.
- Tab visibility per role; `PatronLibrary` for faculty/students (catalog + holds + loans).
- Load failures surface an inline error with retry instead of a blank page.

**Tests** — `src/test/library-module.test.ts` extended (13 tests) to assert the role
baseline, bulk approval, duplicate handling, paged queue, and patron view.

## 9. Roll-out and data remediation runbook

Code/migrations are shipped by CI; **no production writes were made from this branch.**
Because production is stuck, the operator should, after deploy, run the following in
order (librarian or super admin session; idempotent):

1. **Confirm access** — as the librarian, open `/library?tab=digitization`. The queue
   should now populate (Law ≈ 2,645; Nursing ≈ 5,561).
2. **Clean duplicates**:
   `select library_mark_duplicate_accessions(array(select id from library_branches));`
   Expect ≈ 2,780 flagged on Nursing. Verify:
   `select branch_id, status, count(*) from library_digitization_records group by 1,2;`
3. **Approve Law first** (clean register): in the UI select the Law library and press
   *Approve all pending*, or
   `select * from library_bulk_approve_digitization(null, array['<law-branch>'], null, 100);`
   Repeat until `remaining = 0`.
4. **Approve Nursing**, then spot-check accessions:
   `select count(*) from library_items;` and search a known accession in Catalog.
5. **Optional cleanup**: delete the empty/duplicate batches with
   `library_delete_digitization_batch('<batch-id>')` (already-approved rows are never deleted).
6. **Set rules** for Law/Management/LRC under Settings (backfill gives 14/3/0 defaults).

Acceptance criteria:

- The librarian can see and approve the full staged register without an assignment.
- Approved rows produce exactly one `library_items` row per unique accession.
- Re-importing a processed register flags every row duplicate (no catalog growth).
- Faculty/students can search the catalog and place a hold.
- Pending count on the dashboard matches `library_digitization_summary().pending`.

## 10. Phase 2 roadmap

1. Holds queue fulfilment (auto-ready on return, pickup slips, expiry).
2. Acquisition & utilisation reports; weeding/lost-register reports.
3. Serials/periodicals register and routing.
4. Z39.50/SRU copy cataloguing and MARC21 import/export.
5. Parent view of a child's loans/fines.
6. Fine payment self-service integrated with the fee ledger.
7. Scheduled stock verification cycles with variance reports.

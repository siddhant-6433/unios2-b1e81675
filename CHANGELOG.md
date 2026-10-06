# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0.1] - 2026-10-06

### Fixed

- Keep the Admin Panel's Invite User dialog visible in the viewport when opening it from a scrolled page.

## [0.3.0.0] - 2026-10-05

### Added

- Preview, archive and roll back the old lead backlog while preserving applicants, students, payments and records needing review.
- Keep nursing/GNM with Ashish, engaged school leads with Payal and split Mirai leads evenly between Reema and Harsh Verma, transferring pending work together.
- Preserve archived prospects in a dated marketing list with cleanup reports and conflict-aware recovery.

### Changed

- Exclude archived leads from calling, pendency, reclaim, revival and automatic outreach; cancel pending follow-ups and scheduled WhatsApp sends while retaining history.
- Keep new prospects unassigned in Lead Buckets until explicitly allocated after cleanup starts.
- Deduplicate marketing audiences and recheck archived recipients for admission protection and opt-outs before sending.

## [0.2.5.0] - 2026-10-05

### Changed

- Show Admissions navigation and the Leads listing only to counsellors, super admins, principals, and admission heads, while retaining existing permissions for individual pages.
- Keep lead search, individual lead access, offline receipts, and existing refund permissions available to accountants and office admins, with lead return links and dashboard listing links pointing to Search.
- Hide Admissions follow-up counts from the Inbox badge when switching to a role without Admissions access.

## [0.2.4.0] - 2026-10-05

### Fixed

- Let campus-assigned staff see school fee receipts, receipt numbers, payment dates, and PDF links while preserving campus restrictions and principal institution/course access.

## [0.2.3.0] - 2026-10-05

### Added

- Serve Mirai Uni branding by hostname with a transparent logo, accessible green theme, and existing account and role access.
- Route saved applications and generate admissions, payment and student invitation links from institution ownership, preserving existing NIMT and Beacon routes.
- Add 20 Mirai lifecycle WhatsApp templates with exact sender isolation, approval checks and staff-visible delivery failures.
- Add rollout gates and a deployment checklist; Mirai activation remains disabled until provider checks, template approvals and controlled delivery pass.

## [0.2.2.1] - 2026-10-04

### Added

- Send the approved Hindi and English DPharma 2026–28 last-chance admission notice to JEECUP candidates from the WhatsApp template picker, with college code 1268 and admission contact numbers.

## [0.2.1.0] - 2026-10-04

### Fixed

- Find students beyond the first 500 records while preserving academic filters, campus access, and contact restrictions.
- Let principals read fee ledgers and school receipts within their assigned scope, and assign Jai Gopal Jindal to Avantika II school only.
- Show fee and receipt loading failures with retry, and clear previous financial data when switching students.

## [0.2.0.0] - 2026-10-04

### Added

- Create live lists of all consultants or academic partners for repeat WhatsApp and email communications, with recipient previews and eligibility counts.

### Fixed

- Preserve recipient identities and contact details in scheduled campaigns and failed-send retries, including retries with more than 1,000 failed recipients.

## [0.1.1.0] - 2026-10-02

### Changed

- Use a full-width, step-by-step inbox on phones so categories, queue items, and their details are easier to navigate.

## [0.1.0.0] - 2026-10-01

### Added

- Add lead-level refunds across eligible receipts, with partial amounts, finance approval and payout, and Zoho sync.

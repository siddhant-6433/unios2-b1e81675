# Changelog

All notable changes to this project will be documented in this file.

## [0.7.0.0] - 2026-10-10

### Fixed

- Restrict application-fee repair audits to assigned campuses, preserve repair snapshots when a student is deleted, and archive duplicate receipt allocations when consolidating ledger heads.

## [0.6.2.0] - 2026-10-10

### Changed

- Keep reached leads with the counsellor who handled the call and remove them from pending call-list work while preserving list history.
- Retry unanswered, busy, and voicemail outcomes up to three consecutive attempts before parking the lead as Cold.
- Map wrong numbers to Cold and unavailable course requests to Course Not Available, recording the requested course name as plain text.
- Align call outcomes and stage updates across Cloud Dialer and lead call flows.

## [0.6.1.0] - 2026-10-09

### Added

- Record HR employee exits with notice dates, last working day, reason, notice waiver, and clearance notes.
- Document the HR hiring, onboarding, employee transfer, and production QA findings.

## [0.6.0.1] - 2026-10-09

### Fixed

- Find older receipts by receipt number, student name, or admission number in Finance, while honoring campus and payment mode filters.

## [0.6.0.0] - 2026-10-08

### Added

- Let families send Mirai admission enquiries and request a call or campus tour, with confirmation and admissions-team follow-up.
- Guide Mirai applicants through five stages, with Mirai-branded screens, saved progress and WhatsApp OTP delivery from Mirai with NIMT fallback.
- Show Mirai age guidance as of 31 July for the selected intake, and keep 2027–28 as the active Mirai session.
- Show Mirai application deadlines in six rolling rounds from October through March.

### Changed

- Adapt school application fields for nationality, address country, parent employment status and optional child email; remove redundant transport and instruction-medium preferences.

### Fixed

- Preserve Mirai parent, child, grade, intake and attribution details through lead ingestion, and calculate the Mirai application fee from its portal configuration.

## [0.5.0.0] - 2026-10-07

### Fixed

- Show D.Pharma Year 1 tuition as the regular college fee without an ABVMU deposit across finance, applicant, and student fee views.

## [0.4.0.1] - 2026-10-07

### Changed

- See course names for leads, students and applications in header search results.

## [0.4.0.0] - 2026-10-06

### Added

- Notify super admins when student or lead refund drafts are created, with a link that opens and highlights the refund in Finance.

## [0.3.0.2] - 2026-10-06

### Fixed

- Route Ghaziabad Campus 2 B.Ed and D.El.Ed applications to NIMT when stale Mirai branding is present.

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

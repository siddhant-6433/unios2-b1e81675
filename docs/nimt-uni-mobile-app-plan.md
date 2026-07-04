# NIMT Uni Mobile App Plan

Status: planning baseline  
Target app: `mobile/` Expo Router app  
Backend: existing UniOs Supabase project  
Primary users: students, parents, staff, faculty, counsellors, admins, security, hostel wardens

## Executive Summary

Build one Expo mobile app with two product surfaces:

1. Parent and student app: day-to-day campus life, fees, attendance, library, notices, profile, services, hostel, transport, and communication.
2. Staff app: role-specific operational workspaces for leadership, counsellors, faculty, accounts, office, library, security, hostel, HR, and support teams.

The existing `mobile/` app is the right foundation. It already has Expo Router, Supabase auth, secure token storage, role-gated tabs, library operations, staff dashboards, student fees, notices, profile, and attendance-oriented primitives. The next phase should harden identity resolution, define role-specific modules, and add missing operational workflows without creating a parallel app or backend.

## Product Principles

- One app, role-shaped experience: the same binary should route users into the correct experience after login.
- Mobile is for action, not full admin replacement: high-frequency approvals, search, attendance, communication, scans, receipts, and alerts belong on mobile; complex setup stays on web.
- Parent/student data must be scoped through canonical relationship tables, never inferred from `auth.users.id` alone.
- Staff data must follow the same access policy and RLS model as web.
- Offline-first only where it matters: attendance capture, gate passes, hostel rounds, library scanning, and pending form drafts.
- Every module should have a "today" view, an action queue, and a detail view.

## Existing Foundation

Current app capabilities in `mobile/`:

- Supabase auth with Google OAuth and WhatsApp OTP in `mobile/contexts/AuthContext.tsx`.
- Role-gated tab shell in `mobile/app/(tabs)/_layout.tsx`.
- Staff, student, and parent home cards in `mobile/app/(tabs)/index.tsx`.
- Staff workspaces for leadership, admissions, faculty, librarian, and generic employees in `mobile/app/(tabs)/work.tsx`.
- Fees, library, notices, profile, inbox, leave, HR, classes, team, punch, and student photo routes.
- Shared mobile design primitives in `mobile/components/ui/DashboardPrimitives.tsx`.
- Color, spacing, radius, and typography tokens in `mobile/constants/Colors.ts`.

Key architectural gap:

The app sometimes treats `auth.user.id` as a student id. That is unsafe. Student, parent, profile, and staff identities need a first-class resolution layer before expanding the product.

## Target Role Model

Roles should be grouped by product behavior, not only database enum labels.

| Surface | Roles | Primary Jobs |
| --- | --- | --- |
| Student | `student` | Attendance, fees, classes, library, notices, ID card, service requests, hostel, transport, documents |
| Parent | `parent` | Child switcher, fee payment, attendance, notices, transport, hostel, service requests, communication |
| Leadership | `super_admin`, `campus_admin`, `principal`, `admission_head` | Operating dashboard, approvals, campus metrics, escalations, search |
| Admissions | `admission_head`, `counsellor`, `data_entry` | Follow-ups, WhatsApp/calls, visits, applications, document status |
| Faculty | `faculty`, `teacher`, `ib_coordinator` | Classes, attendance, timetable, students, assignments, IB evidence |
| Finance | `accountant`, finance-capable admins | Fee dues, receipts, payment confirmation, concessions, reports |
| Office | `office_admin`, `office_assistant` | Certificates, documents, student service desk, ID cards |
| Library | `librarian`, `super_admin` | Scan, issue, return, digitize, audit, fines |
| Security | proposed `security` or scoped staff role | Gate pass, visitor log, bus/hostel movement, emergency contacts |
| Hostel | `hostel_warden` | Occupancy, attendance, leave, complaints, gate-out approvals |
| HR | admins and employees | Punch, leave, payslips, attendance, directory |

If adding `security` as a new role is too expensive for now, model security as an employee profile assignment with a permission such as `security_gate:operate`. Do not overload `hostel_warden`.

## Navigation Architecture

Keep the existing tab shell, but make tabs capability-driven.

```
Auth
 |
 +-- resolveMobileContext(auth.uid)
       |
       +-- role group
       +-- profile id
       +-- linked students
       +-- campus/institution scope
       +-- permissions
       +-- feature flags
       |
       v
  Tab shell
       |
       +-- Home / Me
       +-- Work or Classes
       +-- Inbox
       +-- Fees or Finance
       +-- Library
       +-- Notices
       +-- Profile
```

Recommended tab sets:

- Student: Home, Classes, Fees, Library, Profile.
- Parent: Home, Child, Fees, Notices, Profile.
- Faculty: Me, Classes, Work, Inbox, Profile.
- Admissions: Me, Inbox, Work, Leads, Profile.
- Leadership: Me, Work, Search, Inbox, Profile.
- Librarian: Me, Library, Work, Profile.
- Security: Gate, Visitors, Alerts, Profile.
- Hostel warden: Hostel, Students, Approvals, Alerts, Profile.

Keep hidden routes available for deep links, but tab visibility must be computed from capabilities.

## Core Mobile Context Contract

Create a single RPC or edge function used immediately after auth:

`mobile_context()`

Returns:

```ts
type MobileContext = {
  authUserId: string;
  profileId: string | null;
  displayName: string;
  role: AppRole;
  campusId: string | null;
  institutionId: string | null;
  employeeId: string | null;
  permissions: string[];
  linkedStudents: Array<{
    id: string;
    name: string;
    admissionNo: string | null;
    courseName: string | null;
    batchName: string | null;
    campusName: string | null;
    relationship: "self" | "father" | "mother" | "guardian" | "other";
  }>;
  activeStudentId: string | null;
};
```

Why this matters:

- Student routes need `students.id`, not `auth.users.id`.
- Parent routes need a child switcher and must support multiple children.
- Staff routes need `profiles.id` for admissions and team ownership.
- Library, hostel, security, and fees depend on campus/institution scope.
- Mobile tabs should be permission-backed instead of hard-coded role checks.

## Data Access Pattern

Use RLS for all direct Supabase reads. Use RPCs for workflows that need server-side transactionality, sensitive joins, or cross-table writes.

```
Mobile screen
 |
 +-- read model query or RPC
 |     |
 |     +-- RLS-filtered table/view
 |
 +-- command RPC / edge function
       |
       +-- validates role and scope
       +-- writes canonical tables
       +-- emits audit/event row
       +-- returns updated read model
```

Recommended read model RPCs:

- `mobile_context()`
- `mobile_student_home(_student_id uuid)`
- `mobile_parent_child_summary(_student_id uuid)`
- `mobile_staff_home()`
- `mobile_action_queue()`
- `mobile_fee_summary(_student_id uuid)`
- `mobile_class_day(_date date)`
- `mobile_hostel_dashboard()`
- `mobile_gate_dashboard()`

Recommended command RPCs/functions:

- `mobile_mark_class_attendance`
- `mobile_submit_service_request`
- `mobile_approve_service_request`
- `mobile_create_gate_pass`
- `mobile_record_gate_movement`
- `mobile_mark_hostel_roll_call`
- `mobile_confirm_fee_payment_intent`
- Existing library RPCs should remain the source of truth for issue/return.

## Module Plan

### Parent and Student

MVP modules:

- Home: attendance %, fee due, today timetable, latest notices, library due, pending requests.
- Fees: ledger summary, term-wise dues, receipt list, payment gateway launch, failed payment recovery.
- Attendance: day/month view, subject/class breakdown, absence reasons.
- Classes: timetable, teacher, room, joining link if online, assignments later.
- Library: active loans, due dates, holds, fines, catalog search.
- Notices: campus, course, batch, hostel, and fee notices.
- Profile: student details, parent contacts, documents, ID card.
- Services: certificates, bonafide, fee receipt, hostel complaint, transport request.

Parent-specific:

- Child switcher at top of Home and all child-scoped tabs.
- Fee payment for selected child.
- Attendance and leave visibility.
- Parent communication inbox.
- Gate pass approval for minor students where applicable.

Student-specific:

- Digital ID card.
- Self-service requests.
- Library holds and renewals.
- Hostel leave requests for boarders.

### Staff Home

All staff see:

- Punch status.
- Leave status.
- Notices.
- Personal inbox.
- Directory.
- Role workspace entry point.

Leadership sees:

- Staff present.
- Students present/absent.
- Fee dues.
- Admissions funnel.
- Pending approvals.
- Campus incidents.

Admissions sees:

- Follow-ups due.
- WhatsApp conversations needing reply.
- Visits today.
- Applications requiring action.
- New lead assignment status.

Faculty sees:

- Today classes.
- Mark attendance.
- Student list.
- Class notes.
- Pending academic actions.

Finance sees:

- Fee due queue.
- Payment verification.
- Receipt lookup.
- Concession approvals if allowed.

Office sees:

- Student document/service requests.
- Certificate queue.
- ID card/photo queue.
- Front desk search.

Library sees:

- Scanner-first issue/return/digitize/audit.
- Branch selector.
- Overdue queue.
- Fines.

Security sees:

- Gate scanner.
- Visitor entry/exit.
- Student movement pass.
- Staff/vehicle verification.
- Emergency alert list.

Hostel warden sees:

- Hostel roll call.
- Out-pass approvals.
- Room occupancy.
- Complaints.
- Fee/discipline alerts.

## Screen Inventory

| Route | Parent/Student | Staff |
| --- | --- | --- |
| `/login` | WhatsApp OTP, Google if allowed | Google, WhatsApp OTP |
| `/(tabs)/index` | Home summary | Me summary |
| `/(tabs)/work` | Hidden or services | Role workspace |
| `/(tabs)/classes` | Timetable | Teaching workspace |
| `/(tabs)/fees` | Ledger and payment | Finance queue if permissioned |
| `/(tabs)/library` | Loans/catalog | Scanner operations |
| `/(tabs)/notices` | Notices | Notices |
| `/(tabs)/inbox` | Communication | Approvals and conversations |
| `/(tabs)/profile` | Profile and ID | Profile |
| `/(tabs)/punch` | Hidden | Staff attendance |
| new `/gate` | Student pass status | Security gate ops |
| new `/hostel` | Hostel status | Warden ops |
| new `/services` | Requests | Service desk queue |

## Design Direction

The app should feel like serious campus operating software, not a marketing app.

Aesthetic:

- Quiet, utilitarian, high-trust.
- Dense enough for repeated staff work, but calm enough for parents.
- Use cards for individual records and actions only; avoid nesting cards.
- Keep role-specific color accents, but retain a shared UniOs identity.

Typography:

- Keep the current mobile token shape.
- Replace placeholder comments with actual Expo font loading before brand polish.
- Recommended: `Source Sans 3` or `DM Sans` for body, `Geist` or `IBM Plex Sans` for dense data, `JetBrains Mono` only for IDs/admission numbers/barcodes.

Color:

- Keep NIMT indigo `#0035C5` as primary.
- Use warm brown `#954919` sparingly as institutional accent.
- Use semantic tones for state: green success, amber warning, red destructive.
- Reduce pastel overuse in staff-heavy screens; action queues need clearer priority and contrast.

Layout:

- 4 to 5 tabs maximum per role.
- Primary action appears above the fold.
- Lists should have stable row height and clear right-side status.
- Detail screens use header, key status, primary actions, then activity/history.

Motion:

- Minimal functional motion only: loading, pull refresh, success confirmation, scanner transitions.
- No decorative animation in operational screens.

## Security and Privacy

Non-negotiables:

- No screen should rely on client-side role checks as the only boundary.
- All parent/student reads must verify the student relationship in SQL/RPC.
- All staff writes must record actor `auth.uid()` and resolved `profile.id`.
- Payment initiation and verification stay server-side.
- Gate, hostel, and attendance actions must have audit tables.
- Sensitive staff dashboards should use aggregate RPCs rather than broad client queries.
- Push notification payloads must not include sensitive fee, health, discipline, or personal details.

Threat model highlights:

- Parent viewing another child by changing `student_id`.
- Student spoofing attendance or gate movement.
- Counsellor seeing unassigned leads.
- Staff member querying campus data outside their scope.
- Lost phone with persisted session.
- Duplicate payment verification.

Mitigations:

- Relationship-backed RLS policies.
- RPC scope checks using `auth.uid()`.
- Device/session revocation support.
- Short-lived signed URLs for documents.
- Audit events for all operational writes.
- Idempotency keys for payments and scans.

## Offline and Realtime

Offline candidates:

- Class attendance draft.
- Hostel roll call draft.
- Gate pass scan queue.
- Library scan queue.
- Student service request draft.

Realtime candidates:

- Inbox unread counts.
- Action queue badge counts.
- Payment status updates.
- Gate/hostel emergency alerts.
- Admissions WhatsApp replies.

Do not make every table realtime. Prefer one `mobile_action_queue` payload per role.

## Push Notifications

Notification categories:

- Fees: due reminder, payment success/failure.
- Attendance: absence alert, low attendance.
- Notices: new notice by campus/course/batch.
- Admissions: new reply, follow-up due.
- Approvals: leave, gate pass, service request.
- Hostel/security: emergency and movement alerts.
- Library: due soon, overdue, hold ready.

Implementation:

- Add Expo push token registration table keyed to `auth.users.id` and device id.
- Store platform, app version, last seen, disabled status.
- Server functions should enqueue notifications from domain events, not from client screens.

## Build and Release

Distribution work is in scope because mobile code without distribution is not usable.

- Use EAS Build for iOS and Android.
- Environments: development, preview, production.
- Required env vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Use separate Supabase redirect URLs for Expo Go, dev build, and production scheme.
- Add smoke test checklist per release: login, context resolve, role tabs, fee read, library read, punch, sign out.
- Track app version in `mobile/app.json` and show it in Profile.

## Implementation Phases

### Phase 0: Architecture Hardening

- Add `mobile_context()` contract.
- Replace direct `auth.user.id` student assumptions.
- Add child switcher state.
- Move tab visibility to capability groups.
- Add typed mobile data access helpers.
- Add tests for role to tab mapping and identity resolution.

Exit criteria:

- Student and parent screens always use `activeStudentId`.
- Staff screens always use `profileId` for profile-owned records.
- No mobile screen fetches broad data without RLS or RPC scope.

### Phase 1: Parent/Student Complete MVP

- Home summary RPC.
- Fees with payment launch and receipt list.
- Attendance calendar.
- Timetable/classes.
- Library loans/catalog.
- Notices with filters.
- Profile and digital ID.
- Service requests.

Exit criteria:

- A parent with two children can switch children and see isolated data.
- A student can view fees, attendance, library, notices, and profile.
- Payment status refresh works after returning from gateway.

### Phase 2: Staff Operational MVP

- Staff action queue.
- Punch and leave flows.
- Admissions follow-up queue.
- Faculty class attendance.
- Finance fee due queue.
- Office service request queue.
- Library scanner polish.

Exit criteria:

- Every staff role lands on a useful workspace.
- High-frequency work can be done in under three taps from Home.
- Admin metrics are aggregated server-side.

### Phase 3: Security, Hostel, and Campus Ops

- Security role/capability.
- Visitor log.
- Gate pass scan and movement audit.
- Hostel roll call.
- Hostel leave/out-pass flow.
- Complaint/escalation queue.

Exit criteria:

- Gate and hostel workflows work with intermittent network.
- All movement writes are audited.
- Parent/student visibility is scoped to their own movements and approvals.

### Phase 4: Notifications and Realtime

- Device registration.
- Notification preferences.
- Domain event notification functions.
- Action queue realtime badges.
- Payment and approval status updates.

Exit criteria:

- Users receive only scoped notifications.
- No sensitive data leaks in push payloads.
- Badge counts match server source after app resume.

### Phase 5: Release Readiness

- EAS build profiles.
- App icon/splash finalization.
- Crash/error reporting decision.
- QA matrix across iOS, Android, web fallback if kept.
- Store listing assets and privacy notes.

Exit criteria:

- Preview build installable by NIMT testers.
- Production build has rollback plan.
- Auth redirects and deep links are verified.

## Test Plan

Unit tests:

- Role to capability mapping.
- Tab visibility.
- Active student selection.
- Fee summary formatting.
- Attendance percentage calculation.
- Library scanner value normalization.

Integration tests:

- `mobile_context()` for student, parent with one child, parent with multiple children, counsellor, faculty, librarian, hostel warden.
- Parent cannot request another student's fee summary.
- Student cannot request another student's attendance.
- Staff without permission cannot access finance/library/security RPCs.
- Payment initiation idempotency.

Manual QA:

```
Login matrix
 |
 +-- student
 +-- parent one child
 +-- parent multiple children
 +-- counsellor
 +-- faculty
 +-- accountant
 +-- librarian
 +-- hostel warden
 +-- security/campus ops
 +-- super admin
```

Critical paths:

- Login and logout.
- App resume after token refresh.
- Parent child switch.
- Fee payment return.
- Class attendance submit.
- Punch in/out.
- Library issue/return scan.
- Hostel roll call submit.
- Gate pass approve and scan.

Performance targets:

- Cold start to login screen under 2 seconds on mid-range Android.
- Authenticated home payload under 1 second after session restore.
- Action queue refresh under 800 ms on normal network.
- Scanner screens interactive immediately after camera permission.

## Open Decisions

- Add first-class `security` role, or model security through permissions on existing employee roles?
- Should parents use WhatsApp OTP only, or also Google/password where records have email?
- Should student app include assignment submission in v1, or only timetable and attendance?
- Which payment gateway is canonical for mobile student fees?
- Will the app support Expo web in production, or only native iOS/Android?
- Should mobile use TanStack Query, or keep small custom hooks for now?

## Opinionated Recommendation

Do not start by adding more screens. Start with `mobile_context()` and the identity model. Without that, the app will look complete but remain unsafe for parent/student and staff scoping.

The smallest high-quality path is:

1. Harden identity and role/capability resolution.
2. Complete parent/student MVP around one selected `activeStudentId`.
3. Expand staff modules by action queue, not by copying web pages.
4. Add security and hostel only after audit/event tables are designed.
5. Build EAS preview distribution before calling the app ready.

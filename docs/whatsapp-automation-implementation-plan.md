# WhatsApp Automation Implementation Plan

Date: 2026-06-05

Scope: integrated WhatsApp automated chat reply system across Meta and Plivo numbers, with CRM lead generation, AI qualification, counsellor/super-admin handoff, SLA tracking, and observability.

Out of scope for this document: course-wise USP copy. Course content will be handled separately and then plugged into the knowledge base.

## Goals

1. Every inbound WhatsApp message creates or links the correct CRM lead.
2. Replies always go out from the same WhatsApp number/provider that received the message.
3. AI handles simple admission questions and intake.
4. Counsellors take over when needed without fighting the bot.
5. Super admins/admission heads see unresolved, failed, or escalated conversations.
6. HR/vendor/non-admission messages are routed away from admissions automation.
7. The system is auditable: every decision, send, failure, and handoff is logged.

## Current Starting Point

Already present:

- Meta inbound webhook: `whatsapp-webhook`.
- Plivo inbound webhook for `9555192192`: `whatsapp-plivo-webhook`.
- AI admission reply function: `whatsapp-ai-reply`.
- Intent classifier: `wa-classify-message`.
- Manual reply function: `whatsapp-reply`.
- Template send function: `whatsapp-send`.
- WhatsApp inbox UI: `src/pages/WhatsAppInbox.tsx`.
- Message store: `whatsapp_messages`.
- Conversation view: `whatsapp_conversations`.
- AI/human switch: `whatsapp_ai_mode`.

Main gaps:

- Manual replies are not fully provider-aware for Plivo.
- Route configuration is env-var based and duplicated.
- Lead creation and reply decisions are duplicated across webhook functions.
- Handoff state is too thin.
- Observability is incomplete.
- Course knowledge is hardcoded in multiple places.

## Phase 1: Stabilize Current Production Flow

Purpose: make the current system reliable before deeper refactor.

### 1.1 Make Manual Replies Provider-Aware

Problem: `whatsapp-reply` currently sends through Meta only. A CRM reply to a Plivo conversation can use the wrong channel.

Change:

- Extend `whatsapp-reply` request body to accept:
  - `provider`
  - `business_phone_number_id`
  - `business_number`
- If `provider = plivo`, send via `sendPlivoWhatsAppText`.
- If `provider = meta`, send via Graph API using the requested Meta phone-number ID.
- If provider is not supplied, infer from the latest `whatsapp_messages` row for `(phone, business_phone_number_id)`.

Acceptance:

- Counsellor can reply from CRM to a `9555192192` conversation.
- Outbound row logs `provider = plivo`.
- Reply is logged under the same business number.
- Existing Meta replies continue working.

### 1.2 Pass Provider From Inbox

Problem: inbox currently passes business phone-number ID, not provider.

Change:

- Include `provider` in `whatsapp_conversations`.
- Fetch/display provider in `WhatsAppInbox`.
- Send `provider` and business number to `whatsapp-reply`.

Acceptance:

- CRM reply payload contains enough routing info for Meta and Plivo.

### 1.3 Route Health Check

Problem: route-specific code exists, but production may only have default Meta secrets configured.

Change:

- Add `whatsapp-route-health` edge function or admin panel diagnostic.
- Report:
  - route name
  - provider
  - token present
  - sender present
  - fallback status
  - last successful send
  - last failed send

Acceptance:

- Admin can see whether OTP/call/visit/bulk/reply routes are truly isolated.
- Health check flags routes falling back to default sender.

### 1.4 Add Critical Regression Tests

Add tests for:

- Meta inbound creates lead.
- Plivo inbound creates lead.
- Plivo manual reply uses Plivo.
- Meta manual reply uses Meta.
- AI mode `human` suppresses bot.
- DNC suppresses automation.
- Job/vendor classification suppresses admissions pitch.
- Numeric course selection updates CRM course.

## Phase 2: Centralize WhatsApp Channel Configuration

Purpose: stop spreading phone routing rules across edge functions.

### 2.1 Add `whatsapp_channels`

Suggested schema:

```sql
create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  provider text not null check (provider in ('meta', 'plivo')),
  route text not null,
  business_number text,
  meta_phone_number_id text,
  secret_token_name text,
  is_active boolean not null default true,
  allow_ai boolean not null default true,
  allow_manual_reply boolean not null default true,
  allow_bulk boolean not null default false,
  quality_risk_level text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Routes:

- `admissions`
- `reply`
- `otp`
- `call`
- `visit`
- `bulk`
- `hr`
- `plivo_admissions`

Acceptance:

- Every known WhatsApp sender has one database row.
- Functions can resolve channels by provider, phone-number ID, or business number.

### 2.2 Shared Send Adapter

Create shared module:

- `supabase/functions/_shared/whatsapp-channel.ts`

Responsibilities:

- Resolve channel.
- Fetch provider config.
- Send text.
- Send template.
- Log provider-normalized result.
- Return structured errors.

Acceptance:

- `whatsapp-reply`, `whatsapp-ai-reply`, `whatsapp-send`, and campaign sends use the same adapter.

## Phase 3: Conversation State and Handoff

Purpose: make AI/counsellor/super-admin collaboration explicit.

### 3.1 Replace Thin AI Mode With Conversation State

Keep `whatsapp_ai_mode` initially for compatibility, but introduce:

```sql
create table public.whatsapp_conversation_state (
  phone text not null,
  business_number text not null,
  provider text not null,
  lead_id uuid references public.leads(id),
  mode text not null default 'ai',
  state text not null default 'new_unqualified',
  owner_user_id uuid,
  escalation_role text,
  handoff_reason text,
  priority text not null default 'normal',
  sla_due_at timestamptz,
  last_intent text,
  last_confidence numeric,
  last_bot_action text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (phone, business_number)
);
```

Modes:

- `ai`
- `human`
- `paused`
- `closed`

States:

- `new_unqualified`
- `awaiting_name`
- `awaiting_course`
- `qualified`
- `answered_by_ai`
- `needs_counsellor`
- `human_active`
- `followup_scheduled`
- `not_interested`
- `dnc`
- `job_handoff`
- `vendor_handoff`
- `knowledge_gap`

Acceptance:

- Inbox shows AI/human mode, state, owner, and escalation reason.
- Bot reads this table before replying.

### 3.2 Handoff Rules

Escalate to counsellor when:

- Lead asks for callback.
- Lead asks for fees/scholarship/eligibility exception.
- Lead asks for visit.
- Lead sends document/media.
- Lead repeats the same unresolved question.
- AI confidence is low.
- Lead asks for human.

Escalate to admission head/super admin when:

- No counsellor assigned.
- SLA breached.
- Complaint/legal/refund issue.
- Knowledge gap remains unresolved.
- Message send fails repeatedly.

Escalate to HR/procurement when:

- Classifier marks job/vendor.
- HR number receives the message.

Acceptance:

- Handoff creates notification and visible inbox badge.
- Bot stops replying when human mode is active.
- Owner can re-enable AI after resolution.

## Phase 4: Conversation Orchestrator

Purpose: reduce duplicated logic in Meta and Plivo webhooks.

### 4.1 Add `whatsapp-conversation-orchestrator`

Webhook functions should become thin:

```text
Meta/Plivo webhook
  -> normalize provider payload
  -> idempotency check
  -> insert inbound event/message
  -> invoke orchestrator
```

Orchestrator owns:

- Lead lookup/create.
- Conversation state.
- DNC detection.
- Job/vendor classification.
- Intake extraction.
- Course selection capture.
- AI reply decision.
- Handoff decision.
- Notification creation.
- Reply dispatch.

Acceptance:

- Meta and Plivo use the same decision engine.
- New WhatsApp numbers can be added by config, not by copying logic.

### 4.2 Add Automation Audit Table

Suggested schema:

```sql
create table public.whatsapp_automation_events (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  business_number text,
  provider text,
  lead_id uuid references public.leads(id),
  message_id uuid references public.whatsapp_messages(id),
  event_type text not null,
  decision text,
  reason text,
  confidence numeric,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

Event examples:

- `inbound_received`
- `lead_created`
- `lead_linked`
- `classified_admission`
- `classified_job`
- `ai_reply_sent`
- `human_mode_skip`
- `handoff_created`
- `send_failed`
- `dnc_marked`
- `knowledge_gap_logged`

Acceptance:

- One query can reconstruct what happened for any WhatsApp conversation.

## Phase 5: Knowledge Base Integration

Purpose: plug course content in cleanly after course-wise USP copy is ready.

### 5.1 Add Structured Course Briefs

Create table:

```sql
create table public.course_admission_briefs (
  course_id uuid primary key references public.courses(id),
  short_name text not null,
  positioning text,
  strongest_usp text,
  best_fit_lead text,
  bot_first_reply text,
  proof_points text[],
  qualification_questions text[],
  careers text[],
  fee_summary text,
  source_url text,
  last_verified_at timestamptz
);
```

Acceptance:

- AI prompt pulls only relevant course brief.
- Inbox quick replies can use the same course brief.
- Course content can be updated without redeploying edge functions.

### 5.2 Safer AI Contract

Current approach parses prose plus JSON with regex. Replace with two-step AI:

1. Extraction call returns strict JSON:
   - name
   - course
   - intent
   - urgency
   - needs_human
   - confidence
2. Reply call drafts user-facing text using trusted context.

Acceptance:

- No regex JSON extraction for critical CRM updates.
- AI cannot update CRM fields unless extraction confidence is above threshold.

## Phase 6: Inbox and Operations UX

### 6.1 Inbox Improvements

Add visible fields:

- Provider: Meta or Plivo.
- Business number label.
- Conversation state.
- AI/human mode.
- Handoff reason.
- SLA timer.
- Owner.
- Last bot decision.

Actions:

- Take over.
- Assign owner.
- Re-enable AI.
- Escalate to super admin.
- Mark resolved.
- Send approved template if 24-hour window is closed.

### 6.2 Super Admin Queue

Add queue filters:

- Unassigned WhatsApp leads.
- AI failed.
- Send failed.
- SLA breached.
- Knowledge gap.
- Complaint/refund/legal.
- Repeated unanswered query.

Acceptance:

- Super admin does not need to scan all chats manually.
- Every escalated conversation has a reason and owner.

## Phase 7: Monitoring and Alerts

### 7.1 WhatsApp Health Dashboard

Metrics:

- Inbound messages by provider/number.
- Leads created by number.
- AI replies sent.
- Manual replies sent.
- Send failures by provider.
- AI skipped due to human mode.
- DNC count.
- Job/vendor diversion count.
- Pending handoffs.
- SLA breaches.

### 7.2 Alert Rules

Notify super admin when:

- Webhook receives zero inbound for active number over expected period.
- Send failure rate crosses threshold.
- Plivo/Meta endpoint returns errors.
- AI reply function fails.
- Classification queue backlog grows.
- Handoff SLA is breached.

## Rollout Plan

### Step 1: Fix Current Live Gaps

- Provider-aware manual reply.
- Provider in conversations view.
- Route health check.
- Tests.

### Step 2: Add Conversation State

- Add table and UI badges.
- Keep old `whatsapp_ai_mode` in sync.
- Make AI read new state first, old mode second.

### Step 3: Introduce Channel Registry

- Seed current Meta and Plivo numbers.
- Switch send functions one by one to shared resolver.
- Keep env fallback during migration.

### Step 4: Move Decision Logic to Orchestrator

- Start with Plivo path.
- Move Meta path after parity tests pass.
- Keep old webhook branches behind fallback until stable.

### Step 5: Plug In Course Knowledge

- Add `course_admission_briefs`.
- Load course-wise USP copy.
- Update AI prompt builder to pull brief by course.

### Step 6: Dashboard and Alerts

- Add admin health dashboard.
- Add handoff queue.
- Add alerts for failed sends and SLA breaches.

## Test Matrix

Required before rollout:

- New Meta admission message creates lead and replies.
- New Plivo admission message creates lead and replies.
- Existing lead links correctly.
- Duplicate webhook does not duplicate lead/message/reply.
- Greeting asks name and course.
- `Priya, 3` stores name and BPT course.
- Human mode suppresses AI.
- Counsellor reply pauses AI.
- Plivo manual reply sends through Plivo.
- Meta manual reply sends through Meta.
- DNC opt-out marks lead and stops automation.
- `START` reactivates eligible DNC conversation.
- Job applicant is routed to HR and admissions reply is suppressed.
- Vendor is routed to procurement/admin.
- 24-hour free-form failure suggests approved template.
- Send failure logs audit event and escalates if repeated.
- No counsellor assigned creates admin/super-admin notification.

## Open Decisions

1. Which WhatsApp numbers should exist as permanent channels?
2. Which number should be used for default admissions replies?
3. Should `9555192192` remain the public helpline and Plivo coexistence number?
4. What are SLA targets for counsellor handoff?
5. Which roles can re-enable AI after human takeover?
6. Should AI ever quote exact fees automatically, or only after course brief verification?
7. Which escalation types should go to super admin vs admission head?

## Immediate Next Engineering Task

Start with provider-aware manual replies. It is the highest leverage fix because automated Plivo replies are now live, but counsellor replies from CRM still need to route through the same provider/number.


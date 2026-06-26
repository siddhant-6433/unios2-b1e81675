# Deepen Admissions and WhatsApp Modules - Implementation Plan

This plan implements ADR-0001 in small vertical slices. The goal is to replace shallow, caller-owned logic with deeper modules whose interfaces concentrate domain rules, side effects, and tests.

## Slice 1 - Lead transition commands for call disposition

**Goal:** Make call/disposition transitions the first real Lead transition command family.

**Why first:** `src/lib/callDisposition.ts` already centralizes much of the call disposition pipeline and has focused tests. It is the lowest-risk wedge for replacing direct stage writes with named commands.

**Files/modules:**

- `CONTEXT.md`
- `src/lib/leadStages.ts`
- `src/lib/callDisposition.ts`
- `src/lib/callDisposition.test.ts`
- `supabase/migrations/*record_disposition_writes*.sql`
- `src/pages/LeadDetail.tsx`
- `src/pages/CloudDialer.tsx`
- `src/pages/CahetSprint.tsx`
- `supabase/functions/voice-call-callback/index.ts`

**Work:**

1. Define a `LeadTransitionCommand` discriminated union in a new module, likely `src/lib/leadTransitions.ts`.
2. Start with call/disposition commands only:
   - `recordDispositionInterested`
   - `recordDispositionCallback`
   - `recordDispositionNotAnswered`
   - `recordDispositionNotInterested`
   - `recordDispositionDnc`
   - `recordDispositionIneligible`
   - `recordDispositionDeferred`
3. Move stage target, reason text, activity text, and forward-only rules behind that module.
4. Keep `record_disposition_writes` as the server-side write adapter for this slice.
5. Update `recordCallDisposition` so callers pass a command intent, not stage mutation details.
6. Replace direct call/disposition stage updates in `CloudDialer` and `CahetSprint` with the same command path.

**Tests:**

- Unit tests for command resolution by current stage and disposition.
- Existing `callDisposition.test.ts` must keep proving one server-side write path.
- Regression tests for no backward transition from offered/admitted stages.
- Regression tests for terminal stages refusing auto-advance.

**Done when:**

- Call/disposition flows no longer construct stage updates outside the transition module.
- Tests cover command-to-transition behavior without mounting UI pages.

## Slice 2 - Expand Lead transition commands to visit, offer, DNC, and AI/WhatsApp paths

**Goal:** Remove direct `leads.stage` writes from high-risk callers.

**Files/modules:**

- `src/lib/leadTransitions.ts`
- `src/pages/PendingFollowups.tsx`
- `src/pages/LeadDetail.tsx`
- `src/components/admissions/OfferLetterDialog.tsx`
- `src/pages/WhatsAppInbox.tsx`
- `supabase/functions/whatsapp-ai-reply/index.ts`
- `supabase/functions/whatsapp-conversation-orchestrator/index.ts`
- `supabase/functions/dnc-scan/index.ts`
- `supabase/functions/automation-engine/index.ts`

**Work:**

1. Add named commands:
   - `scheduleVisit`
   - `rescheduleVisit`
   - `issueOffer`
   - `markDnc`
   - `restoreFromDnc`
   - `classifyNotInterested`
2. Add a server-side transition RPC only if the existing RPCs cannot safely express the command. Do not expose a generic stage setter as the public interface.
3. Ensure every command records source and reason metadata.
4. Keep automation/scoring behavior compatible with existing triggers, then explicitly document any moved side effect.

**Tests:**

- Unit tests for command invariants.
- Migration tests for any new RPC.
- Search test that flags new direct `leads.stage` writes outside allowed adapters.

**Done when:**

- Direct `leads.stage` writes exist only in server-side adapters/triggers or explicitly approved legacy compatibility paths.

## Slice 3 - Application dossier read model

**Goal:** Replace caller-specific application lifecycle assembly with one server-backed Application dossier.

**Files/modules:**

- `src/lib/admissionLifecycle.ts`
- `src/lib/applicationFunnel.ts`
- `src/pages/Applications.tsx`
- `src/pages/ApplyPortal.tsx`
- `src/pages/AdminApplicationView.tsx`
- `src/components/applicant/TokenFeePanel.tsx`
- `src/components/admissions/MiniLifecycleStepper.tsx`
- `src/components/admissions/AdmissionLifecycleStepper.tsx`
- New migration for an RPC or view such as `application_dossier`

**Target interface:**

The dossier should return:

- application identity and applicant identity
- canonical lifecycle stages
- offer state
- document review state
- payment state
- PAN/AN state and dues
- `nextAction`
- blocking reasons
- source facts needed by UI, without exposing every caller to table joins

**Work:**

1. Create a server-backed dossier RPC for one application by `application_id` and one list version by page/filter when needed.
2. Keep `computeStages()` as the rendering-friendly stage interpreter initially, but feed it from dossier-shaped data.
3. Move "can issue offer", "can pay token", "can nudge payment", and "why disabled" logic into dossier output.
4. Migrate `AdminApplicationView` first, then `Applications`, then `ApplyPortal`/`TokenFeePanel`.

**Tests:**

- Dossier fixtures for draft, fee paid, submitted, approved, offer issued, PAN, AN, rejected docs, orphan lead.
- UI tests can assert rendering from dossier fixtures instead of mocking many Supabase calls.

**Done when:**

- Major application surfaces do not manually join or infer state from `applications + leads + offer_letters + lead_payments + doc reviews`.

## Slice 4 - Conversation action module

**Goal:** Make WhatsApp communication actions own send, log, outbound context, conversation state, and automation event effects.

**Files/modules:**

- `supabase/functions/_shared/whatsapp-channel.ts`
- `supabase/functions/_shared/whatsapp-conversation-state.ts`
- `supabase/functions/_shared/whatsapp-outbound-context.ts`
- `supabase/functions/_shared/whatsapp-automation-events.ts`
- `supabase/functions/whatsapp-reply/index.ts`
- `supabase/functions/whatsapp-send/index.ts`
- `supabase/functions/whatsapp-campaign-send/index.ts`
- `supabase/functions/whatsapp-ai-reply/index.ts`
- `supabase/functions/whatsapp-conversation-orchestrator/index.ts`
- `src/pages/WhatsAppInbox.tsx`

**Work:**

1. Define server-side Conversation action variants:
   - `manualReply`
   - `templateSend`
   - `campaignSend`
   - `aiReply`
   - `dncAcknowledgement`
   - `handoff`
2. Move "send and record operational effects" into one shared module.
3. Keep Meta and Plivo as adapters behind the existing channel seam.
4. Remove caller-owned duplication for `whatsapp_messages`, outbound context, state upsert, and automation event logging.
5. When a Conversation action changes lead stage, route through Lead transition commands.

**Tests:**

- Adapter tests for Meta vs Plivo payloads.
- Action tests proving each variant logs message, outbound context, state, and event.
- Inbox tests only assert that it invokes the correct action, not every side effect.

**Done when:**

- A WhatsApp caller cannot send a message without the required operational records unless it uses an explicitly named exception action.

## Slice 5 - Admissions list read module

**Goal:** Collapse admissions list filtering, pagination, export, enrichment, and pipeline click-loading behind one read module.

**Dependency:** Do this after Lead transition and Application dossier are stable.

**Files/modules:**

- `src/pages/Admissions.tsx`
- `src/hooks/useAdmissionsData.ts`
- `src/hooks/useActionCenter.ts`
- `src/components/admissions/LeadPipeline.tsx`
- `src/components/admissions/VisitPipeline.tsx`
- New module, likely `src/lib/admissionsListRead.ts` or a hook/RPC pair

**Work:**

1. Define one filter model for list, export, and pipeline click scopes.
2. Move cursor construction and `hasActiveListFilters` into the read module.
3. Move row enrichment into the read module or the server-backed read path.
4. Make export use the same filter model as the visible list.
5. Keep the UI page responsible for selection, dialogs, and layout only.

**Tests:**

- Filter model to query predicate tests.
- Cursor pagination tests.
- Export/list parity test.
- Pipeline click filter tests.

**Done when:**

- `Admissions.tsx` no longer contains the query implementation for normal list reads and exports.

## Recommended Order

1. Slice 1: call/disposition Lead transition commands.
2. Slice 2: remaining Lead transition commands.
3. Slice 3 and Slice 4 can run in parallel after Slice 1:
   - Application dossier depends on stable transition history.
   - Conversation action depends only on Lead transition commands for stage changes.
4. Slice 5 after Slices 2 and 3.

## Guardrails

- Do not introduce a generic public stage setter.
- Do not let frontend modules own server-side side effects.
- Do not make Application dossier a write dependency for Lead transition commands.
- Keep glossary terms in `CONTEXT.md` current as names sharpen.
- Add search-based tests for prohibited direct writes once transition adapters exist.

## Progress

- Slice 1 implemented: call-disposition stage resolution now lives in `src/lib/leadTransitions.ts`, with `recordCallDisposition`, CloudDialer, and CAHET Sprint using the command resolver.
- Slice 2 frontend command pass implemented: visit scheduling/rescheduling, offer issuance, DNC/restore, not-interested, ineligible, and WhatsApp stage actions now resolve through named Lead transition commands before writing lead stage patches.
- Slice 2 server command pass implemented: high-risk server stage writers now use `supabase/functions/_shared/lead-transition.ts`, including DNC scan, voice callback, WhatsApp orchestrator/webhook/AI reply, automation stage advance, and WhatsApp role classification. Frontend admin override, inactive, application submission, interview result, and conversion paths now use explicit Lead transition commands.
- Slice 3 first read-model pass implemented: `src/lib/applicationDossier.ts` now builds a dossier from application, lead, offer, document, and payment facts, and the Applications list consumes the dossier instead of rebuilding lifecycle facts inline.
- Slice 3 capability pass implemented: Application dossier now exposes offer action capability and blocked reason; Admin Application View uses it for the offer button.
- Slice 4 conversation action pass implemented: `supabase/functions/_shared/whatsapp-conversation-action.ts` owns manual reply, template send, campaign send, AI reply, DNC acknowledgement, and handoff outbound message/context/activity/event/state recording.
- Slice 5 list/export/enrichment pass implemented: `src/lib/admissionsListRead.ts` owns the Admissions list filter model, active-filter count policy, PostgREST predicates, list select projection, sort, cursor predicate, ID-set intersection, and page-row enrichment mapping used by visible list reads and export.

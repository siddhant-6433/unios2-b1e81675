# WhatsApp Automation System Review

Date: 2026-06-05

## Executive Summary

The current WhatsApp system is functional but fragmented. It has a Meta Cloud API path for the primary WhatsApp numbers, a Plivo coexistence path for `9555192192`, a CRM inbox, lead creation, AI replies, job/vendor classification, DNC handling, and manual counsellor replies. The biggest engineering issue is that routing and automation rules are spread across multiple edge functions instead of one provider-aware conversation engine.

The next version should centralize all inbound WhatsApp events into a single conversation orchestration layer:

1. Normalize inbound message across providers.
2. Find or create the lead.
3. Classify intent and conversation state.
4. Decide automation vs human takeover.
5. Reply using the same provider and same business number.
6. Escalate to counsellor, admission head, HR, procurement, or super admin when needed.
7. Log every decision, outbound send, failure, and handoff.

## Current Setup

### Meta WhatsApp Numbers

Meta WhatsApp Cloud API inbound messages are handled by:

- `supabase/functions/whatsapp-webhook/index.ts`
- Public endpoint: `https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-webhook`

This webhook receives Meta events for configured WABA phone numbers. The function reads `value.metadata.phone_number_id` and `value.metadata.display_phone_number`, then stores those values on `whatsapp_messages.business_phone_number_id` and `whatsapp_messages.business_phone_number`.

Outbound Meta sends are split across:

- `whatsapp-send`: approved templates and lifecycle messages.
- `whatsapp-reply`: free-form manual replies from the inbox.
- `whatsapp-ai-reply`: AI-generated free-form replies within the WhatsApp service window.
- `whatsapp-campaign-send`: campaign sends.
- `whatsapp-otp`: login OTPs.
- `visit-reminders`, `feedback-sender-cron`, `lead-velocity-cron`: automated operational sends.

Route-specific secret names exist in code:

- Default: `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- OTP: `WHATSAPP_OTP_API_TOKEN`, `WHATSAPP_OTP_PHONE_NUMBER_ID`
- Call: `WHATSAPP_CALL_API_TOKEN`, `WHATSAPP_CALL_PHONE_NUMBER_ID`
- Visit: `WHATSAPP_VISIT_API_TOKEN`, `WHATSAPP_VISIT_PHONE_NUMBER_ID`
- Bulk: `WHATSAPP_BULK_API_TOKEN`, `WHATSAPP_BULK_PHONE_NUMBER_ID`
- Reply: `WHATSAPP_REPLY_API_TOKEN`, `WHATSAPP_REPLY_PHONE_NUMBER_ID`

Every route currently falls back to the default token and phone-number ID if the route-specific secret is missing. As of the production secret-name check, only the default Meta WhatsApp token/phone-number ID is visible by name, so the intended multi-number isolation may not actually be active for all routes.

### `9555192192` Plivo Number

`9555192192` is set up as a Plivo coexistence WhatsApp number, not a normal Meta Cloud API number in this code path.

Inbound handler:

- `supabase/functions/whatsapp-plivo-webhook/index.ts`
- Public endpoint: `https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-plivo-webhook`

Current flow:

1. Parse Plivo form/JSON body.
2. Ignore non-WhatsApp payloads and duplicate `MessageUUID`.
3. Find or create a CRM lead with `source = whatsapp`, `stage = new_lead`.
4. Insert inbound `whatsapp_messages` row with `provider = plivo`.
5. Insert `lead_activities` and `lead_engagement_events`.
6. Ensure `whatsapp_ai_mode` row exists for `(lead phone, business number)`.
7. Run regex/LLM classification for job/vendor/other detection.
8. Send deterministic greeting menu for basic greetings.
9. Otherwise dispatch `whatsapp-ai-reply` with `provider = plivo` and `business_number`.

This endpoint was missing from production earlier. It has now been deployed and confirmed active.

### CRM Inbox

Main UI:

- `src/pages/WhatsAppInbox.tsx`

Important behavior:

- Reads `whatsapp_conversations` view.
- Filters by role: counsellor, admission head, campus admin, super admin, HR manager.
- Supports admissions and HR scopes.
- Separates conversations by `business_phone_number_id`.
- Shows categories: admission, staff, job, vendor, other.
- Supports manual replies, quick replies, approved template sends, DNC, follow-up creation, and lead stage updates.
- Supports AI/human toggle via `whatsapp_ai_mode`.

Important issue:

- Manual replies call `whatsapp-reply`, which only sends through Meta Cloud API. Plivo conversations need provider-aware manual reply support, otherwise a counsellor replying from CRM to a `9555192192` thread may route through the wrong sender or fail.

### Lead Creation

Lead creation happens in both inbound paths:

- Meta path: `whatsapp-webhook`
- Plivo path: `whatsapp-plivo-webhook`

Both normalize phone numbers, search existing non-mirror leads, and create a new lead when none exists. `whatsapp-ai-reply` also has a safety-net lead creation path. This redundancy helps reliability, but it also means lead creation logic is duplicated.

### AI Reply and Qualification

Main function:

- `supabase/functions/whatsapp-ai-reply/index.ts`

Current behavior:

- Checks for recent human reply in the last 30 minutes.
- Checks `whatsapp_ai_mode`; if mode is `human`, the bot stays silent.
- Finds or creates the lead.
- Extracts name and course from the conversation.
- Maps numbered course replies to CRM `leads.course_id`.
- Uses Gemini with a NIMT knowledge base hardcoded inside the function.
- Logs outbound AI reply to `whatsapp_messages`.
- Can mark DNC/not-interested based on model output.
- Logs low-confidence knowledge gaps.

### Non-Admission Classification

Function:

- `supabase/functions/wa-classify-message/index.ts`

Current behavior:

- Classifies messages as `admission`, `job`, `vendor`, or `other`.
- High-confidence job/vendor messages update `leads.person_role` and stage.
- Deferred replies preserve original provider and business number, including Plivo.
- Prevents duplicate deferred replies with queue completion compare-and-set.

### Data Model

Core WhatsApp tables/views:

- `whatsapp_messages`: all inbound/outbound WhatsApp messages.
- `whatsapp_conversations`: latest-message view grouped by phone and business number.
- `whatsapp_ai_mode`: per `(phone, business_number)` AI/human mode.
- `wa_classification_queue`: async classification queue.
- `lead_activities`, `lead_engagement_events`, `notifications`: CRM and operational signals.

## Main Gaps

### 1. Routing Is Duplicated

Provider and number-routing logic exists in several places: `whatsapp-webhook`, `whatsapp-plivo-webhook`, `whatsapp-reply`, `whatsapp-ai-reply`, `whatsapp-send`, and campaign/cron functions. This makes it easy for one path to be fixed while another path remains broken.

Recommendation: create a shared `whatsapp_channels` model and a shared send adapter used by all functions.

### 2. Manual Replies Are Not Fully Provider-Aware

Automated Plivo replies now use Plivo. Manual CRM replies still use `whatsapp-reply`, which only sends via Meta.

Recommendation: update `whatsapp-reply` to read the selected conversation's provider/business number and route through either Meta or Plivo. For Plivo, call `sendPlivoWhatsAppText`.

### 3. Secrets Suggest Multi-Number Routing May Be Incomplete

The code supports route-specific Meta numbers, but production secret names currently show only the default Meta token/phone-number ID. If the route-specific secrets are not configured, OTP/call/visit/bulk/reply all collapse back to the default sender.

Recommendation: configure and verify each intended route explicitly, then add a health check that fails when an expected route is falling back.

### 4. Knowledge Base Is Duplicated

Course data exists in:

- `web-chat-server/knowledge.ts`
- Hardcoded `KNOWLEDGE_BASE` inside `whatsapp-ai-reply`
- Inbox quick replies/templates
- Database course and fee structures

Recommendation: move course briefs to a structured database-backed knowledge base and generate prompts/templates from that source.

### 5. AI Output Parsing Is Fragile

`whatsapp-ai-reply` asks the model for prose plus JSON blocks, then extracts JSON with regex. This can fail silently or miss nested data.

Recommendation: split the AI call into two steps:

1. Structured extraction/classification with JSON schema.
2. Reply drafting using trusted extracted state and approved knowledge snippets.

### 6. Human Handoff Is Basic

`whatsapp_ai_mode` is useful but too small for a full admissions operation. It records only AI vs human. It does not capture reason, owner, SLA, escalation level, expiry, last bot decision, or next action.

Recommendation: replace or extend it with `whatsapp_conversation_state`.

Suggested fields:

- `phone`
- `business_number`
- `provider`
- `lead_id`
- `mode`: `ai`, `human`, `paused`, `closed`
- `owner_user_id`
- `handoff_reason`
- `priority`
- `sla_due_at`
- `last_bot_action`
- `last_intent`
- `last_confidence`
- `updated_by`
- `updated_at`

### 7. Observability Is Too Thin

There is no single dashboard that answers:

- Did inbound arrive?
- Was a lead created?
- Was it classified?
- Did AI reply?
- Which provider sent the reply?
- Did the send fail?
- Which conversations are waiting for counsellor/super admin?

Recommendation: add a WhatsApp automation health page with per-number funnel metrics.

## Target Architecture

### Inbound Pipeline

Every inbound provider should normalize into one internal event:

```text
Provider webhook
  -> normalize payload
  -> idempotency check
  -> insert whatsapp_messages inbound
  -> find/create lead
  -> update conversation state
  -> classify intent
  -> decide response policy
  -> send or handoff
  -> log outcome
```

### Conversation Decision Policy

Recommended decision order:

1. DNC / opt-out: mark DNC, send one acknowledgement, stop.
2. Login/document special commands: route to special handler, do not create admissions noise.
3. Staff/internal sender: classify as staff and avoid admissions pitch.
4. Job/vendor/other: classify and hand off to HR/procurement/admin.
5. Existing human mode: notify owner, do not auto-reply.
6. Missing name or course: ask intake question with course menu.
7. Known course query: answer from course knowledge base.
8. High-intent admission lead: answer, update CRM fields, notify counsellor.
9. Low-confidence or sensitive query: escalate to counsellor/super admin.

### Escalation Rules

Escalate to assigned counsellor when:

- Lead asks for fees, scholarship, eligibility exception, seat availability, call back, campus visit, document issue, payment issue.
- Lead repeats a question after bot reply.
- Bot confidence is below threshold.
- Lead sends media/documents.
- Lead asks for a human.

Escalate to admission head/super admin when:

- No counsellor assigned.
- Counsellor SLA breached.
- Complaint/abuse/legal/refund issue.
- Bot cannot answer and knowledge gap is logged.
- High-value course with urgent deadline.

Escalate to HR when:

- `person_role = job_applicant`
- HR business number receives message.
- Resume/CV/job/vacancy intent is detected.

Escalate to procurement/admin when:

- Vendor, partnership, quotation, invoice, supply, tender, or sponsorship intent is detected.

### Suggested Conversation States

Use clear states instead of only `stage` plus `person_role`:

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

## Recommended Implementation Plan

### Phase 1: Stabilize Current System

1. Make `whatsapp-reply` provider-aware for Plivo and Meta.
2. Add a route-health function that lists configured WhatsApp route names and whether each has token + sender configured.
3. Add tests for manual replies on Plivo.
4. Add per-provider send failure logging.
5. Move hardcoded HR phone-number ID into config or database.

### Phase 2: Centralize Routing

1. Create `whatsapp_channels` table:
   - `id`
   - `label`
   - `provider`: `meta` or `plivo`
   - `business_number`
   - `meta_phone_number_id`
   - `route`: `admissions`, `reply`, `otp`, `call`, `visit`, `bulk`, `hr`
   - `is_active`
   - `quality_risk_level`
2. Create shared send adapter:
   - `sendWhatsAppText(channel, to, text)`
   - `sendWhatsAppTemplate(channel, to, template, params)`
3. Replace duplicated env routing in edge functions.

### Phase 3: Build Conversation Orchestrator

1. Create `whatsapp-conversation-orchestrator` edge function.
2. Both Meta and Plivo webhooks should only normalize and enqueue events.
3. Orchestrator owns lead creation, classification, reply decisions, handoff, and logging.
4. Add `whatsapp_automation_events` audit table for every decision.

### Phase 4: Structured Admissions Knowledge Base

1. Create `course_admission_briefs` table:
   - `course_id`
   - `short_name`
   - `duration`
   - `campuses`
   - `eligibility`
   - `entrance`
   - `fees_summary`
   - `usps`
   - `career_outcomes`
   - `clinical_or_practical_exposure`
   - `approved_by`
   - `affiliated_to`
   - `source_url`
   - `last_verified_at`
2. Use this table for:
   - AI prompt context
   - inbox quick replies
   - Meta template parameter resolution
   - website/web-chat/voice agent knowledge

### Phase 5: Operations Dashboard

Add dashboard cards:

- Inbound received by number/provider.
- Leads created.
- AI replied.
- Human handoffs pending.
- Messages failed by provider.
- Conversations in human mode.
- Knowledge gaps.
- SLA breaches by counsellor.
- Top unanswered course questions.

## Course Intake Menu

Recommended first bot message for new admissions conversations:

```text
Hi! Welcome to NIMT Admissions.

Please share your name and course interest. You can reply like: Priya, 3

1. B.Sc Nursing
2. GNM
3. BPT
4. BMRIT
5. MBA
6. PGDM
7. BBA
8. BCA
9. BA LLB / LLB
10. B.Ed
11. D Pharma
12. School admission
```

## Course Briefs

Use these briefs as the source for WhatsApp bot replies, counsellor quick replies, and template copy. The bot should not dump the whole brief. It should pick the strongest 2-3 points for the student's course, then ask one qualifying question.

### B.Sc Nursing

- Positioning: Professional nursing degree for PCB students who want hospital, clinical, and long-term healthcare careers.
- Strongest USP: NIMT has parent-hospital based clinical training, plus exposure to affiliated hospitals and psychiatric/community postings.
- Best-fit lead: 12th PCB student, parent of a PCB student, or student asking for nursing with placement, hostel, clinical training, or government/private hospital opportunities.
- Bot first reply angle: "B.Sc Nursing is a 4-year INC-approved degree with hospital training and a 6-month paid internship."
- Proof points: INC approval, ABVMU affiliation, parent hospital, GIMS/Navin/Manipal exposure, VIMHANS/IHBAS psychiatric postings, approx. 98% placement rate.
- Qualification questions: Ask PCB percentage, age, preferred campus, hostel need, and whether they have appeared for UPCNET/CPNET.
- Fee: Rs 1,53,000/year first-year fee.
- Careers to mention: Staff nurse, ICU/OT nurse, community nurse, nurse educator, hospital roles in India and abroad.

### GNM

- Positioning: Nursing diploma for students who want to enter nursing without needing a Science background.
- Strongest USP: Arts and Commerce students can apply; Science is not mandatory.
- Best-fit lead: 12th pass student from any stream, especially Arts/Commerce students asking if nursing is possible.
- Bot first reply angle: "GNM is a 3-year nursing diploma plus internship, and non-Science students can also apply."
- Proof points: INC/UP State Medical Faculty approval, hospital training, community postings, registered nurse/midwife pathway.
- Qualification questions: Ask 12th stream, percentage, age, and whether the student wants degree nursing later through Post-Basic B.Sc Nursing.
- Fee: Rs 1,18,000/year first-year fee.
- Careers to mention: Registered nurse, midwife, hospital nurse, clinic nurse, maternity home, CHC, NGO, international nursing pathway.

### BPT

- Positioning: Physiotherapy degree for PCB students interested in rehabilitation, sports, orthopaedics, neurology, and clinical patient care.
- Strongest USP: Hospital-based clinical learning with rotations across orthopaedics, neurology, medicine, surgery, and physiotherapy.
- Best-fit lead: PCB student asking for paramedical/physiotherapy, sports rehab, clinical career, or non-MBBS healthcare option.
- Bot first reply angle: "BPT is a 4.5-year physiotherapy degree with a 6-month internship and strong hospital exposure."
- Proof points: Parent hospital, clinical rotations, growing demand in hospitals, clinics, sports and rehabilitation.
- Qualification questions: Ask PCB percentage, age, interest in clinical practice vs sports/rehab, and campus/hostel need.
- Fee: Rs 92,000/year first-year fee.
- Careers to mention: Physiotherapist, rehab specialist, sports physiotherapy support, hospital/clinic roles, MPT pathway.

### BMRIT

- Positioning: Medical imaging degree for Biology students who want a hospital technology career without becoming a doctor or nurse.
- Strongest USP: Practical diagnostic imaging exposure across X-ray, CT, MRI, ultrasound, and hospital imaging workflows.
- Best-fit lead: Biology student asking for paramedical courses, radiology, hospital technician roles, or career options after PCB.
- Bot first reply angle: "BMRIT prepares students for radiology and diagnostic imaging roles in hospitals and diagnostic centres."
- Proof points: Hospital-based training, imaging modalities, emergency and surgical imaging exposure.
- Qualification questions: Ask Biology background, percentage, whether they prefer hospital technical work, and if they want BPT/BMRIT comparison.
- Fee: Rs 92,000/year first-year fee.
- Careers to mention: Radiographer, X-ray technician, CT/MRI technician, ultrasound assistant, diagnostic centre roles.

### MBA

- Positioning: University-affiliated management degree for graduates who want a conventional MBA with placements and specialisations.
- Strongest USP: AKTU affiliation, AICTE approval, case-based learning, internships, and access to NIMT's corporate network.
- Best-fit lead: Graduate asking for MBA, placement, specialisation, fees, or admission without overcomplicated entrance guidance.
- Bot first reply angle: "MBA at NIMT is a 2-year AICTE-approved, AKTU-affiliated programme with specialisations like Finance, Marketing, HR, Operations and IT."
- Proof points: 1,200+ corporate partners, 60+ companies visiting, highest INR 18.75 LPA, average INR 5.40 LPA.
- Qualification questions: Ask graduation percentage, entrance test status, preferred specialisation, work experience, and campus preference.
- Fee: Rs 1,30,000/year first-year fee.
- Careers to mention: Management trainee, marketing, finance, HR, operations, business development, consulting.

### PGDM

- Positioning: Industry-focused management programme for graduates who want a more immersive, residential business-school experience.
- Strongest USP: AICTE-approved residential PGDM with small batch size and more curriculum flexibility than a traditional university MBA.
- Best-fit lead: Graduate comparing MBA vs PGDM, asking for business school experience, placements, residential campus, or management career.
- Bot first reply angle: "PGDM is a 2-year full-time residential management programme with industry exposure and small batches."
- Proof points: Ranked #8 in current NIMT knowledge base, AICTE approved, 1,200+ placement partners, specialisations across HR, Marketing, Operations, International Business, Insurance and Banking, Foreign Trade, Agri Business.
- Qualification questions: Ask graduation percentage, entrance score, residential preference, specialisation interest, and budget.
- Fee: Rs 2,25,000/year first-year fee.
- Careers to mention: BFSI, FMCG, IT/ITES, retail, logistics, healthcare, consulting, management roles.

### BA LLB / LLB

- Positioning: Law pathway for 12th pass students through BA LLB and graduates through LLB.
- Strongest USP: BCI-approved law education with moot court, legal aid, court exposure, and internship-oriented learning.
- Best-fit lead: Student asking for law after 12th, graduate asking for LLB, or parent asking about recognition and court practice.
- Bot first reply angle: "NIMT offers BA LLB for 12th pass students and LLB for graduates, with BCI approval and practical legal exposure."
- Proof points: BCI approval, CLAT Consortium MoU, #57 Law in India in current knowledge base, moot court, legal aid clinic.
- Qualification questions: Ask whether the student is 12th pass or graduate, percentage, preferred campus, and interest in advocacy/corporate law/judiciary.
- Fee: BA LLB Rs 1,10,000/year; LLB Rs 44,250/year first-year fee.
- Careers to mention: Advocate after AIBE, corporate lawyer, legal advisor, judicial services, legal consultant.

### B.Ed

- Positioning: Teacher-training degree for graduates who want school teaching eligibility and classroom practice.
- Strongest USP: NCTE-recognised B.Ed across multiple campuses with teaching practice and school internship.
- Best-fit lead: Graduate asking for teaching career, B.Ed eligibility, campus choice, or UP/Rajasthan admission route.
- Bot first reply angle: "B.Ed is a 2-year NCTE-recognised teacher-training programme with practical teaching exposure."
- Proof points: NCTE recognition, CCSU/University of Rajasthan affiliation depending on campus, school internship, micro-teaching.
- Qualification questions: Ask graduation stream, percentage, state/campus preference, and whether they have appeared for UP B.Ed JEE/PTET.
- Fee: Rs 56,000/year Greater Noida/Ghaziabad; Rs 27,000/year Kotputli first-year fee.
- Careers to mention: TGT/PGT after required exams, private school teacher, coaching educator, M.Ed pathway.

### BCA

- Positioning: Undergraduate IT degree for students who want software, web, database, and technology careers after 12th.
- Strongest USP: Practical computer applications curriculum covering programming, web development, databases, cloud, mobile apps, and cybersecurity basics.
- Best-fit lead: 12th student asking for computer course, software career, MCA pathway, or non-engineering IT option.
- Bot first reply angle: "BCA is a 3-year computer applications programme for students interested in IT and software careers."
- Proof points: Programming stack, project work, technology electives, MCA/MBA-IT pathway.
- Qualification questions: Ask Maths background, 12th percentage, coding interest, and whether the student wants job after graduation or MCA later.
- Fee: Rs 75,000/year first-year fee.
- Careers to mention: Software developer, web designer, database administrator, system analyst, network engineer, IT support, data analyst.

### BBA

- Positioning: Undergraduate management degree for 12th pass students who want business, marketing, finance, HR, or entrepreneurship careers.
- Strongest USP: Any-stream eligibility with early business exposure and a clear MBA pathway.
- Best-fit lead: 12th student from Commerce/Arts/Science asking for business course, management, startup, marketing, or MBA preparation.
- Bot first reply angle: "BBA is a 3-year management programme open to students from any stream."
- Proof points: Finance, Marketing, HR, Strategy and Entrepreneurship, International Business, Supply Chain, case studies and internships.
- Qualification questions: Ask 12th stream, percentage, career interest, and preferred campus.
- Fee: Rs 75,000/year first-year fee.
- Careers to mention: Business development, marketing, HR trainee, sales, finance, operations, entrepreneurship, MBA pathway.

### D Pharma

- Positioning: Pharmacy diploma for Science students who want a faster route into pharmacy practice or B Pharma lateral entry.
- Strongest USP: PCI-approved diploma with practical hospital and community pharmacy exposure.
- Best-fit lead: 12th PCB/PCM student asking for pharmacy, medical store license pathway, pharma sales, or B Pharma later.
- Bot first reply angle: "D Pharma is a 2-year PCI-approved diploma with practical pharmacy training."
- Proof points: PCI approval, hospital/community pharmacy exposure, patient counselling and dispensing practice, B Pharma lateral-entry pathway.
- Qualification questions: Ask PCB/PCM background, percentage, whether they want pharmacist registration or B Pharma later.
- Fee: Rs 95,000/year first-year fee.
- Careers to mention: Registered pharmacist, pharmaceutical sales, hospital pharmacy, retail/community pharmacy, QC/QA with further qualification.

### School Admission

- Positioning: School admission route covering NIMT Beacon School CBSE and Mirai Experiential School IB.
- Strongest USP: Families can choose between CBSE schooling and IB-style inquiry-based learning within the NIMT ecosystem.
- Best-fit lead: Parent asking for nursery to Grade XII, boarding/day boarding, CBSE, IB, transport, or Ghaziabad school admission.
- Bot first reply angle: "For school admission, NIMT has CBSE and IB options in Ghaziabad, with labs, activities, transport and boarding/day-boarding support."
- Proof points: CBSE affiliation for NIMT Beacon School, IB PYP/MYP positioning for Mirai, smart classrooms, science/computer labs, sports, transport, boarding options.
- Qualification questions: Ask child's current class, age, preferred board, location, transport/boarding need, and whether the parent wants a campus visit.
- Fee note: Day boarding lunch option is listed at Rs 4,000/month in current knowledge base; full grade-wise fee should be verified before automation quotes.

## Recommended Bot Reply Style

The bot should:

- Ask one question at a time during intake.
- Store name and course immediately when detected.
- Give short course-specific answers first, then ask whether the lead wants fees, eligibility, campus visit, or counsellor call.
- Never invent fees, deadlines, approvals, or seat counts.
- Use templates when the 24-hour WhatsApp window is closed.
- Mention counsellor handoff clearly when a human is needed.
- Keep DNC and opt-out handling strict.

## High-Priority Engineering Tasks

1. Make `whatsapp-reply` provider-aware for Plivo.
2. Add route configuration health checks for all intended numbers.
3. Centralize provider send logic in shared code.
4. Move course knowledge into database-backed structured briefs.
5. Add `whatsapp_automation_events` audit table.
6. Add a pending-handoff queue with owner, SLA, reason, and priority.
7. Add regression tests for Meta inbound, Plivo inbound, AI mode, manual reply, DNC, job/vendor routing, course extraction, and template fallback.

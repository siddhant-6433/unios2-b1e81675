# CopilotKit + WhatsApp Bot Integration

## What CopilotKit Adds Here

CopilotKit is now positioned as an agentic frontend stack backed by AG-UI, an event protocol for connecting agent backends to user-facing surfaces. For UniOs, the WhatsApp bot already owns the hard channel work: Meta/Plivo routing, DNC handling, lead creation, AI/human mode, and CRM logging. The right first integration point is therefore the protocol boundary, not replacing WhatsApp delivery.

## Implemented Integration

The WhatsApp AI reply path now emits CopilotKit/AG-UI-compatible traces in `whatsapp_automation_events.metadata.copilotkit` whenever an AI reply is successfully sent.

Files:

- `supabase/functions/_shared/copilotkit-agui.ts`
- `supabase/functions/whatsapp-ai-reply/index.ts`
- `supabase/functions/whatsapp-copilot-events/index.ts`

Each trace includes:

- `RUN_STARTED`
- `STATE_SNAPSHOT`
- `TEXT_MESSAGE_START`
- `TEXT_MESSAGE_CONTENT`
- `TEXT_MESSAGE_END`
- `RUN_FINISHED`

The snapshot carries WhatsApp-specific state: phone, business number, provider, lead id, last user message, query type, confidence, and bot action.

## Replay Endpoint

`whatsapp-copilot-events` exposes recent AI WhatsApp runs as JSON or Server-Sent Events.

JSON:

```sh
curl -X POST "$SUPABASE_URL/functions/v1/whatsapp-copilot-events" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"919555192192","limit":5}'
```

SSE:

```sh
curl "$SUPABASE_URL/functions/v1/whatsapp-copilot-events?phone=919555192192&format=sse" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Accept: text/event-stream"
```

This is service-role only for now because the stream can expose private lead conversations. If we expose it to the CRM UI, add role checks against the authenticated user before returning traces.

## Why This Shape

WhatsApp itself cannot render arbitrary React generative UI. CopilotKit’s useful role for WhatsApp is to standardize the agent run stream so the same bot behavior can later appear in:

- the CRM inbox as a Copilot sidecar,
- QA/replay tooling for admissions heads,
- counsellor approval flows,
- future messaging surfaces that understand AG-UI or can be adapted from it.

## Next Use Cases

1. **Counsellor Copilot in WhatsApp Inbox**
   Draft replies, summarize the thread, explain why the bot answered a certain way, and suggest the next best CRM action.

2. **Human-in-the-Loop Approvals**
   For low-confidence replies, fee promises, waiver language, DNC-sensitive cases, or medical-course eligibility, pause the bot and ask a counsellor to approve/edit before sending.

3. **Conversation QA Console**
   Replay AG-UI runs with state snapshots, confidence, retrieved course brief, final message, and outcome. This is much better than reading raw WhatsApp rows.

4. **Lead Qualification Cards**
   Convert bot-detected fields into a structured UI: name, course, campus, budget concern, deadline urgency, eligibility risk, and recommended follow-up.

5. **Knowledge-Gap Workflow**
   When confidence is low, generate an internal task with the missing answer, suggested source, and draft training response for `whatsapp_reply_learning`.

6. **Cross-Surface Agent**
   Use the same admissions agent behind WhatsApp, website chat, Slack/Teams ops alerts, and CRM sidecar, with AG-UI as the common run format.

7. **Campaign Response Triage**
   For bulk WhatsApp campaigns, classify replies into hot lead, confused, objection, DNC, wrong audience, job/vendor, and render an operator queue.

8. **Interactive WhatsApp Templates**
   Map constrained AG-UI state/actions to WhatsApp-native buttons or list messages where Meta templates allow it, instead of long text menus.

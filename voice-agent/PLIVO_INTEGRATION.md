# Plivo Voice AI Agents — Integration Status

## Current state (as of this commit)

**Scaffolded, not wired.** The provider toggle in `_app_config.voice_agent_provider`
now accepts the value `"plivo"` (in addition to the existing `"gemini"` and
`"sarvam"`), and the dispatcher in `server.ts` recognises it. **Until the
integration steps below are completed, setting the toggle to `"plivo"`
falls back to the Gemini Live path with a warning log line — calls will
still work, just on Gemini.**

This is intentional: ship the scaffold so the toggle UI / type system is
already in place, finish the Plivo-specific wiring once the API details
are confirmed with Plivo's account team.

## What needs to happen to flip this on

### 1. Confirm Plivo account access
- [ ] Voice AI Agents enabled on the Plivo account
- [ ] Pricing on a per-minute basis confirmed
- [ ] Hindi/Hinglish TTS voice availability confirmed (Cartesia / ElevenLabs / etc.)
- [ ] STT provider for Hindi confirmed (Plivo's own / Deepgram / etc.)

### 2. Pre-create the agent (one-time, via Plivo REST or Dashboard)
The agent definition lives on Plivo's side and references our system prompt
and our tool schema:

- [ ] System instruction = output of `buildSystemInstruction(callCtx)` from
      `scripts.ts` — **but** with the cascade-only addendum (Devanagari rule)
      stripped, since Plivo handles TTS itself and won't need the
      script-formatting tricks.
- [ ] Tool schema = `VOICE_AGENT_TOOLS` from `scripts.ts`. Plivo uses an
      OpenAI-style function calling format.
- [ ] Webhook URL for tool execution = `${VOICE_AGENT_URL}/plivo-agent-tool`
      (this endpoint still needs to be added — see step 4).
- [ ] TTS speaker / language — pick one that handles Hinglish naturally.
      Cartesia "Sonic" Hindi or ElevenLabs Indic if available.

### 3. Update the answer-URL XML
Plivo's AI Agent uses a different XML verb than `<Stream>`. When
`provider === "plivo"`, the `/answer/:callId` (and `/answer/inbound-ai/:callId`)
handlers in `server.ts` should return XML that connects to the agent
session instead of streaming to our WS.

Pattern (verify against current Plivo docs):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600" />
  <Connect>
    <AIAgent agentId="agent_xxx" sessionData='{"call_id":"...","lead_id":"...","direction":"outbound"}' />
  </Connect>
</Response>
```

The exact verb name (`<AIAgent>`, `<VoiceAgent>`, `<Stream agentId=...>`)
needs confirmation from the Plivo docs you have access to.

### 4. Add the tool-execution webhook in `server.ts`
Wire `POST /plivo-agent-tool` that:
- Authenticates the request (Plivo signs webhooks; verify the `X-Plivo-Signature` header)
- Parses `{ call_id, tool_name, tool_args }` from the body
- Resolves the call's `ActiveCall` context (already keyed by `callId` in `activeCallContexts`)
- Calls `executeTool(toolName, args, callCtx)` — same function the other two providers use, zero business-logic rewrite
- Returns the result as JSON in whatever shape Plivo expects

### 5. Update the dispatcher's fallback message
Once steps 2-4 are done, the warning log line in the `/ws` handler
("Plivo agent not wired into answer URL yet") becomes dead code — the
answer URL will route to `<Connect>` and the WS dispatcher will only
ever see `gemini` / `sarvam` callbacks. Leave it as a safety net.

### 6. A/B test
Flip the toggle on a single campus first (or behind a per-call header)
and compare:
- Latency (Plivo claims <300ms)
- Hindi/Hinglish naturalness vs Bulbul v3-beta
- Tool-call reliability (does Plivo's agent call our `get_course_info` /
  `schedule_visit` / `request_human_callback` correctly?)
- Cost per minute vs current Gemini Live / Sarvam cascade

If a single dimension regresses, flip back. The toggle is per-row in
`_app_config` so the rollback is one SQL UPDATE.

## Why scaffold rather than full implementation

Plivo's AI Agent product was in preview/limited beta the last time the
public docs were widely available. Rather than guess at the exact
endpoint / verb / payload shapes and risk shipping code that doesn't
match the current API, the scaffold exposes only the safe parts:
- Toggle accepts the new value
- Type system knows about it
- Dispatcher recognises it (and falls back gracefully if unconfigured)
- Existing `executeTool` / system-instruction / tool-schema is reusable
  with zero changes when the wiring is completed

Filling in steps 2-5 above is mechanical once the actual Plivo API
contract is confirmed with their team.

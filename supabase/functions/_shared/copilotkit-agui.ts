import { digits, type WhatsAppProvider } from "./whatsapp-channel.ts";

export const AG_UI_PROTOCOL_VERSION = "0.1";

type AgUiRole = "assistant" | "user" | "system" | "tool" | "developer";

export type AgUiEvent =
  | {
      type: "RUN_STARTED";
      threadId: string;
      runId: string;
    }
  | {
      type: "RUN_FINISHED";
      threadId: string;
      runId: string;
    }
  | {
      type: "RUN_ERROR";
      threadId: string;
      runId: string;
      message: string;
    }
  | {
      type: "TEXT_MESSAGE_START";
      threadId: string;
      runId: string;
      messageId: string;
      role: AgUiRole;
    }
  | {
      type: "TEXT_MESSAGE_CONTENT";
      threadId: string;
      runId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "TEXT_MESSAGE_END";
      threadId: string;
      runId: string;
      messageId: string;
    }
  | {
      type: "STATE_SNAPSHOT";
      threadId: string;
      runId: string;
      snapshot: Record<string, unknown>;
    };

export interface WhatsAppAgUiTraceInput {
  phone: string;
  businessNumber?: string | null;
  provider: WhatsAppProvider;
  leadId?: string | null;
  userMessage: string;
  assistantMessage: string;
  queryType?: string | null;
  confidence?: number | null;
  action?: string | null;
}

export interface WhatsAppAgUiTrace {
  protocol: "ag-ui";
  protocol_version: typeof AG_UI_PROTOCOL_VERSION;
  surface: "whatsapp";
  thread_id: string;
  run_id: string;
  assistant_message_id: string;
  events: AgUiEvent[];
}

export function whatsappThreadId(phone: string, businessNumber?: string | null): string {
  const normalizedPhone = digits(phone) || "unknown";
  const normalizedBusiness = businessNumber ? digits(businessNumber) || businessNumber : "default";
  return `whatsapp:${normalizedBusiness}:${normalizedPhone}`;
}

export function createWhatsAppAgUiTrace(input: WhatsAppAgUiTraceInput): WhatsAppAgUiTrace {
  const threadId = whatsappThreadId(input.phone, input.businessNumber);
  const runId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();

  const snapshot = {
    surface: "whatsapp",
    phone: digits(input.phone),
    business_number: input.businessNumber ? digits(input.businessNumber) || input.businessNumber : null,
    provider: input.provider,
    lead_id: input.leadId || null,
    last_user_message: input.userMessage,
    query_type: input.queryType || null,
    confidence: input.confidence ?? null,
    action: input.action || null,
  };

  return {
    protocol: "ag-ui",
    protocol_version: AG_UI_PROTOCOL_VERSION,
    surface: "whatsapp",
    thread_id: threadId,
    run_id: runId,
    assistant_message_id: assistantMessageId,
    events: [
      { type: "RUN_STARTED", threadId, runId },
      { type: "STATE_SNAPSHOT", threadId, runId, snapshot },
      { type: "TEXT_MESSAGE_START", threadId, runId, messageId: assistantMessageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", threadId, runId, messageId: assistantMessageId, delta: input.assistantMessage },
      { type: "TEXT_MESSAGE_END", threadId, runId, messageId: assistantMessageId },
      { type: "RUN_FINISHED", threadId, runId },
    ],
  };
}

export function agUiSse(events: AgUiEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

/**
 * Types for the NIMT Web Chat Server
 */

export interface LeadInfo {
  name: string;
  mobile: string;
  course: string;
}

export interface SessionPayload {
  leadId: string;
  lead: LeadInfo;
  iat: number;
  exp: number;
}

export interface ChatMessage {
  type: "text" | "voice";
  content: string;        // text content or base64 audio
  timestamp: string;
}

export interface ServerMessage {
  type: "chunk" | "complete" | "error" | "system";
  content: string;
  timestamp: string;
  messageId?: string;
}

export interface KnowledgeGap {
  query_text: string;
  context: {
    course: string;
    campus?: string;
    lead_id: string;
  };
  source: "web_chat";
  confidence_score: number;
}

export interface ActiveSession {
  leadId: string;
  lead: LeadInfo;
  messages: { role: string; content: string; timestamp: string; type: string }[];
  messageCount: number;
  createdAt: number;
  lastActivity: number;
}

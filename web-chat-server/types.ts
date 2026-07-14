/**
 * Types for the NIMT Web Chat Server
 */

export interface LeadInfo {
  name: string;
  mobile: string;
  course: string;
  ga_client_id?: string;
  ga_session_id?: string;
  gclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_page?: string;
  referrer?: string;
  origin_domain?: string;
  fbc?: string;
  fbp?: string;
  portal_brand?: string;
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
  lang?: "en" | "hi";
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

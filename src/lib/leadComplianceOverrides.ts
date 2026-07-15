/**
 * One-off compliance overrides for specific leads.
 * Prefer keeping these tiny and documented — not a general feature framework.
 *
 * Scope: lead detail **timeline UI only** (DB history retained).
 */

/** Hide WhatsApp + auto AI-call rows on the lead timeline for these IDs only. */
export const TIMELINE_HIDE_COMMS_LEAD_IDS = new Set([
  "9a619925-8a99-4f10-a3e3-bcec3ac7c1fc",
]);

/** Activity / engagement types hidden on that lead's timeline. */
export const TIMELINE_HIDDEN_ACTIVITY_TYPES = new Set([
  "whatsapp",
  "whatsapp_reply",
  "whatsapp_click",
  "ai_call",
  // website chat / “conversation” style engagement (timeline only)
  "chat_open",
  "chat_message",
]);

export function shouldHideTimelineComms(leadId: string | null | undefined): boolean {
  return !!leadId && TIMELINE_HIDE_COMMS_LEAD_IDS.has(leadId);
}

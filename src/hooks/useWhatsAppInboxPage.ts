import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type WhatsAppInboxScope = "inbox" | "outbound";
export type WhatsAppInboxOpsFilter = "all" | "reply_window" | "handoff" | "sla" | "knowledge" | "unassigned";

export interface WhatsAppInboxCursor {
  last_message_at: string;
  phone: string;
}

export interface WhatsAppInboxPageParams {
  scope: WhatsAppInboxScope;
  businessNumber: string;
  counsellorFilter: string;
  opsFilter: WhatsAppInboxOpsFilter;
  cursor?: WhatsAppInboxCursor | null;
  limit?: number;
}

export interface WhatsAppInboxRow {
  phone: string;
  provider: "meta" | "plivo" | string | null;
  business_number: string | null;
  conversation_key: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_stage: string | null;
  lead_person_role: string | null;
  lead_source: string | null;
  course_name: string | null;
  counsellor_id: string | null;
  counsellor_name: string | null;
  lead_temperature: "hot" | "warm" | "cold" | string | null;
  lead_score: number | null;
  last_message: string | null;
  last_direction: string | null;
  last_message_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  unreplied_count: number;
  reply_window_expires_at: string | null;
  reply_window_open: boolean;
  priority_rank: number;
  conversation_mode: string | null;
  conversation_state: string | null;
  handoff_reason: string | null;
  last_bot_action: string | null;
  render_preview: unknown;
}

export function useWhatsAppInboxPage() {
  const [rows, setRows] = useState<WhatsAppInboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (params: WhatsAppInboxPageParams, append = false) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await (supabase.rpc as any)("whatsapp_inbox_page", {
      p_scope: params.scope,
      p_business_number: params.businessNumber || "all",
      p_counsellor_filter: params.counsellorFilter || "all",
      p_ops_filter: params.opsFilter || "all",
      p_cursor_at: params.cursor?.last_message_at || null,
      p_cursor_phone: params.cursor?.phone || null,
      p_limit: params.limit || 120,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message || "Could not load WhatsApp inbox");
      return [] as WhatsAppInboxRow[];
    }
    const nextRows = (data || []) as WhatsAppInboxRow[];
    setRows(prev => append ? [...prev, ...nextRows] : nextRows);
    return nextRows;
  }, []);

  return { rows, setRows, loading, error, loadPage };
}

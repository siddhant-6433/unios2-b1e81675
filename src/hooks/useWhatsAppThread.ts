import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RenderedWhatsAppTemplate } from "@/lib/whatsappTemplateRender";

export interface WhatsAppThreadKey {
  phone: string;
  provider?: "meta" | "plivo" | string | null;
  businessNumber?: string | null;
  businessPhoneNumberId?: string | null;
}

export interface WhatsAppThreadMessage {
  id: string;
  wa_message_id: string | null;
  direction: string;
  content: string | null;
  message_type: string;
  status: string;
  template_key: string | null;
  media_url: string | null;
  created_at: string;
  provider: string | null;
  business_phone_number_id: string | null;
  business_phone_number: string | null;
  sender_user_id: string | null;
  status_error: unknown;
  render_metadata: RenderedWhatsAppTemplate | null;
}

export function useWhatsAppThread() {
  const [messages, setMessages] = useState<WhatsAppThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThread = useCallback(async (
    key: WhatsAppThreadKey,
    before?: string | null,
    limit = 200,
  ) => {
    if (!key.phone) {
      setMessages([]);
      return [] as WhatsAppThreadMessage[];
    }
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await (supabase.rpc as any)("whatsapp_thread", {
      p_phone: key.phone,
      p_provider: key.provider || null,
      p_business_number: key.businessNumber || key.businessPhoneNumberId || null,
      p_before: before || null,
      p_limit: limit,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message || "Could not load WhatsApp thread");
      return [] as WhatsAppThreadMessage[];
    }
    const nextMessages = ((data || []) as WhatsAppThreadMessage[]).reverse();
    setMessages(prev => before ? [...nextMessages, ...prev] : nextMessages);
    return nextMessages;
  }, []);

  const markRead = useCallback(async (key: WhatsAppThreadKey) => {
    if (!key.phone) return 0;
    const { data, error: rpcError } = await (supabase.rpc as any)("mark_whatsapp_conversation_read", {
      p_phone: key.phone,
      p_provider: key.provider || null,
      p_business_phone_number_id: key.businessPhoneNumberId || null,
      p_business_phone_number: key.businessNumber || null,
    });
    if (rpcError) {
      setError(rpcError.message || "Could not mark WhatsApp thread read");
      return 0;
    }
    return Number(data || 0);
  }, []);

  return { messages, setMessages, loading, error, loadThread, markRead };
}

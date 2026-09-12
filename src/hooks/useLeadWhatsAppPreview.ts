import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WhatsAppPreviewMessage = {
  id: string;
  direction: "inbound" | "outbound" | string;
  content: string | null;
  message_type: string | null;
  template_key: string | null;
  created_at: string;
};

const previewText = (row: WhatsAppPreviewMessage) => {
  const text = row.content?.trim();
  if (text) return text;
  if (row.template_key) return `Template: ${row.template_key.replace(/_/g, " ")}`;
  if (row.message_type && row.message_type !== "text") return row.message_type;
  return "(no text)";
};

export function formatWhatsAppPreview(row: WhatsAppPreviewMessage) {
  return previewText(row);
}

/**
 * Last few WhatsApp messages for ONE lead. Indexed on (lead_id, created_at).
 * Do not call this per queue row — that would add a lookup per lead and stall
 * the dialer. The header and the WhatsApp rail share this query key so opening
 * the rail does not refetch.
 */
export function useLeadWhatsAppPreview(opts: {
  leadId?: string | null;
  phone?: string | null;
  enabled?: boolean;
}) {
  const leadId = opts.leadId || null;
  const phone = (opts.phone || "").replace(/\D/g, "") || null;
  const enabled = (opts.enabled ?? true) && (!!leadId || !!phone);

  return useQuery({
    queryKey: ["dialer-wa-preview", leadId, phone],
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<WhatsAppPreviewMessage[]> => {
      let q = supabase
        .from("whatsapp_messages" as any)
        .select("id, direction, content, message_type, template_key, created_at")
        .order("created_at", { ascending: false })
        .limit(4);
      if (leadId) {
        q = q.eq("lead_id", leadId);
      } else if (phone) {
        const variants = Array.from(new Set([
          phone,
          `+${phone}`,
          phone.startsWith("91") ? phone : `91${phone}`,
        ]));
        q = q.in("phone", variants);
      }
      const { data, error } = await q;
      if (error) throw error;
      return ((data || []) as WhatsAppPreviewMessage[]).slice().reverse();
    },
  });
}

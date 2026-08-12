import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { useToast } from "@/hooks/use-toast";
import { Send, Check } from "lucide-react";
import { WhatsAppTemplatePicker } from "@/components/leads/WhatsAppTemplatePicker";
import {
  TEMPLATES, useWhatsAppTemplates, renderTemplatePreview, sendWhatsAppTemplate,
} from "@/components/leads/whatsappTemplates";
import type { QueueLead } from "@/lib/dialerQueue";

interface Props {
  lead: QueueLead;
  /** Rail tab is mounted only while visible, so this is effectively always true. */
  active: boolean;
}

/**
 * Same templates, same preview and the same send path as SendWhatsAppDialog —
 * just always on screen, so the counsellor can read the message out while the
 * lead is still on the line.
 */
export function WhatsAppTab({ lead, active }: Props) {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const { allowedKeys, visibleTemplates, templateComponentsByKey } = useWhatsAppTemplates(active);
  const selectedTmpl = visibleTemplates.find(t => t.key === selectedTemplate) || TEMPLATES.find(t => t.key === selectedTemplate);
  const previewText = renderTemplatePreview(selectedTmpl, lead, lead.course_name, lead.campus_name);

  const handleSend = async () => {
    if (!selectedTmpl) return;
    setSending(true);
    const result = await sendWhatsAppTemplate({
      template: selectedTmpl,
      lead: { id: lead.id, name: lead.name, phone: lead.phone, source: lead.source },
      courseName: lead.course_name,
      campusName: lead.campus_name,
    });
    setSending(false);
    if (!result.ok) {
      toast({ title: "Failed to send", description: result.error, variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "WhatsApp sent successfully" });
    setTimeout(() => setSent(false), 2000);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Sending to <span className="font-medium text-foreground">{lead.name}</span>
        <span className="ml-1 font-mono">{lead.phone}</span>
      </p>

      <WhatsAppTemplatePicker
        allowedKeys={allowedKeys}
        templates={visibleTemplates}
        componentsByKey={templateComponentsByKey}
        selectedKey={selectedTemplate}
        onSelect={setSelectedTemplate}
        previewText={previewText}
        listClassName="max-h-[200px]"
        previewClassName="max-h-none"
      />

      <Button onClick={handleSend} disabled={!selectedTemplate || sending || sent}
        className="w-full gap-2 bg-success hover:bg-success/60">
        {sending ? <><ButtonOrb state="connecting" onFilled /> Sending…</>
          : sent ? <><Check className="h-4 w-4" /> Sent!</>
          : <><Send className="h-4 w-4" /> Send WhatsApp</>}
      </Button>
    </div>
  );
}

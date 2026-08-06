import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { MessageSquare, Send, Check } from "lucide-react";
import { WhatsAppTemplatePicker } from "@/components/leads/WhatsAppTemplatePicker";
import {
  TEMPLATES,
  useWhatsAppTemplates,
  renderTemplatePreview,
  sendWhatsAppTemplate,
} from "@/components/leads/whatsappTemplates";

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    phone: string;
    application_id?: string | null;
    source?: string | null;
  };
  courseName?: string;
  campusName?: string;
  courseDuration?: number;
  courseType?: string;
  onSuccess?: () => void;
}

export function SendWhatsAppDialog({ open, onOpenChange, lead, courseName, campusName, courseDuration, courseType, onSuccess }: SendWhatsAppDialogProps) {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const { allowedKeys, visibleTemplates, templateComponentsByKey } = useWhatsAppTemplates(open);

  const selectedTmpl = visibleTemplates.find(t => t.key === selectedTemplate) || TEMPLATES.find(t => t.key === selectedTemplate);
  const previewText = renderTemplatePreview(selectedTmpl, lead, courseName, campusName, courseDuration, courseType);

  const handleSend = async () => {
    if (!selectedTmpl) return;
    setSending(true);
    const result = await sendWhatsAppTemplate({
      template: selectedTmpl, lead, courseName, campusName, courseDuration, courseType,
    });
    setSending(false);
    if (!result.ok) {
      toast({ title: "Failed to send", description: result.error, variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "WhatsApp sent successfully" });
    setTimeout(() => {
      setSent(false);
      setSelectedTemplate(null);
      onOpenChange(false);
      onSuccess?.();
    }, 1200);
  };

  const handleClose = (v: boolean) => {
    if (!sending) {
      setSelectedTemplate(null);
      setSent(false);
      onOpenChange(v);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-success" />
            Send WhatsApp
          </DialogTitle>
        </DialogHeader>

        {/* Recipient info */}
        <div className="flex items-center justify-between py-2 px-1">
          <div>
            <p className="text-[11px] text-muted-foreground">Sending to</p>
            <p className="text-sm font-medium text-foreground">{lead.name}</p>
          </div>
          <p className="text-sm text-muted-foreground font-mono">{lead.phone}</p>
        </div>

        <WhatsAppTemplatePicker
          allowedKeys={allowedKeys}
          templates={visibleTemplates}
          componentsByKey={templateComponentsByKey}
          selectedKey={selectedTemplate}
          onSelect={setSelectedTemplate}
          previewText={previewText}
        />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedTemplate || sending || sent}
            className="gap-2 bg-success hover:bg-success/60"
          >
            {sending ? (
              <><ButtonOrb state="connecting" onFilled /> Sending...</>
            ) : sent ? (
              <><Check className="h-4 w-4" /> Sent!</>
            ) : (
              <><Send className="h-4 w-4" /> Send WhatsApp</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

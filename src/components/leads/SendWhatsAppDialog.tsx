import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, Loader2, Check } from "lucide-react";

const TEMPLATES = [
  { key: "lead_welcome", label: "Lead Welcome", description: "Welcome message with course info" },
  { key: "visit_confirmation", label: "Visit Confirmation", description: "Confirm scheduled campus visit" },
  { key: "visit_reminder_24hr", label: "Visit Reminder (24hr)", description: "Remind about upcoming visit" },
  { key: "application_received", label: "Application Received", description: "Acknowledge application submission" },
  { key: "fee_reminder", label: "Fee Reminder", description: "Remind about pending fee payment" },
  { key: "course_details", label: "Course Details + Brochure", description: "Send course information and brochure" },
];

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    phone: string;
    application_id?: string | null;
  };
  courseName?: string;
  campusName?: string;
  onSuccess?: () => void;
}

export function SendWhatsAppDialog({ open, onOpenChange, lead, courseName, campusName, onSuccess }: SendWhatsAppDialogProps) {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!selectedTemplate) return;
    setSending(true);

    // Build params based on template
    let params: string[] = [];
    switch (selectedTemplate) {
      case "lead_welcome":
        params = [lead.name, courseName || "your selected course"];
        break;
      case "visit_confirmation":
        params = [lead.name, "your scheduled date", campusName || "our campus"];
        break;
      case "visit_reminder_24hr":
        params = [lead.name, "tomorrow"];
        break;
      case "application_received":
        params = [lead.name, lead.application_id || "N/A"];
        break;
      case "fee_reminder":
        params = [lead.name, "the pending amount", "the due date"];
        break;
      case "course_details":
        params = [lead.name, courseName || "your selected course"];
        break;
    }

    const { error } = await supabase.functions.invoke("whatsapp-send", {
      body: {
        template_key: selectedTemplate,
        phone: lead.phone,
        params,
        lead_id: lead.id,
      },
    });

    setSending(false);

    if (error) {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    } else {
      setSent(true);
      toast({ title: "WhatsApp sent successfully" });
      setTimeout(() => {
        setSent(false);
        setSelectedTemplate(null);
        onOpenChange(false);
        onSuccess?.();
      }, 1200);
    }
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
            <MessageSquare className="h-5 w-5 text-primary" />
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

        {/* Template selection */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Template</p>
          <div className="border border-border rounded-xl overflow-hidden divide-y divide-border max-h-[280px] overflow-y-auto">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                onClick={() => setSelectedTemplate(t.key)}
                className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-3 ${
                  selectedTemplate === t.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground hover:bg-muted/50"
                }`}
              >
                {selectedTemplate === t.key && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
                <span className={selectedTemplate === t.key ? "" : "pl-7"}>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedTemplate || sending || sent}
            className="gap-2"
          >
            {sending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</>
            ) : sent ? (
              <><Check className="h-4 w-4" /> Sent!</>
            ) : (
              <><Send className="h-4 w-4" /> Send</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

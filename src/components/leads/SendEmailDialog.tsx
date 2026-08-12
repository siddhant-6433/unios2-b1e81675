import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { TextField } from "@/components/ui/state-fields";
import { Mail, Send, Check } from "lucide-react";
import {
  EmailTemplatePicker, useEmailTemplates, fillEmailVars, sendEmailTemplate,
} from "@/components/leads/EmailTemplatePicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: { id: string; name: string; email: string | null };
  defaultVariables?: Record<string, string>;
  defaultTemplate?: string;
  onSuccess?: () => void;
}

export function SendEmailDialog({ open, onOpenChange, lead, defaultVariables, defaultTemplate, onSuccess }: Props) {
  const { toast } = useToast();
  const templates = useEmailTemplates(open);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(defaultTemplate || null);
  const [toEmail, setToEmail] = useState(lead.email || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) { setSent(false); return; }
    setToEmail(lead.email || "");
    setSelectedSlug(defaultTemplate || null);
  }, [open, lead.email, defaultTemplate]);

  const selectedTemplate = templates.find((t) => t.slug === selectedSlug);
  const previewSubject = selectedTemplate
    ? fillEmailVars(selectedTemplate.subject, { student_name: lead.name, ...defaultVariables })
    : "";

  const handleSend = async () => {
    if (!selectedSlug || !toEmail) return;
    setSending(true);
    const result = await sendEmailTemplate({
      templateSlug: selectedSlug,
      toEmail,
      variables: { student_name: lead.name, ...defaultVariables },
      leadId: lead.id,
    });
    setSending(false);
    if (!result.ok) {
      toast({ title: "Email failed", description: result.error, variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "Email sent", description: `Sent to ${toEmail}` });
    onSuccess?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-info-foreground" />
            Send Email
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{lead.name}</p>
        </DialogHeader>

        {sent ? (
          <div className="py-6 text-center">
            <Check className="h-10 w-10 text-primary mx-auto mb-3" />
            <p className="text-lg font-semibold text-foreground">Email Sent</p>
            <p className="text-sm text-muted-foreground mt-1">Delivered to {toEmail}</p>
            <Button onClick={() => onOpenChange(false)} className="mt-4">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <TextField
              value={toEmail}
              onValueChange={setToEmail}
              label="To"
              required
              type="email"
              placeholder="email@example.com"
            />

            <EmailTemplatePicker templates={templates} selectedSlug={selectedSlug} onSelect={setSelectedSlug} />

            {selectedTemplate && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Preview Subject</p>
                <p className="text-sm text-foreground">{previewSubject}</p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSend} disabled={!selectedSlug || !toEmail || sending} className="gap-2">
                {sending ? <ButtonOrb state="connecting" onFilled /> : <Send className="h-4 w-4" />}
                Send Email
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

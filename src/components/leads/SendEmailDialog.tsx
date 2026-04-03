import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Send, Loader2, Check } from "lucide-react";

interface Template {
  id: string;
  name: string;
  slug: string;
  subject: string;
  body_html: string;
  variables: string[];
  category: string;
}

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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(defaultTemplate || null);
  const [toEmail, setToEmail] = useState(lead.email || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) { setSent(false); return; }
    setToEmail(lead.email || "");
    setSelectedSlug(defaultTemplate || null);

    supabase
      .from("email_templates" as any)
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setTemplates(data as any);
      });
  }, [open, lead.email, defaultTemplate]);

  const selectedTemplate = templates.find((t) => t.slug === selectedSlug);

  const previewSubject = () => {
    if (!selectedTemplate) return "";
    let s = selectedTemplate.subject;
    const vars = { student_name: lead.name, ...defaultVariables };
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
    }
    return s;
  };

  const handleSend = async () => {
    if (!selectedSlug || !toEmail) return;
    setSending(true);

    const variables = { student_name: lead.name, ...defaultVariables };

    const { error } = await supabase.functions.invoke("send-email", {
      body: {
        template_slug: selectedSlug,
        to_email: toEmail,
        variables,
        lead_id: lead.id,
      },
    });

    setSending(false);
    if (error) {
      toast({ title: "Email failed", description: error.message, variant: "destructive" });
    } else {
      setSent(true);
      toast({ title: "Email sent", description: `Sent to ${toEmail}` });
      onSuccess?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
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
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                To <span className="text-destructive">*</span>
              </label>
              <input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-2">Select Template</label>
              <div className="space-y-1.5">
                {templates.map((t) => (
                  <button
                    key={t.slug}
                    onClick={() => setSelectedSlug(t.slug)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      selectedSlug === t.slug
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{t.name}</span>
                      <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
                    </div>
                  </button>
                ))}
                {templates.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No email templates configured</p>
                )}
              </div>
            </div>

            {selectedTemplate && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Preview Subject</p>
                <p className="text-sm text-foreground">{previewSubject()}</p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSend} disabled={!selectedSlug || !toEmail || sending} className="gap-2">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Email
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

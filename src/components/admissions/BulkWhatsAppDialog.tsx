import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Loader2, Check, AlertTriangle, Users } from "lucide-react";

const TEMPLATES = [
  { key: "lead_welcome", label: "Lead Welcome", description: "Welcome message with course info" },
  { key: "visit_confirmation", label: "Visit Confirmation", description: "Confirm scheduled campus visit" },
  { key: "visit_reminder_24hr", label: "Visit Reminder (24hr)", description: "Remind about upcoming visit" },
  { key: "application_received", label: "Application Received", description: "Acknowledge application submission" },
  { key: "fee_reminder", label: "Fee Reminder", description: "Remind about pending fee payment" },
  { key: "course_details", label: "Course Details + Brochure", description: "Send course information and brochure" },
];

interface Lead {
  id: string;
  name: string;
  phone: string;
}

interface BulkWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  onSuccess?: () => void;
}

export function BulkWhatsAppDialog({ open, onOpenChange, leads, onSuccess }: BulkWhatsAppDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedTemplate(null);
      setSending(false);
      setResult(null);
    }
  }, [open]);

  const validLeads = leads.filter((l) => l.phone && l.phone.trim());

  const handleSend = async () => {
    if (!selectedTemplate || validLeads.length === 0) return;
    setSending(true);

    // Get profile id for created_by
    let profileId: string | null = null;
    if (user?.id) {
      const { data: p } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = p?.id || null;
    }

    // Create campaign record
    const { data: campaign, error: campErr } = await supabase
      .from("whatsapp_campaigns" as any)
      .insert({
        name: `Bulk ${TEMPLATES.find((t) => t.key === selectedTemplate)?.label || selectedTemplate}`,
        template_key: selectedTemplate,
        total_recipients: validLeads.length,
        status: "sending",
        created_by: profileId,
      } as any)
      .select("id")
      .single();

    if (campErr || !campaign) {
      toast({ title: "Failed to create campaign", description: campErr?.message, variant: "destructive" });
      setSending(false);
      return;
    }

    // Insert recipients
    const recipients = validLeads.map((l) => ({
      campaign_id: (campaign as any).id,
      lead_id: l.id,
      phone: l.phone,
      status: "pending",
    }));
    await supabase.from("whatsapp_campaign_recipients" as any).insert(recipients as any);

    // Fire-and-forget: send via background edge function
    const { error: invokeErr } = await supabase.functions.invoke("whatsapp-campaign-send", {
      body: { campaign_id: (campaign as any).id },
    });

    if (invokeErr) {
      toast({ title: "Failed to start campaign", description: invokeErr.message, variant: "destructive" });
      setSending(false);
      return;
    }

    setResult({ sent: validLeads.length, failed: 0 });
    setSending(false);
    if (validLeads.length > 0) onSuccess?.();
    toast({ title: "Campaign queued", description: `Sending to ${validLeads.length} recipients in the background` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-green-600" />
            Bulk WhatsApp
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-4">
            <div className="rounded-xl bg-primary/5 border border-primary/10 p-6 text-center">
              <Check className="h-10 w-10 text-primary mx-auto mb-3" />
              <p className="text-lg font-semibold text-foreground">Campaign Complete</p>
              <div className="flex items-center justify-center gap-4 mt-3">
                <div>
                  <p className="text-2xl font-bold text-primary">{result.sent}</p>
                  <p className="text-xs text-muted-foreground">Sent</p>
                </div>
                {result.failed > 0 && (
                  <div>
                    <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} className="w-full">Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground font-medium">{validLeads.length} recipient{validLeads.length !== 1 ? "s" : ""}</span>
              {validLeads.length !== leads.length && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                  {leads.length - validLeads.length} without phone
                </Badge>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Select Template</p>
              <div className="space-y-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setSelectedTemplate(t.key)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      selectedTemplate === t.key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{t.label}</p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {validLeads.length > 50 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Sending to {validLeads.length} leads may take a few minutes. Do not close this dialog.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={!selectedTemplate || validLeads.length === 0 || sending}
                className="gap-2"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send to {validLeads.length}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

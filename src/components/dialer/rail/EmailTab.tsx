import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, Check } from "lucide-react";
import {
  EmailTemplatePicker, useEmailTemplates, fillEmailVars, sendEmailTemplate,
} from "@/components/leads/EmailTemplatePicker";

interface Props {
  leadId: string;
  leadName: string;
  active: boolean;
}

/**
 * The queue RPCs don't carry an email address (they're built for dialling), so
 * the rail fetches it on demand the first time this tab is opened. Address
 * stays editable, same as SendEmailDialog.
 */
export function EmailTab({ leadId, leadName, active }: Props) {
  const { toast } = useToast();
  const templates = useEmailTemplates(active);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [loadingEmail, setLoadingEmail] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelectedSlug(null);
    setSent(false);
    setToEmail("");
    setLoadingEmail(true);
    supabase.from("leads").select("email").eq("id", leadId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setToEmail((data as any)?.email || "");
        setLoadingEmail(false);
      });
    return () => { cancelled = true; };
  }, [leadId]);

  const selectedTemplate = templates.find(t => t.slug === selectedSlug);
  const vars = { student_name: leadName };

  const handleSend = async () => {
    if (!selectedSlug || !toEmail) return;
    setSending(true);
    const result = await sendEmailTemplate({ templateSlug: selectedSlug, toEmail, variables: vars, leadId });
    setSending(false);
    if (!result.ok) {
      toast({ title: "Email failed", description: result.error, variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "Email sent", description: `Sent to ${toEmail}` });
    setTimeout(() => setSent(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">To</label>
        <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
          placeholder={loadingEmail ? "Loading…" : "No email on lead — type one"}
          className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary" />
        {!loadingEmail && !toEmail && (
          <p className="text-[10px] text-warning-foreground">This lead has no email on file. Ask for one on the call.</p>
        )}
      </div>

      <EmailTemplatePicker templates={templates} selectedSlug={selectedSlug} onSelect={setSelectedSlug} />

      {selectedTemplate && (
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Subject</p>
            <p className="text-xs text-foreground">{fillEmailVars(selectedTemplate.subject, vars)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Body</p>
            {/* ponytail: templates are authored in-house, not user input — but
                strip tags rather than dangerouslySetInnerHTML for the preview. */}
            <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
              {fillEmailVars(selectedTemplate.body_html, vars)
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
                .replace(/<[^>]+>/g, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim()}
            </p>
          </div>
        </div>
      )}

      <Button onClick={handleSend} disabled={!selectedSlug || !toEmail || sending || sent} className="w-full gap-2">
        {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
          : sent ? <><Check className="h-4 w-4" /> Sent!</>
          : <><Send className="h-4 w-4" /> Send Email</>}
      </Button>
    </div>
  );
}

import { useState } from "react";
import { Link as LinkIcon, Copy, Check, MessageCircle, Loader2, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  compact?: boolean;
  /** Skip the share dialog: generate a short-lived link and open it in a new
   *  tab immediately (lets staff preview the portal as the student). */
  directOpen?: boolean;
}

const EXPIRY_OPTIONS: { label: string; hours: number }[] = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "14 days", hours: 336 },
  { label: "30 days", hours: 720 },
];

export function ApplyMagicLinkButton({ leadId, leadName, leadPhone, compact = false, directOpen = false }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(168);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);

  // supabase-js puts the function's response body on error.context for non-2xx
  // responses — extract the real server-side message instead of the generic
  // "Edge Function returned a non-2xx status code".
  const extractFnError = async (err: any): Promise<string> => {
    let detail = err?.message || "Unknown error";
    try {
      const ctx = err?.context;
      const body = typeof ctx?.json === "function"
        ? await ctx.json().catch(() => null)
        : ctx?.body
          ? JSON.parse(ctx.body)
          : null;
      if (body?.error) detail = body.error;
      else if (body?.message) detail = body.message;
    } catch { /* keep generic msg */ }
    return detail;
  };

  const generate = async () => {
    if (!leadPhone) {
      toast({ title: "Lead has no phone number", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-apply-link", {
        body: { lead_id: leadId, expires_in_hours: hours },
      });
      if (error) {
        const detail = await extractFnError(error);
        // Log to console too — toast is short, console keeps the full payload.
        console.error("[generate-apply-link] error:", error, "→", detail);
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      setGenerated({ url: data.url, expiresAt: data.expires_at });
    } catch (err: any) {
      toast({ title: "Failed to generate link", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const openAsStudent = async () => {
    if (!leadPhone) {
      toast({ title: "Lead has no phone number", variant: "destructive" });
      return;
    }
    setOpening(true);
    // Open a placeholder tab synchronously so the click is treated as
    // user-initiated by the popup blocker; we navigate it once the link
    // comes back. The apply portal now signs the visitor out of any
    // existing Supabase session before redeeming, so cross-tab session
    // contamination isn't a concern.
    const tab = window.open("about:blank", "_blank");
    try {
      const { data, error } = await supabase.functions.invoke("generate-apply-link", {
        body: { lead_id: leadId, expires_in_hours: 24 },
      });
      if (error) throw new Error(await extractFnError(error));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No link returned");
      if (tab) tab.location.href = data.url;
      else window.open(data.url, "_blank"); // popup-blocker fallback
    } catch (err: any) {
      if (tab) tab.close();
      toast({ title: "Failed to open as student", description: err.message, variant: "destructive" });
    } finally {
      setOpening(false);
    }
  };

  const copy = async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sendWhatsApp = () => {
    if (!generated || !leadPhone) return;
    const expiry = new Date(generated.expiresAt).toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
    });
    const message = `Hi ${leadName || "there"}, here is your secure login link for the NIMT application portal. You can complete your application and pay the token fee directly:\n\n${generated.url}\n\nThis link is valid until ${expiry}.`;
    const phoneDigits = leadPhone.replace(/\D/g, "");
    const url = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  const reset = () => {
    setGenerated(null);
    setCopied(false);
  };

  // Direct-open mode: bypass the share dialog and open the portal in a new tab
  // immediately. Two flavours — compact icon (table cells) and labelled button.
  if (directOpen) {
    return compact ? (
      <button
        onClick={openAsStudent}
        disabled={!leadPhone || opening}
        className="p-1.5 hover:bg-muted text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title={leadPhone ? "View as Student (opens portal in new tab)" : "No phone number on lead"}
      >
        {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
      </button>
    ) : (
      <Button size="sm" variant="outline" className="gap-2" onClick={openAsStudent} disabled={!leadPhone || opening}>
        {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
        View as Student
      </Button>
    );
  }

  const trigger = compact ? (
    <button
      onClick={() => { reset(); setOpen(true); }}
      disabled={!leadPhone}
      className="p-1.5 hover:bg-muted text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      title={leadPhone ? "Send Login Link" : "No phone number on lead"}
    >
      <LinkIcon className="h-3.5 w-3.5" />
    </button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="gap-2"
      onClick={() => { reset(); setOpen(true); }}
      disabled={!leadPhone}
    >
      <LinkIcon className="h-3.5 w-3.5" />
      Send Login Link
    </Button>
  );

  return (
    <>
      {trigger}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md w-[min(92vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Apply Portal Login Link</DialogTitle>
          </DialogHeader>

          {!generated ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a one-click login link for {leadName || "this lead"} so they can access the application portal directly without an OTP. The link is valid for the duration you choose and can be reused until it expires.
              </p>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Validity</label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.hours}
                      type="button"
                      onClick={() => setHours(opt.hours)}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        hours === opt.hours
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={generate} disabled={generating || !leadPhone} className="w-full">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate Link"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Link valid until <span className="font-medium text-foreground">
                  {new Date(generated.expiresAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
                </span>.
              </p>

              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 overflow-hidden">
                <code className="flex-1 min-w-0 break-all text-xs text-foreground leading-snug" title={generated.url}>{generated.url}</code>
                <button
                  onClick={copy}
                  className="shrink-0 rounded-md p-1.5 hover:bg-background transition-colors"
                  aria-label="Copy link"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={copy}>
                  {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
                </Button>
                <Button onClick={sendWhatsApp} className="bg-green-600 hover:bg-green-700">
                  <MessageCircle className="h-4 w-4" /> Send via WhatsApp
                </Button>
              </div>

              <button
                onClick={reset}
                className="w-full text-xs text-muted-foreground hover:text-foreground"
              >
                Generate a different link
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

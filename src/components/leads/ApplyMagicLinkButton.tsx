import { useState } from "react";
import { Link as LinkIcon, Copy, Check, MessageCircle, Loader2, LogIn, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface Props {
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  compact?: boolean;
  mode?: "student" | "academic_partner_on_behalf";
  label?: string;
  startNew?: boolean;
  /** Skip the share dialog: generate a short-lived link and open it in a new
   *  tab immediately (lets staff preview the portal as the student). */
  directOpen?: boolean;
  /** Render as a dropdown-menu item instead of a standalone button.
   *  (Direct-open only — for the share dialog use the controlled mode below.) */
  asMenuItem?: boolean;
  /** Controlled, trigger-less mode: render just the share dialog, open state
   *  driven by the parent. Used to surface "Send Login Link" from a menu
   *  without nesting a Dialog inside a (self-unmounting) dropdown. */
  controlledOpen?: boolean;
  onControlledOpenChange?: (open: boolean) => void;
}

const EXPIRY_OPTIONS: { label: string; hours: number }[] = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "14 days", hours: 336 },
  { label: "30 days", hours: 720 },
];

const getErrorMessage = (err: unknown, fallback = "Unknown error") => {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
};

export function ApplyMagicLinkButton({
  leadId,
  leadName,
  leadPhone,
  compact = false,
  mode = "student",
  label,
  startNew = false,
  directOpen = false,
  asMenuItem = false,
  controlledOpen,
  onControlledOpenChange,
}: Props) {
  const { toast } = useToast();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => {
    if (isControlled) onControlledOpenChange?.(o);
    else setInternalOpen(o);
  };
  const [hours, setHours] = useState(168);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);

  // supabase-js puts the function's response body on error.context for non-2xx
  // responses — extract the real server-side message instead of the generic
  // "Edge Function returned a non-2xx status code".
  const extractFnError = async (err: unknown): Promise<string> => {
    let detail = getErrorMessage(err);
    try {
      const ctx = (err as { context?: { json?: () => Promise<unknown>; body?: string } })?.context;
      const body = typeof ctx?.json === "function"
        ? await ctx.json().catch(() => null)
        : ctx?.body
          ? JSON.parse(ctx.body)
          : null;
      const fnBody = body as { error?: unknown; message?: unknown } | null;
      if (typeof fnBody?.error === "string") detail = fnBody.error;
      else if (typeof fnBody?.message === "string") detail = fnBody.message;
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
        body: { lead_id: leadId, expires_in_hours: hours, mode },
      });
      if (error) {
        const detail = await extractFnError(error);
        // Log to console too — toast is short, console keeps the full payload.
        console.error("[generate-apply-link] error:", error, "→", detail);
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      const url = startNew ? `${data.url}${data.url.includes("?") ? "&" : "?"}start_new=1` : data.url;
      setGenerated({ url, expiresAt: data.expires_at });
    } catch (err: unknown) {
      toast({ title: "Failed to generate link", description: getErrorMessage(err), variant: "destructive" });
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
        body: { lead_id: leadId, expires_in_hours: 24, mode },
      });
      if (error) throw new Error(await extractFnError(error));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No link returned");
      const url = startNew ? `${data.url}${data.url.includes("?") ? "&" : "?"}start_new=1` : data.url;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank"); // popup-blocker fallback
    } catch (err: unknown) {
      if (tab) tab.close();
      toast({ title: "Failed to open as student", description: getErrorMessage(err), variant: "destructive" });
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

  const openGeneratedLink = async () => {
    if (!generated) return;
    const tab = window.open(generated.url, "_blank", "noopener,noreferrer");
    if (tab) {
      tab.opener = null;
      return;
    }

    await navigator.clipboard.writeText(generated.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({
      title: "Popup blocked",
      description: "Link copied. Open an incognito window and paste it there.",
    });
  };

  const [sendingWa, setSendingWa] = useState(false);

  const sendWhatsApp = async () => {
    if (!generated || !leadPhone) return;
    setSendingWa(true);
    try {
      const expiry = new Date(generated.expiresAt).toLocaleString("en-IN", {
        day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
      });
      // Extract the token from the magic-link URL — the apply_portal_login
      // template's URL button has a fixed prefix (https://uni.nimt.ac.in/apply?token=)
      // and takes the token as its dynamic suffix.
      const tokenMatch = generated.url.match(/[?&]token=([^&]+)/);
      const token = tokenMatch?.[1];
      if (!token) {
        toast({ title: "Couldn't parse token from link", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          template_key: "apply_portal_login",
          phone: leadPhone,
          params: [leadName || "there", expiry],
          button_urls: [token],
          lead_id: leadId,
        },
      });
      if (error) throw new Error(await extractFnError(error));
      if (data?.error) throw new Error(data.error);
      toast({ title: "Apply link sent on WhatsApp", description: `Delivered to ${leadPhone}.` });
    } catch (err: unknown) {
      toast({
        title: "Couldn't send via WhatsApp",
        description: getErrorMessage(err, "Template may still be pending Meta approval - try again in a few minutes."),
        variant: "destructive",
      });
    } finally {
      setSendingWa(false);
    }
  };

  const reset = () => {
    setGenerated(null);
    setCopied(false);
  };

  const menuLabel = label || (mode === "academic_partner_on_behalf"
    ? (directOpen ? "Open Application" : "Copy On-Behalf Link")
    : (directOpen ? "View as Student" : "Send Login Link"));

  const shareDialog = (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md w-[min(92vw,28rem)]">
        <DialogHeader>
          <DialogTitle>{mode === "academic_partner_on_behalf" ? "On-Behalf Application Link" : "Apply Portal Login Link"}</DialogTitle>
        </DialogHeader>

        {!generated ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {mode === "academic_partner_on_behalf"
                ? `Generate a scoped link so you can complete the application for ${leadName || "this lead"}. Actions are audited under your academic partner account.`
                : `Generate a one-click login link for ${leadName || "this lead"} so they can access the application portal directly without an OTP. The link is valid for the duration you choose and can be reused until it expires.`}
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
              {generating ? <ButtonOrb state="composing" onFilled /> : "Generate Link"}
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
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="pill-outline" size="pill" onClick={openGeneratedLink}>
                <ExternalLink className="h-4 w-4" /> Open
              </Button>
              <Button variant="pill-outline" size="pill" onClick={copy}>
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
              </Button>
              <Button variant="pill" size="pill" onClick={sendWhatsApp} className="bg-success hover:bg-success/60">
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
  );

  // Controlled, trigger-less mode: just the dialog, driven by the parent.
  if (isControlled) return shareDialog;

  // Menu-item mode: direct-open actions are a plain onClick, so they nest
  // safely in a dropdown. (Dialog actions can't — the dropdown unmounts them
  // when it closes; use controlled mode for those instead.)
  if (asMenuItem && directOpen) {
    return (
      <DropdownMenuItem disabled={!leadPhone || opening} onSelect={() => openAsStudent()}>
        {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
        {menuLabel}
      </DropdownMenuItem>
    );
  }

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
        {opening ? <ButtonOrb state="composing" /> : <LogIn className="h-3.5 w-3.5" />}
      </button>
    ) : (
      <Button size="sm" variant="outline" className="gap-2" onClick={openAsStudent} disabled={!leadPhone || opening}>
        {opening ? <ButtonOrb state="composing" /> : <LogIn className="h-3.5 w-3.5" />}
        {label || (mode === "academic_partner_on_behalf" ? "Complete Application" : "View as Student")}
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
      {label || (mode === "academic_partner_on_behalf" ? "Copy On-Behalf Link" : "Send Login Link")}
    </Button>
  );

  return (
    <>
      {trigger}
      {shareDialog}
    </>
  );
}

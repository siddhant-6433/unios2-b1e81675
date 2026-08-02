import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import uniosLogo from "@/assets/unios-logo.png";
import { Loader2, AlertCircle, CheckCircle, CreditCard, ShieldCheck } from "lucide-react";

// Public payment-link landing page.
// - Razorpay hosted: branded page first, forward to short_url on Pay click
// - Razorpay checkout: Standard Checkout on this page
// - Easebuzz: open pay_url popup and poll until payment_links.status=paid

type Step = "loading" | "ready" | "paying" | "done" | "error";

interface Resolved {
  payer_name: string;
  amount: number;
  purpose: string;
  purpose_label: string;
  note: string | null;
  status: string;
  gateway: string | null;
  short_url: string | null;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("razorpay-checkout-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "razorpay-checkout-js";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay."));
    document.body.appendChild(script);
  });
}

export default function PayLink() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<Resolved | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const popupRef = useRef<Window | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const callFn = async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error: fnErr } = await supabase.functions.invoke("pay-link", {
      body: { action, token, ...extra },
    });
    if (fnErr) {
      const ctx = (fnErr as { context?: { text?: () => Promise<string> } }).context;
      const text = await ctx?.text?.().catch(() => "");
      let msg = fnErr.message;
      try { msg = JSON.parse(text || "{}").error || msg; } catch { /* keep */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (!token) { setStep("error"); setError("Missing payment token."); return; }
    (async () => {
      try {
        let data = (await callFn("resolve")) as Resolved;
        setLink(data);
        // Razorpay hosted-link callback: the payer lands back here with
        // signature params. Verify + settle server-side, then re-resolve.
        const qs = new URLSearchParams(window.location.search);
        const cbLinkId = qs.get("razorpay_payment_link_id");
        const cbSignature = qs.get("razorpay_signature");
        if (data.status === "active" && cbLinkId && cbSignature) {
          try {
            await callFn("verify-link-callback", {
              razorpay_payment_link_id: cbLinkId,
              razorpay_payment_link_reference_id: qs.get("razorpay_payment_link_reference_id") || "",
              razorpay_payment_link_status: qs.get("razorpay_payment_link_status") || "",
              razorpay_payment_id: qs.get("razorpay_payment_id") || "",
              razorpay_signature: cbSignature,
            });
          } catch (e) {
            console.error("[PayLink] callback verification failed:", e);
          }
          data = (await callFn("resolve")) as Resolved;
          setLink(data);
        }
        if (data.status === "paid") { setStep("done"); return; }
        if (data.status !== "active") { setStep("error"); setError(`This link is ${data.status}.`); return; }
        // Render the branded page instead of bouncing to data.short_url on
        // load. That redirect meant nobody ever saw a UniOs-branded payment
        // page — not even the WhatsApp recipients whose button pointed here.
        // handlePay() forwards to the hosted checkout on click, so Razorpay's
        // reminders and payment-link webhook still settle the same artifact.
        setStep("ready");
      } catch (e) {
        setStep("error");
        setError(e instanceof Error ? e.message : "Could not load this payment link.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const pollUntilPaid = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const data = (await callFn("resolve")) as Resolved;
        setLink(data);
        if (data.status === "paid") {
          stopPolling();
          if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
          setStep("done");
        }
      } catch {
        // keep polling
      }
    }, 2000);
  };

  const handlePayEasebuzz = async () => {
    if (!link) return;
    setStep("paying");
    setError(null);
    try {
      const order = await callFn("create-order", { gateway: "easebuzz" });
      if (!order?.pay_url) throw new Error("Could not start Easebuzz checkout.");
      popupRef.current = window.open(
        order.pay_url,
        "easebuzz_pay_link",
        "width=680,height=720,scrollbars=yes,resizable=yes",
      );
      if (!popupRef.current) {
        throw new Error("Popup was blocked. Please allow popups and try again.");
      }
      pollUntilPaid();
      // Also stop when popup closes
      const closeWatch = setInterval(async () => {
        if (popupRef.current?.closed) {
          clearInterval(closeWatch);
          try {
            const data = (await callFn("resolve")) as Resolved;
            setLink(data);
            if (data.status === "paid") {
              stopPolling();
              setStep("done");
              return;
            }
          } catch { /* ignore */ }
          stopPolling();
          setStep("ready");
          setError("Payment window closed. If money was deducted it will update automatically within a few minutes.");
        }
      }, 800);
    } catch (e) {
      stopPolling();
      setStep("ready");
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
    }
  };

  const handlePayRazorpay = async () => {
    if (!link) return;
    setStep("paying");
    setError(null);
    try {
      await loadRazorpayScript();
      const order = await callFn("create-order", { gateway: "razorpay" });
      const key = order.key_id;
      if (!key || !window.Razorpay) throw new Error("Payment gateway unavailable.");
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key,
          amount: order.amount,
          currency: order.currency || "INR",
          name: "NIMT Educational Institutions",
          description: link.purpose_label,
          order_id: order.order_id,
          prefill: { name: link.payer_name },
          theme: { color: "#33B063" },
          handler: async (resp: Record<string, string>) => {
            try {
              await callFn("verify", {
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              });
              resolve();
            } catch (e) {
              reject(e instanceof Error ? e : new Error("Verification failed."));
            }
          },
          modal: { ondismiss: () => reject(new Error("Payment was cancelled.")) },
        });
        rzp.open();
      });
      setStep("done");
    } catch (e) {
      setStep("ready");
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
    }
  };

  const handlePay = () => {
    // A gateway-hosted link is the artifact that carries Razorpay's own
    // reminders and the payment-link webhook that settles the receipt, so the
    // payer must finish there. We just no longer jump on page load — they see
    // the branded page with our logo, amount and their name first, and the URL
    // we hand out everywhere stays /pay/<token>.
    if (link?.short_url) {
      window.location.href = link.short_url;
      return;
    }
    const gw = (link?.gateway || "razorpay").toLowerCase();
    if (gw === "easebuzz") return handlePayEasebuzz();
    return handlePayRazorpay();
  };

  const gatewayLabel = (link?.gateway || "razorpay").toLowerCase() === "easebuzz"
    ? "Easebuzz"
    : "Razorpay";

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-sm p-6">
        <img src={uniosLogo} alt="NIMT" className="h-10 mx-auto mb-4" />

        {step === "loading" && (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <p className="text-sm">Loading payment details…</p>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm text-foreground">{error || "This link is not available."}</p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle className="h-10 w-10 text-success mb-2" />
            <p className="text-base font-semibold text-foreground">Payment received</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Thank you{link ? `, ${link.payer_name}` : ""}. Your receipt will be sent to you shortly.
            </p>
          </div>
        )}

        {(step === "ready" || step === "paying") && link && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{link.purpose_label}</p>
              <p className="mt-1 text-3xl font-bold text-foreground">
                ₹{Number(link.amount).toLocaleString("en-IN")}
              </p>
              {link.note && <p className="mt-1 text-sm text-muted-foreground">{link.note}</p>}
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Payer: </span>
              <span className="font-medium text-foreground">{link.payer_name}</span>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={handlePay}
              disabled={step === "paying"}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {step === "paying" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {step === "paying" ? "Processing…" : `Pay ₹${Number(link.amount).toLocaleString("en-IN")}`}
            </button>
            <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Secured by {gatewayLabel}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, CreditCard, CheckCircle, Shield, AlertCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { usePaymentGateways } from "@/hooks/usePaymentGateways";
import { ApplicationData } from "./types";
import { usePortal } from "./PortalContext";
import { ReceiptDialog, ReceiptData } from "@/components/receipts/ReceiptDialog";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack?: () => void;
  saving: boolean;
}

declare global {
  interface Window {
    Cashfree: any;
  }
}

export function PaymentSection({ data, onChange, onNext, onBack, saving }: Props) {
  const isPaid   = data.payment_status === "paid";
  const isWaived = data.fee_amount === 0;
  const portal   = usePortal();

  const [showReceipt, setShowReceipt] = useState(false);

  // If full_name was populated with an email (Google auth fallback), treat it as email
  const nameIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.full_name || "");
  const receiptData: ReceiptData = {
    type: "application_fee",
    application_id: data.application_id,
    applicant_name: nameIsEmail ? undefined : data.full_name,
    phone: data.phone,
    email: data.email || (nameIsEmail ? data.full_name : undefined),
    amount: data.fee_amount,
    payment_ref: data.payment_ref,
    payment_date: new Date().toISOString(),
    institution_name: portal.name,
    campus_name: data.course_selections[0]?.campus_name,
    logo: portal.logo,
    primaryColor: portal.primaryColor,
  };

  const { portalGateways, loading: gwLoading } = usePaymentGateways();
  const [selectedGateway, setSelectedGateway] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const cashfreeRef = useRef<any>(null);
  const popupRef    = useRef<Window | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-select single gateway
  useEffect(() => {
    if (!gwLoading && portalGateways.length === 1) {
      setSelectedGateway(portalGateways[0].gateway);
    }
  }, [gwLoading, portalGateways]);

  // Load Cashfree JS SDK only when cashfree is selected
  useEffect(() => {
    if (isWaived || isPaid || selectedGateway !== "cashfree") return;
    if (document.getElementById("cashfree-sdk")) { setSdkReady(true); return; }
    const script = document.createElement("script");
    script.id = "cashfree-sdk";
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.onload = () => setSdkReady(true);
    document.body.appendChild(script);
  }, [isWaived, isPaid, selectedGateway]);

  // Reset sdkReady when gateway changes
  useEffect(() => {
    setSdkReady(false);
    if (selectedGateway === "cashfree" && document.getElementById("cashfree-sdk")) setSdkReady(true);
    if (selectedGateway === "easebuzz") setSdkReady(true); // No SDK needed for popup approach
  }, [selectedGateway]);

  // Cleanup poll on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Listen for postMessage from EaseBuzz popup
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.eb_payment === "success") {
        stopPolling();
        checkAndUpdatePayment();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [data.application_id]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const checkAndUpdatePayment = async () => {
    const { data: row } = await supabase
      .from("applications")
      .select("payment_status, payment_ref")
      .eq("application_id", data.application_id)
      .single();

    if (row?.payment_status === "paid") {
      stopPolling();
      onChange({ payment_status: "paid", payment_ref: row.payment_ref ?? undefined });
      setLoading(false);
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    }
  };

  const handleMarkPaid = () => onChange({ payment_status: "paid" });

  // ── Cashfree ────────────────────────────────────────────────────
  const handlePayCashfree = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke("cashfree-payment", {
        body: {
          action: "create-order",
          application_id: data.application_id,
          amount: data.fee_amount,
          customer_name: data.full_name,
          customer_phone: data.phone,
          customer_email: data.email || undefined,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (fnData?.error) throw new Error(fnData.error);

      const { order_id, payment_session_id } = fnData;

      if (!cashfreeRef.current) {
        cashfreeRef.current = window.Cashfree({ mode: import.meta.env.DEV ? "sandbox" : "production" });
      }

      cashfreeRef.current
        .checkout({ paymentSessionId: payment_session_id, redirectTarget: "_modal" })
        .then(async (result: any) => {
          if (result.error) {
            setError(result.error.message || "Payment failed. Please try again.");
            setLoading(false);
            return;
          }
          const { data: verifyData, error: verifyError } = await supabase.functions.invoke("cashfree-payment", {
            body: { action: "verify-payment", order_id },
          });
          if (verifyError) throw new Error(verifyError.message);
          if (verifyData?.order_status === "PAID") {
            onChange({ payment_status: "paid", payment_ref: order_id });
          } else {
            setError("Payment could not be confirmed. If amount was deducted, contact support.");
          }
          setLoading(false);
        })
        .catch((err: any) => {
          setError(err?.message || "Payment was cancelled.");
          setLoading(false);
        });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  // ── EaseBuzz (popup + polling) ──────────────────────────────────
  const handlePayEasebuzz = async () => {
    setError(null);
    setLoading(true);
    try {
      const nameParts = (data.full_name || "Applicant").trim().split(" ");
      const txnid = `EB${data.application_id.replace(/[^a-zA-Z0-9]/g, "")}${Date.now()}`.slice(0, 50);

      const { data: fnData, error: fnError } = await supabase.functions.invoke("easebuzz-payment", {
        body: {
          action: "initiate",
          application_id: data.application_id,
          txnid,
          amount: data.fee_amount,
          productinfo: "Application Fee",
          firstname: nameParts[0],
          email: data.email || undefined,
          phone: data.phone,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (fnData?.error) throw new Error(fnData.error);

      const { pay_url } = fnData;

      // Open EaseBuzz hosted payment page in popup
      popupRef.current = window.open(
        pay_url,
        "easebuzz_payment",
        "width=680,height=720,scrollbars=yes,resizable=yes"
      );

      if (!popupRef.current) {
        throw new Error("Popup was blocked. Please allow popups for this site and try again.");
      }

      // Poll Supabase every 2s for payment confirmation
      pollRef.current = setInterval(async () => {
        // If popup closed, do a final DB + verify check
        if (popupRef.current?.closed) {
          stopPolling();

          // Check DB first (surl handler may have already updated it)
          const { data: row } = await supabase
            .from("applications")
            .select("payment_status, payment_ref")
            .eq("application_id", data.application_id)
            .single();

          if (row?.payment_status === "paid") {
            onChange({ payment_status: "paid", payment_ref: row.payment_ref ?? undefined });
            setLoading(false);
            return;
          }

          // Fallback: verify via EaseBuzz transaction API
          try {
            const { data: verifyData } = await supabase.functions.invoke("easebuzz-payment", {
              body: { action: "verify-payment", txnid },
            });
            if (verifyData?.status?.toLowerCase() === "success") {
              onChange({ payment_status: "paid", payment_ref: verifyData.easepayid || txnid });
              setLoading(false);
              return;
            }
          } catch (_) { /* ignore */ }

          setError("Payment window was closed. If your payment was deducted, it will be confirmed shortly — or contact support.");
          setLoading(false);
          return;
        }

        await checkAndUpdatePayment();
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handlePay = () => {
    if (selectedGateway === "easebuzz") return handlePayEasebuzz();
    return handlePayCashfree();
  };

  const activeGatewayName =
    portalGateways.find((g) => g.gateway === selectedGateway)?.display_name ?? "Pay";

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-foreground">Application Fee</h2>

      {isWaived ? (
        <div className="text-center py-8">
          <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No application fee required</p>
          <p className="text-xs text-muted-foreground mt-1">This programme has zero application fee.</p>
        </div>
      ) : isPaid ? (
        <div className="text-center py-8 space-y-3">
          <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Application fee paid</p>
          <p className="text-xs text-muted-foreground">
            {data.payment_ref ? `Ref: ${data.payment_ref}` : "You can proceed to the next step."}
          </p>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowReceipt(true)}>
            <Receipt className="h-4 w-4" /> View Receipt
          </Button>
        </div>
      ) : (
        <div className="text-center py-8 space-y-4">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mx-auto">
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">₹{data.fee_amount.toLocaleString("en-IN")}</p>
            <p className="text-sm text-muted-foreground">Application Processing Fee</p>
          </div>

          {data.course_selections.length > 1 && (
            <div className="text-xs text-muted-foreground max-w-sm mx-auto space-y-1">
              {data.course_selections.map((cs, i) => (
                <div key={i} className="flex justify-between px-4">
                  <span>{cs.course_name}</span>
                  <span className="font-medium">
                    ₹{(data.fee_amount / data.course_selections.length).toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Gateway selector — only shown when multiple enabled */}
          {!gwLoading && portalGateways.length > 1 && (
            <div className="flex justify-center gap-3 flex-wrap">
              {portalGateways.map((gw) => (
                <button
                  key={gw.gateway}
                  onClick={() => setSelectedGateway(gw.gateway)}
                  className={`rounded-xl border px-4 py-2 text-xs font-medium transition-colors ${
                    selectedGateway === gw.gateway
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {gw.display_name}
                </button>
              ))}
            </div>
          )}

          {gwLoading && (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!gwLoading && portalGateways.length === 0 && (
            <div className="flex items-center gap-2 text-destructive text-xs max-w-sm mx-auto bg-destructive/10 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Online payment is currently unavailable. Please contact the admissions office.</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs max-w-sm mx-auto bg-destructive/10 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!gwLoading && portalGateways.length > 0 && (
            <>
              <Button
                onClick={handlePay}
                disabled={loading || (!sdkReady && selectedGateway === "cashfree") || saving || !selectedGateway}
                className="gap-2 px-8"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />
                    {selectedGateway === "easebuzz" ? "Opening payment window…" : "Processing…"}
                  </>
                ) : (
                  <><CreditCard className="h-4 w-4" /> Pay ₹{data.fee_amount.toLocaleString("en-IN")}</>
                )}
              </Button>

              {loading && selectedGateway === "easebuzz" && (
                <p className="text-xs text-muted-foreground">
                  Complete payment in the popup window. Do not close this page.
                </p>
              )}

              <p className="text-xs text-muted-foreground">Secured by {activeGatewayName}</p>
            </>
          )}

          {import.meta.env.DEV && (
            <Button onClick={handleMarkPaid} disabled={saving} variant="outline" size="sm" className="gap-2 opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <Shield className="h-4 w-4" /> Mark as Paid (Dev)
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : <div />}
        <Button onClick={onNext} disabled={!isPaid && !isWaived} className="gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {showReceipt && (
        <ReceiptDialog data={receiptData} onClose={() => setShowReceipt(false)} />
      )}
    </div>
  );
}

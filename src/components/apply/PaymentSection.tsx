import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, CreditCard, CheckCircle, Shield, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}

declare global {
  interface Window {
    Cashfree: any;
  }
}

export function PaymentSection({ data, onChange, onNext, onBack, saving }: Props) {
  const isPaid = data.payment_status === 'paid';
  const isWaived = data.fee_amount === 0;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const cashfreeRef = useRef<any>(null);

  // Load Cashfree JS SDK
  useEffect(() => {
    if (isWaived || isPaid) return;
    if (document.getElementById("cashfree-sdk")) {
      setSdkReady(true);
      return;
    }
    const script = document.createElement("script");
    script.id = "cashfree-sdk";
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.onload = () => setSdkReady(true);
    document.body.appendChild(script);
  }, [isWaived, isPaid]);

  const handleMarkPaid = () => {
    onChange({ payment_status: 'paid' });
  };

  const handlePay = async () => {
    setError(null);
    setLoading(true);
    try {
      // 1. Create Cashfree order
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

      // 2. Init Cashfree SDK and open checkout
      if (!cashfreeRef.current) {
        cashfreeRef.current = window.Cashfree({ mode: import.meta.env.DEV ? "sandbox" : "production" });
      }

      cashfreeRef.current.checkout({
        paymentSessionId: payment_session_id,
        redirectTarget: "_modal",
      }).then(async (result: any) => {
        if (result.error) {
          setError(result.error.message || "Payment failed. Please try again.");
          setLoading(false);
          return;
        }

        // 3. Verify payment with backend
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
      }).catch((err: any) => {
        setError(err?.message || "Payment was cancelled.");
        setLoading(false);
      });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

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
        <div className="text-center py-8">
          <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Application fee paid</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.payment_ref ? `Ref: ${data.payment_ref}` : "You can proceed to the next step."}
          </p>
        </div>
      ) : (
        <div className="text-center py-8 space-y-4">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mx-auto">
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">₹{data.fee_amount.toLocaleString('en-IN')}</p>
            <p className="text-sm text-muted-foreground">Application Processing Fee</p>
          </div>

          {data.course_selections.length > 1 && (
            <div className="text-xs text-muted-foreground max-w-sm mx-auto space-y-1">
              {data.course_selections.map((cs, i) => (
                <div key={i} className="flex justify-between px-4">
                  <span>{cs.course_name}</span>
                  <span className="font-medium">₹{(data.fee_amount / data.course_selections.length).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs max-w-sm mx-auto bg-destructive/10 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={handlePay}
            disabled={loading || !sdkReady || saving}
            className="gap-2 px-8"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
            ) : (
              <><CreditCard className="h-4 w-4" /> Pay ₹{data.fee_amount.toLocaleString('en-IN')}</>
            )}
          </Button>

          <p className="text-xs text-muted-foreground">Secured by Cashfree Payments</p>

          {import.meta.env.DEV && (
            <Button onClick={handleMarkPaid} disabled={saving} variant="outline" size="sm" className="gap-2 opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <Shield className="h-4 w-4" /> Mark as Paid (Dev)
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!isPaid && !isWaived} className="gap-2">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

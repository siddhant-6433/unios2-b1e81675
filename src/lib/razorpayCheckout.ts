import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: { error?: { description?: string; reason?: string } }) => void) => void;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
};

type RazorpayOrder = {
  order_id: string;
  amount: number;
  currency: string;
  key_id?: string;
};

type FunctionErrorWithContext = Error & {
  context?: {
    json?: () => Promise<{ error?: string }>;
  };
};

export type RazorpayCheckoutInput = {
  amountPaise: number;
  receipt: string;
  context: "application_fee" | "token_fee" | "student_fee" | "lead_payment" | "generic";
  description: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  applicationId?: string | null;
  leadId?: string | null;
  paymentType?: string;
  studentId?: string | null;
  paymentScope?: string;
  feeIds?: string[];
  waiverAmount?: number;
  productInfo?: string;
  concessionAmount?: number;
  waiverReason?: string | null;
  concessionBreakdown?: Record<string, number> | null;
};

export type RazorpayCheckoutResult = {
  paymentId: string;
  orderId: string;
  already?: boolean;
};

const RAZORPAY_SCRIPT_ID = "razorpay-checkout-js";

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  const existing = document.getElementById(RAZORPAY_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay Checkout.")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = RAZORPAY_SCRIPT_ID;
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
    document.body.appendChild(script);
  });
}

async function postRazorpay(
  action: "create-order" | "verify-payment" | "reconcile-order",
  body: Record<string, unknown>,
) {
  const endpoint =
    action === "create-order" ? "/api/create-order"
    : action === "verify-payment" ? "/api/verify-payment"
    : "/api/reconcile-order";

  // Prefer Netlify proxy, but always fall back to authenticated edge invoke.
  // Production must not throw away the fallback path on proxy failures.
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      if (response.ok && !data?.error) return data;
      // Fall through to edge invoke on non-OK so missing proxy auth can't brick payments.
      if (import.meta.env.DEV && data?.error) {
        // In dev keep trying edge path too.
      }
    }
  } catch {
    // Fall through to edge invoke.
  }

  const { data, error } = await supabase.functions.invoke("razorpay-payment", {
    body: { action, ...body },
  });
  if (error) {
    let detail = error.message;
    try {
      const context = (error as FunctionErrorWithContext).context;
      const parsed = typeof context?.json === "function" ? await context.json() : null;
      if (parsed?.error) detail = parsed.error;
    } catch {
      // Keep the original Supabase function error.
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Best-effort server reconcile when browser verify was missed. Never double-marks. */
export async function reconcileRazorpayOrder(input: {
  orderId?: string | null;
  applicationId?: string | null;
  context?: string | null;
}) {
  if (!input.orderId && !input.applicationId) {
    throw new Error("orderId or applicationId is required to reconcile");
  }
  return postRazorpay("reconcile-order", {
    order_id: input.orderId || undefined,
    application_id: input.applicationId || undefined,
    context: input.context || undefined,
  });
}

function shortReceipt(prefix: string, id?: string | null) {
  const cleanId = (id || "payment").replace(/[^A-Za-z0-9_-]/g, "").slice(-18);
  return `${prefix}_${cleanId}_${Date.now()}`.slice(0, 40);
}

export async function openRazorpayCheckout(input: RazorpayCheckoutInput): Promise<RazorpayCheckoutResult> {
  await loadRazorpayScript();
  const RazorpayConstructor = window.Razorpay;
  if (!RazorpayConstructor) throw new Error("Razorpay Checkout is unavailable.");

  const order = await postRazorpay("create-order", {
    amount: input.amountPaise,
    currency: "INR",
    receipt: input.receipt || shortReceipt("rzp", input.applicationId || input.leadId || input.studentId),
    context: input.context,
    application_id: input.applicationId || undefined,
    lead_id: input.leadId || undefined,
    payment_type: input.paymentType || undefined,
    student_id: input.studentId || undefined,
    payment_scope: input.paymentScope || undefined,
    fee_ids: input.feeIds || undefined,
    waiver_amount: input.waiverAmount || undefined,
    productinfo: input.productInfo || input.description,
    customer_name: input.customerName || undefined,
    customer_email: input.customerEmail || undefined,
    customer_phone: input.customerPhone || undefined,
    concession_amount: input.concessionAmount || undefined,
    waiver_reason: input.waiverReason || undefined,
    concession_breakdown: input.concessionBreakdown || undefined,
  }) as RazorpayOrder;

  const key = order.key_id || import.meta.env.VITE_RAZORPAY_KEY_ID;
  if (!key) throw new Error("Razorpay key ID is not configured.");

  return new Promise<RazorpayCheckoutResult>((resolve, reject) => {
    let settled = false;
    let capture: RazorpayResponse | null = null;
    let settling = false;

    const finishSuccess = (paymentId: string, orderId: string, already?: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ paymentId, orderId, already });
    };

    const settleCapture = async (response: RazorpayResponse) => {
      if (settling || settled) return;
      settling = true;
      capture = response;
      try {
        const verified = await postRazorpay("verify-payment", {
          order_id: order.order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
          context: input.context,
        });
        if (!verified?.success) throw new Error("Payment could not be verified.");
        finishSuccess(response.razorpay_payment_id, order.order_id, Boolean(verified.already));
      } catch (verifyError) {
        // Money may already be captured — try server reconcile (idempotent).
        try {
          const reconciled = await postRazorpay("reconcile-order", {
            order_id: order.order_id,
            application_id: input.applicationId || undefined,
            context: input.context,
          });
          if (reconciled?.success && reconciled.payment_id) {
            finishSuccess(String(reconciled.payment_id), order.order_id, Boolean(reconciled.already));
            return;
          }
        } catch {
          // Fall through to original verify error.
        }
        settling = false;
        reject(verifyError instanceof Error ? verifyError : new Error("Payment verification failed."));
      }
    };

    const checkout = new RazorpayConstructor({
      key,
      amount: order.amount,
      currency: order.currency || "INR",
      name: "NIMT Educational Institutions",
      description: input.description,
      order_id: order.order_id,
      prefill: {
        name: input.customerName || undefined,
        email: input.customerEmail || undefined,
        contact: input.customerPhone || undefined,
      },
      notes: {
        context: input.context,
        application_id: input.applicationId || "",
        lead_id: input.leadId || "",
        student_id: input.studentId || "",
      },
      theme: { color: "#33B063" },
      handler: (response) => {
        void settleCapture(response);
      },
      modal: {
        ondismiss: () => {
          if (settled) return;
          // If Razorpay already handed us a capture, do not treat dismiss as cancel.
          if (capture || settling) {
            void (async () => {
              try {
                const reconciled = await postRazorpay("reconcile-order", {
                  order_id: order.order_id,
                  application_id: input.applicationId || undefined,
                  context: input.context,
                });
                if (reconciled?.success && reconciled.payment_id) {
                  finishSuccess(String(reconciled.payment_id), order.order_id, Boolean(reconciled.already));
                  return;
                }
              } catch {
                // ignore
              }
              if (!settled) reject(new Error("Payment is processing. If money was deducted it will update automatically."));
            })();
            return;
          }
          // Last-chance reconcile for UPI where handler never fired but bank debited.
          void (async () => {
            try {
              const reconciled = await postRazorpay("reconcile-order", {
                order_id: order.order_id,
                application_id: input.applicationId || undefined,
                context: input.context,
              });
              if (reconciled?.success && reconciled.payment_id) {
                finishSuccess(String(reconciled.payment_id), order.order_id, Boolean(reconciled.already));
                return;
              }
            } catch {
              // ignore
            }
            if (!settled) reject(new Error("Payment was cancelled."));
          })();
        },
      },
    });

    checkout.on("payment.failed", (response) => {
      if (settled) return;
      const message = response.error?.description || response.error?.reason || "Payment failed. Please try again.";
      reject(new Error(message));
    });

    checkout.open();
  });
}

export { shortReceipt as buildRazorpayReceipt };
